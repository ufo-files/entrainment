import {
  createDeterministicPinkNoise,
  dbToGain,
  getCarrierPairs,
  getSpatialCarriers,
  sanitizeConfig,
} from "./audio-model.js";

const AudioContextClass = () => window.AudioContext || window.webkitAudioContext;

function setParam(param, value, context, ramp = 0.04) {
  const now = context.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(value, now + ramp);
}

export class AudioEngine {
  constructor(onError = () => {}) {
    this.onError = onError;
    this.context = null;
    this.master = null;
    this.leftAnalyser = null;
    this.rightAnalyser = null;
    this.telemetry = null;
    this.carrierBus = null;
    this.pairs = [];
    this.pink = null;
    this.config = null;
    this.running = false;
  }

  async start(config) {
    try {
      if (!this.context) this.createContext();
      if (this.context.state === "suspended") await this.context.resume();
      this.applyConfig(config, true);
      this.running = true;
    } catch (error) {
      this.onError(error);
      throw error;
    }
  }

  createContext() {
    const Context = AudioContextClass();
    if (!Context) throw new Error("Web Audio is not supported by this browser.");

    this.context = new Context({ latencyHint: "playback" });
    this.master = this.context.createGain();
    this.master.gain.value = 0;

    const compressor = this.context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.01;
    compressor.release.value = 0.3;

    const splitter = this.context.createChannelSplitter(2);
    const outputMerger = this.context.createChannelMerger(2);
    this.leftAnalyser = this.context.createAnalyser();
    this.rightAnalyser = this.context.createAnalyser();
    for (const analyser of [this.leftAnalyser, this.rightAnalyser]) {
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0;
      analyser.channelCount = 1;
      analyser.channelCountMode = "explicit";
    }

    this.master.connect(compressor);
    compressor.connect(splitter);
    splitter.connect(this.leftAnalyser, 0, 0);
    splitter.connect(this.rightAnalyser, 1, 0);
    this.leftAnalyser.connect(outputMerger, 0, 0);
    this.rightAnalyser.connect(outputMerger, 0, 1);
    outputMerger.connect(this.context.destination);

    this.telemetry = {
      left: new Float32Array(this.leftAnalyser.fftSize),
      right: new Float32Array(this.rightAnalyser.fftSize),
      sampleRate: this.context.sampleRate,
    };
  }

  applyConfig(config, rebuild = false) {
    if (!this.context) return;
    const clean = sanitizeConfig(config);
    const pairSignature = JSON.stringify(getCarrierPairs(clean));
    const previousSignature = this.config ? JSON.stringify(getCarrierPairs(this.config)) : "";
    const needsModulation = clean.contourShape !== "flat" && clean.contourDepth > 0;
    const hasModulation = this.pairs.some((pair) => Boolean(pair.modulation));

    if (
      rebuild
      || pairSignature !== previousSignature
      || clean.presentationMode !== this.config?.presentationMode
      || clean.contourShape !== this.config?.contourShape
      || needsModulation !== hasModulation
    ) {
      this.rebuildCarriers(clean);
    } else {
      this.updateCarrierModulation(clean);
    }
    this.updateSpatialMotion(clean);

    if (rebuild || !this.pink) this.rebuildPinkNoise(clean);
    this.updatePinkNoise(clean);
    setParam(this.master.gain, clean.volume, this.context, 0.08);
    this.config = clean;
  }

  rebuildCarriers(config) {
    this.destroyCarriers();
    if (config.presentationMode === "spatial") {
      this.rebuildSpatialCarriers(config);
      return;
    }
    this.rebuildBinauralCarriers(config);
  }

  rebuildBinauralCarriers(config) {
    const pairs = getCarrierPairs(config);
    const merger = this.context.createChannelMerger(2);
    const bus = this.context.createGain();
    const pairLevel = 0.34 / Math.sqrt(pairs.length);
    merger.connect(bus);
    bus.connect(this.master);

    this.pairs = pairs.map((pair) => {
      const leftOscillator = this.context.createOscillator();
      const rightOscillator = this.context.createOscillator();
      const leftGain = this.context.createGain();
      const rightGain = this.context.createGain();
      const leftModulation = this.context.createGain();
      const rightModulation = this.context.createGain();

      leftOscillator.type = "sine";
      rightOscillator.type = "sine";
      leftOscillator.frequency.value = pair.left;
      rightOscillator.frequency.value = pair.right;
      leftGain.gain.value = pairLevel;
      rightGain.gain.value = pairLevel;

      leftOscillator.connect(leftGain);
      rightOscillator.connect(rightGain);
      leftGain.connect(merger, 0, 0);
      rightGain.connect(merger, 0, 1);

      const modulation = this.createContourModulation(pair.difference, config.contourShape, config.contourDepth);
      if (modulation) {
        leftModulation.gain.value = pairLevel * config.contourDepth;
        rightModulation.gain.value = pairLevel * config.contourDepth;
        modulation.connect(leftModulation);
        modulation.connect(rightModulation);
        leftModulation.connect(leftGain.gain);
        rightModulation.connect(rightGain.gain);
        modulation.start();
      }

      leftOscillator.start();
      rightOscillator.start();

      return {
        sources: [leftOscillator, rightOscillator, modulation].filter(Boolean),
        nodes: [leftGain, rightGain, leftModulation, rightModulation],
        modulationGains: [leftModulation, rightModulation],
        modulation,
        pairLevel,
      };
    });

    this.carrierBus = { nodes: [merger, bus], sources: [], motion: null };
  }

  rebuildSpatialCarriers(config) {
    const carriers = getSpatialCarriers(config);
    const bus = this.context.createGain();
    const pairLevel = 0.34 / Math.sqrt(carriers.length);
    const spatializer = this.createSpatializer(config);
    bus.channelCount = 1;
    bus.channelCountMode = "explicit";
    bus.connect(spatializer.input);
    spatializer.output.connect(this.master);

    this.pairs = carriers.map((carrier) => {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      const modulationGain = this.context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = carrier.frequency;
      gain.gain.value = pairLevel;
      oscillator.connect(gain);
      gain.connect(bus);

      const modulation = this.createContourModulation(
        carrier.contourFrequency,
        config.contourShape,
        config.contourDepth,
      );
      if (modulation) {
        modulationGain.gain.value = pairLevel * config.contourDepth;
        modulation.connect(modulationGain);
        modulationGain.connect(gain.gain);
        modulation.start();
      }
      oscillator.start();

      return {
        sources: [oscillator, modulation].filter(Boolean),
        nodes: [gain, modulationGain],
        modulationGains: [modulationGain],
        modulation,
        pairLevel,
      };
    });

    this.carrierBus = {
      nodes: [bus, ...spatializer.nodes],
      sources: spatializer.sources,
      motion: spatializer.motion,
    };
  }

  createSpatializer(config) {
    const cycleFrequency = 1 / config.panCycleSeconds;
    const panner = this.context.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = 1;
    panner.maxDistance = 10;
    panner.rolloffFactor = 0;

    if (panner.positionX && panner.positionZ) {
      const xLfo = this.context.createOscillator();
      const zLfo = this.context.createOscillator();
      const xDepth = this.context.createGain();
      const zDepth = this.context.createGain();
      const cosine = this.context.createPeriodicWave(
        new Float32Array([0, 1]),
        new Float32Array([0, 0]),
        { disableNormalization: true },
      );
      xLfo.type = "sine";
      zLfo.setPeriodicWave(cosine);
      xLfo.frequency.value = cycleFrequency;
      zLfo.frequency.value = cycleFrequency;
      xDepth.gain.value = 1.4;
      zDepth.gain.value = 1.4;
      panner.positionY.value = 0;
      xLfo.connect(xDepth);
      zLfo.connect(zDepth);
      xDepth.connect(panner.positionX);
      zDepth.connect(panner.positionZ);
      xLfo.start();
      zLfo.start();
      return {
        input: panner,
        output: panner,
        nodes: [panner, xDepth, zDepth],
        sources: [xLfo, zLfo],
        motion: { oscillators: [xLfo, zLfo] },
      };
    }

    const fallback = this.context.createStereoPanner();
    const panLfo = this.context.createOscillator();
    const panDepth = this.context.createGain();
    panLfo.frequency.value = cycleFrequency;
    panDepth.gain.value = 0.92;
    panLfo.connect(panDepth);
    panDepth.connect(fallback.pan);
    panLfo.start();
    return {
      input: fallback,
      output: fallback,
      nodes: [fallback, panDepth],
      sources: [panLfo],
      motion: { oscillators: [panLfo] },
    };
  }

  createContourModulation(frequency, shape, depth) {
    if (shape === "flat" || depth === 0) return null;
    const oscillator = this.context.createOscillator();
    oscillator.type = shape;
    oscillator.frequency.value = frequency;
    return oscillator;
  }

  updateCarrierModulation(config) {
    this.pairs.forEach((pair) => {
      if (!pair.modulation) return;
      const amount = pair.pairLevel * config.contourDepth;
      pair.modulationGains.forEach((gain) => setParam(gain.gain, amount, this.context));
    });
  }

  updateSpatialMotion(config) {
    if (!this.carrierBus?.motion) return;
    this.carrierBus.motion.oscillators.forEach((oscillator) => {
      setParam(oscillator.frequency, 1 / config.panCycleSeconds, this.context);
    });
  }

  rebuildPinkNoise(config) {
    this.destroyPinkNoise();
    const frameCount = this.context.sampleRate * 8;
    const buffer = this.context.createBuffer(1, frameCount, this.context.sampleRate);
    buffer.copyToChannel(createDeterministicPinkNoise(frameCount), 0);

    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const panner = this.context.createStereoPanner();
    const panLfo = this.context.createOscillator();
    const panDepth = this.context.createGain();
    const filterLfo = this.context.createOscillator();
    const filterDepth = this.context.createGain();

    source.buffer = buffer;
    source.loop = true;
    filter.type = "lowpass";
    filter.frequency.value = 2400;
    filter.Q.value = 0.35;
    gain.gain.value = config.pinkEnabled ? dbToGain(config.pinkLevelDb) * 0.34 : 0;
    panLfo.type = "sine";
    panLfo.frequency.value = 1 / config.panCycleSeconds;
    panDepth.gain.value = 0.92;
    filterLfo.type = "sine";
    filterLfo.frequency.value = 1 / config.panCycleSeconds;
    filterDepth.gain.value = 720;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(this.master);
    panLfo.connect(panDepth);
    panDepth.connect(panner.pan);
    filterLfo.connect(filterDepth);
    filterDepth.connect(filter.frequency);

    source.start();
    panLfo.start();
    filterLfo.start(this.context.currentTime + config.panCycleSeconds / 4);
    this.pink = { source, filter, gain, panner, panLfo, panDepth, filterLfo, filterDepth };
  }

  updatePinkNoise(config) {
    if (!this.pink) return;
    const target = config.pinkEnabled ? dbToGain(config.pinkLevelDb) * 0.34 : 0;
    setParam(this.pink.gain.gain, target, this.context);
    setParam(this.pink.panLfo.frequency, 1 / config.panCycleSeconds, this.context);
    setParam(this.pink.filterLfo.frequency, 1 / config.panCycleSeconds, this.context);
  }

  async pause() {
    if (!this.context) return;
    await this.context.suspend();
    this.running = false;
  }

  async resume() {
    if (!this.context) return;
    await this.context.resume();
    this.running = true;
  }

  readTelemetry() {
    if (!this.telemetry || !this.leftAnalyser || !this.rightAnalyser) return null;
    if (this.context.state === "running") {
      this.readChannel(this.leftAnalyser, this.telemetry.left);
      this.readChannel(this.rightAnalyser, this.telemetry.right);
    }
    return this.telemetry;
  }

  readChannel(analyser, target) {
    if (typeof analyser.getFloatTimeDomainData === "function") {
      analyser.getFloatTimeDomainData(target);
      return;
    }
    const bytes = new Uint8Array(target.length);
    analyser.getByteTimeDomainData(bytes);
    for (let index = 0; index < target.length; index += 1) {
      target[index] = (bytes[index] - 128) / 128;
    }
  }

  destroyCarriers() {
    this.pairs.forEach((pair) => {
      for (const source of pair.sources) {
        if (!source) continue;
        try { source.stop(); } catch {}
        source.disconnect();
      }
      pair.nodes.forEach((node) => node.disconnect());
    });
    this.pairs = [];
    if (this.carrierBus) {
      this.carrierBus.sources.forEach((source) => {
        try { source.stop(); } catch {}
        source.disconnect();
      });
      this.carrierBus.nodes.forEach((node) => node.disconnect());
      this.carrierBus = null;
    }
  }

  destroyPinkNoise() {
    if (!this.pink) return;
    for (const source of [this.pink.source, this.pink.panLfo, this.pink.filterLfo]) {
      try { source.stop(); } catch {}
    }
    Object.values(this.pink).forEach((node) => node.disconnect());
    this.pink = null;
  }
}
