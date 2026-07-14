export const PROGRAMS = Object.freeze({
  reference: Object.freeze({
    name: "Patent reference",
    citation: "100 Hz left / 104 Hz right",
    carriers: Object.freeze([100]),
    beats: Object.freeze([4]),
  }),
  "figure-3b": Object.freeze({
    name: "Figure 3B frequency set",
    citation: "1.5 / 4 / 6 Hz differential set",
    carriers: Object.freeze([110, 165, 220]),
    beats: Object.freeze([1.5, 4, 6]),
  }),
  "figure-3d": Object.freeze({
    name: "Figure 3D frequency set",
    citation: "2 / 4 / 7 Hz differential set",
    carriers: Object.freeze([110, 165, 220]),
    beats: Object.freeze([2, 4, 7]),
  }),
  "figure-3f": Object.freeze({
    name: "Figure 3F frequency set",
    citation: "0.5 / 3 / 4 Hz differential set",
    carriers: Object.freeze([110, 165, 220]),
    beats: Object.freeze([0.5, 3, 4]),
  }),
  "figure-3h": Object.freeze({
    name: "Figure 3H frequency set",
    citation: "1.5 / 2 / 4 Hz differential set",
    carriers: Object.freeze([110, 165, 220]),
    beats: Object.freeze([1.5, 2, 4]),
  }),
});

export const DEFAULT_CONFIG = Object.freeze({
  program: "reference",
  carrierFrequency: 100,
  beatFrequency: 4,
  contourShape: "sine",
  contourDepth: 0.14,
  pinkEnabled: true,
  pinkLevelDb: -18,
  panCycleSeconds: 24,
  volume: 0.14,
});

const CONTOUR_SHAPES = new Set(["sine", "triangle", "square", "flat"]);

export function clamp(value, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return minimum;
  return Math.min(maximum, Math.max(minimum, number));
}

export function sanitizeConfig(input = {}) {
  const program = Object.hasOwn(PROGRAMS, input.program) ? input.program : DEFAULT_CONFIG.program;
  const contourShape = CONTOUR_SHAPES.has(input.contourShape)
    ? input.contourShape
    : DEFAULT_CONFIG.contourShape;

  return {
    program,
    carrierFrequency: clamp(input.carrierFrequency ?? DEFAULT_CONFIG.carrierFrequency, 40, 1000),
    beatFrequency: clamp(input.beatFrequency ?? DEFAULT_CONFIG.beatFrequency, 0.25, 30),
    contourShape,
    contourDepth: clamp(input.contourDepth ?? DEFAULT_CONFIG.contourDepth, 0, 0.35),
    pinkEnabled: input.pinkEnabled === undefined ? DEFAULT_CONFIG.pinkEnabled : Boolean(input.pinkEnabled),
    pinkLevelDb: clamp(input.pinkLevelDb ?? DEFAULT_CONFIG.pinkLevelDb, -30, -10),
    panCycleSeconds: clamp(input.panCycleSeconds ?? DEFAULT_CONFIG.panCycleSeconds, 6, 60),
    volume: clamp(input.volume ?? DEFAULT_CONFIG.volume, 0, 0.5),
  };
}

export function getCarrierPairs(config) {
  const clean = sanitizeConfig(config);
  if (clean.program === "reference") {
    return [{
      left: clean.carrierFrequency,
      right: clean.carrierFrequency + clean.beatFrequency,
      difference: clean.beatFrequency,
    }];
  }

  const program = PROGRAMS[clean.program];
  return program.carriers.map((left, index) => ({
    left,
    right: left + program.beats[index],
    difference: program.beats[index],
  }));
}

export function dbToGain(decibels) {
  return 10 ** (clamp(decibels, -120, 12) / 20);
}

export function formatFrequency(value) {
  const precision = Number.isInteger(value) ? 0 : 1;
  return `${value.toFixed(precision)} Hz`;
}

export function formatElapsed(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function calculateTelemetryMetrics(leftSamples, rightSamples) {
  const length = Math.min(leftSamples?.length ?? 0, rightSamples?.length ?? 0);
  if (length === 0) {
    return {
      leftRms: 0,
      rightRms: 0,
      differenceRms: 0,
      leftDbfs: -120,
      rightDbfs: -120,
      differenceDbfs: -120,
      correlation: 0,
    };
  }

  let leftEnergy = 0;
  let rightEnergy = 0;
  let differenceEnergy = 0;
  let crossProduct = 0;
  for (let index = 0; index < length; index += 1) {
    const left = Number(leftSamples[index]) || 0;
    const right = Number(rightSamples[index]) || 0;
    const difference = left - right;
    leftEnergy += left * left;
    rightEnergy += right * right;
    differenceEnergy += difference * difference;
    crossProduct += left * right;
  }

  const leftRms = Math.sqrt(leftEnergy / length);
  const rightRms = Math.sqrt(rightEnergy / length);
  const differenceRms = Math.sqrt(differenceEnergy / length);
  const denominator = Math.sqrt(leftEnergy * rightEnergy);
  const correlation = denominator > 1e-12
    ? Math.max(-1, Math.min(1, crossProduct / denominator))
    : 0;
  const toDbfs = (rms) => Math.max(-120, 20 * Math.log10(Math.max(rms, 1e-6)));

  return {
    leftRms,
    rightRms,
    differenceRms,
    leftDbfs: toDbfs(leftRms),
    rightDbfs: toDbfs(rightRms),
    differenceDbfs: toDbfs(differenceRms),
    correlation,
  };
}

export function createDeterministicPinkNoise(length, seed = 5213562) {
  const size = Math.max(1, Math.floor(length));
  const samples = new Float32Array(size);
  let state = seed >>> 0;
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;

  const random = () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return (state / 0xffffffff) * 2 - 1;
  };

  for (let index = 0; index < size; index += 1) {
    const white = random();
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    b6 = white * 0.115926;
    samples[index] = Math.max(-1, Math.min(1, pink * 0.11));
  }

  return samples;
}
