import test from "node:test";
import assert from "node:assert/strict";

import { encodeMidSide } from "../visualizer.js";

test("mid-side vectorscope encoding preserves stereo geometry", () => {
  assert.deepEqual(encodeMidSide(0.75, 0.75), { mid: 0.75, side: 0 });
  assert.deepEqual(encodeMidSide(0.75, -0.75), { mid: 0, side: 0.75 });
  assert.deepEqual(encodeMidSide(0.5, 0), { mid: 0.25, side: 0.25 });
  assert.deepEqual(encodeMidSide(0, 0.5), { mid: 0.25, side: -0.25 });
});
