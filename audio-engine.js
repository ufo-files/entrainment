import {
  createDeterministicPinkNoise,
  dbToGain,
  getCarrierPairs,
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
    this.analyser = null;
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

    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.72;

    const compressor = this.context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.01;
    compressor.release.value = 0.3;

    this.master.connect(this.analyser);
    this.analyser.connect(compressor);
    compressor.connect(this.context.destination);
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
      || clean.contourShape !== this.config?.contourShape
      || needsModulation !== hasModulation
    ) {
      this.rebuildCarriers(clean);
    } else {
      this.updateCarrierModulation(clean);
    }

    if (rebuild || !this.pink) this.rebuildPinkNoise(clean);
    this.updatePinkNoise(clean);
    setParam(this.master.gain, clean.volume, this.context, 0.08);
    this.config = clean;
  }

  rebuildCarriers(config) {
    this.destroyCarriers();
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
        leftOscillator,
        rightOscillator,
        leftGain,
        rightGain,
        leftModulation,
        rightModulation,
        modulation,
        pairLevel,
      };
    });

    this.carrierBus = { merger, bus };
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
      setParam(pair.leftModulation.gain, amount, this.context);
      setParam(pair.rightModulation.gain, amount, this.context);
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

  destroyCarriers() {
    this.pairs.forEach((pair) => {
      for (const source of [pair.leftOscillator, pair.rightOscillator, pair.modulation]) {
        if (!source) continue;
        try { source.stop(); } catch {}
        source.disconnect();
      }
      pair.leftGain.disconnect();
      pair.rightGain.disconnect();
      pair.leftModulation.disconnect();
      pair.rightModulation.disconnect();
    });
    this.pairs = [];
    if (this.carrierBus) {
      this.carrierBus.merger.disconnect();
      this.carrierBus.bus.disconnect();
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
