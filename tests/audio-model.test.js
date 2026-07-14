import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_CONFIG,
  PROGRAMS,
  calculateTelemetryMetrics,
  createDeterministicPinkNoise,
  dbToGain,
  formatElapsed,
  getCarrierPairs,
  sanitizeConfig,
} from "../audio-model.js";

test("the reference program reproduces the patent's 100/104 Hz example", () => {
  assert.deepEqual(getCarrierPairs(DEFAULT_CONFIG), [
    { left: 100, right: 104, difference: 4 },
  ]);
});

test("figure programs preserve the documented differential frequency sets", () => {
  const expected = {
    "figure-3b": [1.5, 4, 6],
    "figure-3d": [2, 4, 7],
    "figure-3f": [0.5, 3, 4],
    "figure-3h": [1.5, 2, 4],
  };

  for (const [program, beats] of Object.entries(expected)) {
    assert.deepEqual(PROGRAMS[program].beats, beats);
    assert.deepEqual(
      getCarrierPairs({ ...DEFAULT_CONFIG, program }).map((pair) => pair.difference),
      beats,
    );
  }
});

test("configuration sanitization clamps unsafe or unsupported input", () => {
  assert.deepEqual(sanitizeConfig({
    program: "unknown",
    carrierFrequency: 2,
    beatFrequency: 90,
    contourShape: "sawtooth",
    contourDepth: 4,
    pinkLevelDb: 2,
    panCycleSeconds: 1,
    volume: 3,
  }), {
    ...DEFAULT_CONFIG,
    carrierFrequency: 40,
    beatFrequency: 30,
    contourDepth: 0.35,
    pinkLevelDb: -10,
    panCycleSeconds: 6,
    volume: 0.5,
  });
});

test("pink noise level remains lower than the carrier reference", () => {
  assert.ok(dbToGain(-10) < 0.32);
  assert.ok(dbToGain(-18) < dbToGain(-10));
});

test("pink noise generation is deterministic and bounded", () => {
  const first = createDeterministicPinkNoise(256);
  const second = createDeterministicPinkNoise(256);
  assert.deepEqual(first, second);
  assert.ok(first.some((sample) => sample !== 0));
  assert.ok(first.every((sample) => sample >= -1 && sample <= 1));
});

test("elapsed time formatting is stable", () => {
  assert.equal(formatElapsed(0), "00:00");
  assert.equal(formatElapsed(65.9), "01:05");
  assert.equal(formatElapsed(-20), "00:00");
});

test("telemetry metrics measure channel level, difference, and correlation", () => {
  const left = Float32Array.from([1, 0, -1, 0]);
  const right = Float32Array.from([1, 0, -1, 0]);
  const identical = calculateTelemetryMetrics(left, right);
  assert.ok(Math.abs(identical.leftRms - Math.SQRT1_2) < 1e-6);
  assert.equal(identical.differenceRms, 0);
  assert.equal(identical.differenceDbfs, -120);
  assert.equal(identical.correlation, 1);

  const inverted = calculateTelemetryMetrics(left, Float32Array.from([-1, 0, 1, 0]));
  assert.equal(inverted.correlation, -1);
  assert.ok(inverted.differenceRms > identical.leftRms);
  assert.ok(inverted.differenceDbfs > identical.differenceDbfs);
});
