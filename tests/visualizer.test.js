import test from "node:test";
import assert from "node:assert/strict";

import { encodeMidSide, spatialPoint } from "../visualizer.js";

test("mid-side vectorscope encoding preserves stereo geometry", () => {
  assert.deepEqual(encodeMidSide(0.75, 0.75), { mid: 0.75, side: 0 });
  assert.deepEqual(encodeMidSide(0.75, -0.75), { mid: 0, side: 0.75 });
  assert.deepEqual(encodeMidSide(0.5, 0), { mid: 0.25, side: 0.25 });
  assert.deepEqual(encodeMidSide(0, 0.5), { mid: 0.25, side: -0.25 });
});

test("spatial field points preserve front, right, rear, and left orientation", () => {
  const roundedPoint = (angle) => {
    const point = spatialPoint(angle, 2);
    return { x: Math.round(point.x), y: Math.round(point.y) };
  };
  assert.deepEqual(roundedPoint(0), { x: 0, y: -2 });
  assert.deepEqual(roundedPoint(Math.PI / 2), { x: 2, y: 0 });
  assert.deepEqual(roundedPoint(Math.PI), { x: 0, y: 2 });
  assert.deepEqual(roundedPoint((Math.PI * 3) / 2), { x: -2, y: 0 });
});
