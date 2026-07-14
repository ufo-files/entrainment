import { calculateTelemetryMetrics, getCarrierPairs } from "./audio-model.js";

const TAU = Math.PI * 2;
const SCOPE_HISTORY_LENGTH = 7;
const SPATIAL_HISTORY_LENGTH = 64;

export function encodeMidSide(left, right) {
  return {
    mid: (left + right) / 2,
    side: (left - right) / 2,
  };
}

export function spatialPoint(angle, radius = 1) {
  const x = Math.sin(angle) * radius;
  const y = -Math.cos(angle) * radius;
  return {
    x: Math.abs(x) < 1e-12 ? 0 : x,
    y: Math.abs(y) < 1e-12 ? 0 : y,
  };
}

export class SignalVisualizer {
  constructor(canvas, getConfig, isRunning, getTelemetry, getSpatialState, onTelemetry = () => {}) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { alpha: false });
    this.getConfig = getConfig;
    this.isRunning = isRunning;
    this.getTelemetry = getTelemetry;
    this.getSpatialState = getSpatialState;
    this.onTelemetry = onTelemetry;
    this.width = 0;
    this.height = 0;
    this.pixelRatio = 1;
    this.elapsed = 0;
    this.lastTimestamp = null;
    this.lastTelemetryUpdate = 0;
    this.displayMetrics = null;
    this.scopeHistory = [];
    this.spatialHistory = [];
    this.spatialMid = null;
    this.spatialSide = null;
    this.lastPresentationMode = null;
    this.scopeGain = 1;
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    this.resize = this.resize.bind(this);
    this.render = this.render.bind(this);

    window.addEventListener("resize", this.resize, { passive: true });
    this.resize();
    requestAnimationFrame(this.render);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.width * this.pixelRatio);
    this.canvas.height = Math.round(this.height * this.pixelRatio);
    this.context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    this.lastTimestamp = null;
    this.scopeHistory = [];
    this.spatialHistory = [];
  }

  render(timestamp) {
    if (this.lastTimestamp === null) this.lastTimestamp = timestamp;
    const delta = Math.min(0.05, Math.max(0, (timestamp - this.lastTimestamp) / 1000));
    this.lastTimestamp = timestamp;
    if (!this.reducedMotion && this.isRunning()) this.elapsed += delta;
    this.draw(timestamp);
    requestAnimationFrame(this.render);
  }

  draw(timestamp) {
    const ctx = this.context;
    const config = this.getConfig();
    const pairs = getCarrierPairs(config);
    const telemetry = this.getTelemetry();
    const metrics = telemetry ? calculateTelemetryMetrics(telemetry.left, telemetry.right) : null;
    const telemetryMode = telemetry ? (this.isRunning() ? "live" : "paused") : "model";
    const spatial = config.presentationMode === "spatial";
    if (config.presentationMode !== this.lastPresentationMode) {
      this.scopeHistory = [];
      this.spatialHistory = [];
      this.lastPresentationMode = config.presentationMode;
    }
    const compact = this.width < 720;
    const headerSpace = compact ? 86 : 96;
    const footerSpace = compact ? 72 : 130;
    const availableHeight = Math.max(180, this.height - headerSpace - footerSpace);
    const centerX = this.width / 2;
    const centerY = headerSpace + availableHeight / 2;
    const fieldRadius = spatial
      ? Math.min(this.width * (compact ? 0.43 : 0.32), availableHeight * 0.48, 340)
      : Math.min(this.width * (compact ? 0.38 : 0.28), availableHeight * 0.42, 250);
    const pace = this.elapsed * 0.55;

    if (timestamp - this.lastTelemetryUpdate >= 180) {
      this.displayMetrics = metrics;
      this.onTelemetry(metrics, telemetryMode);
      this.lastTelemetryUpdate = timestamp;
    }
    const displayMetrics = this.displayMetrics ?? metrics;

    ctx.fillStyle = "#f6f5ef";
    ctx.fillRect(0, 0, this.width, this.height);
    if (spatial) {
      const spatialState = this.getSpatialState?.() ?? this.getModelSpatialState(config);
      this.drawSpatialGuides(ctx, centerX, centerY, fieldRadius, compact, spatialState.positionCount);
      this.drawChannelLabels(ctx, centerY, fieldRadius, pairs, config, displayMetrics, compact);
      if (telemetry) {
        this.drawLiveSpatialField(ctx, centerX, centerY, fieldRadius, telemetry, spatialState, config, compact);
      } else {
        this.drawModelSpatialField(ctx, centerX, centerY, fieldRadius, pairs, spatialState, config, compact);
      }
      this.drawSpatialPosition(ctx, centerX, centerY, fieldRadius, spatialState, compact);
      return;
    }
    this.drawGrid(ctx, centerY, availableHeight, compact);
    this.drawChannelLabels(ctx, centerY, fieldRadius, pairs, config, displayMetrics, compact);
    this.drawScopeGuides(ctx, centerX, centerY, fieldRadius, compact);
    if (telemetry) {
      this.drawLiveTraces(ctx, centerX, centerY, fieldRadius, telemetry, compact);
      this.drawLiveVectorscope(ctx, centerX, centerY, fieldRadius, telemetry, compact);
    } else {
      this.scopeHistory = [];
      this.drawModelTraces(ctx, centerX, centerY, fieldRadius, pairs, config, pace, compact);
      this.drawModelVectorscope(ctx, centerX, centerY, fieldRadius, pairs, config, pace, compact);
    }
  }

  getModelSpatialState(config) {
    const progress = (this.elapsed / config.panCycleSeconds) % 1;
    const angle = progress * TAU;
    return { angle, progress, ...spatialPoint(angle), positionCount: 12 };
  }

  drawSpatialGuides(ctx, centerX, centerY, radius, compact, positionCount) {
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.lineWidth = 1;
    for (const scale of [0.28, 0.52, 0.76, 1]) {
      ctx.strokeStyle = scale === 1 ? "rgba(17, 17, 17, 0.2)" : "rgba(17, 17, 17, 0.075)";
      ctx.beginPath();
      ctx.arc(0, 0, radius * scale, 0, TAU);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(17, 17, 17, 0.1)";
    ctx.beginPath();
    ctx.moveTo(-radius, 0);
    ctx.lineTo(radius, 0);
    ctx.moveTo(0, -radius);
    ctx.lineTo(0, radius);
    ctx.stroke();

    for (let index = 0; index < positionCount; index += 1) {
      const point = spatialPoint((index / positionCount) * TAU, radius);
      ctx.fillStyle = "rgba(17, 17, 17, 0.34)";
      ctx.beginPath();
      ctx.arc(point.x, point.y, compact ? 1.75 : 2.1, 0, TAU);
      ctx.fill();
    }

    ctx.fillStyle = "rgba(17, 17, 17, 0.45)";
    ctx.font = `${compact ? 8 : 9}px "SF Mono", ui-monospace, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("FRONT", 0, -radius - 8);
    ctx.textBaseline = "top";
    ctx.fillText("REAR", 0, radius + 8);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText("L", -radius - 8, 0);
    ctx.textAlign = "left";
    ctx.fillText("R", radius + 8, 0);
    ctx.restore();
  }

  drawLiveSpatialField(ctx, centerX, centerY, radius, telemetry, spatialState, config, compact) {
    const length = Math.min(telemetry.left.length, telemetry.right.length);
    if (!this.spatialMid || this.spatialMid.length !== length) {
      this.spatialMid = new Float32Array(length);
      this.spatialSide = new Float32Array(length);
    }
    for (let index = 0; index < length; index += 1) {
      const encoded = encodeMidSide(telemetry.left[index], telemetry.right[index]);
      this.spatialMid[index] = encoded.mid;
      this.spatialSide[index] = encoded.side;
    }
    this.drawSpatialPcmRing(ctx, centerX, centerY, radius * 0.67, radius * 0.12, this.spatialMid, spatialState.angle, compact, 0.72);
    this.drawSpatialPcmRing(ctx, centerX, centerY, radius * 0.49, radius * 0.1, this.spatialSide, -spatialState.angle, compact, 0.38);
    this.drawSpatialTelemetryLabel(ctx, centerX, centerY, radius, `LIVE PCM  /  ${spatialState.positionCount} HRTF POSITIONS  /  ${config.panCycleSeconds} SEC ORBIT`, compact);
  }

  drawModelSpatialField(ctx, centerX, centerY, radius, pairs, spatialState, config, compact) {
    const sampleCount = compact ? 256 : 420;
    const left = new Float32Array(sampleCount);
    const right = new Float32Array(sampleCount);
    const leftGain = Math.sqrt((1 - spatialState.x) / 2);
    const rightGain = Math.sqrt((1 + spatialState.x) / 2);
    const level = 0.34 / Math.sqrt(pairs.length);
    for (let index = 0; index < sampleCount; index += 1) {
      const time = this.elapsed * 0.035 + (index / sampleCount) * 0.075;
      for (const pair of pairs) {
        const contour = 1 + Math.sin(TAU * pair.difference * time) * config.contourDepth;
        const sample = Math.sin(TAU * pair.left * time) * level * contour;
        left[index] += sample * leftGain;
        right[index] += sample * rightGain;
      }
    }
    const mid = new Float32Array(sampleCount);
    const side = new Float32Array(sampleCount);
    for (let index = 0; index < sampleCount; index += 1) {
      const encoded = encodeMidSide(left[index], right[index]);
      mid[index] = encoded.mid;
      side[index] = encoded.side;
    }
    this.drawSpatialPcmRing(ctx, centerX, centerY, radius * 0.67, radius * 0.12, mid, spatialState.angle, compact, 0.68);
    this.drawSpatialPcmRing(ctx, centerX, centerY, radius * 0.49, radius * 0.1, side, -spatialState.angle, compact, 0.32);
    this.drawSpatialTelemetryLabel(ctx, centerX, centerY, radius, `MODEL  /  ${spatialState.positionCount} HRTF POSITIONS  /  ${config.panCycleSeconds} SEC ORBIT`, compact);
  }

  drawSpatialPcmRing(ctx, centerX, centerY, baseRadius, amplitude, samples, rotation, compact, opacity) {
    let peak = 0;
    for (let index = 0; index < samples.length; index += 1) peak = Math.max(peak, Math.abs(samples[index]));
    const gain = peak > 0.0001 ? 1 / peak : 0;
    const pointCount = compact ? 150 : 260;
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.strokeStyle = `rgba(17, 17, 17, ${opacity})`;
    ctx.lineWidth = 1.05;
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let pointIndex = 0; pointIndex <= pointCount; pointIndex += 1) {
      const ratio = pointIndex / pointCount;
      const sampleIndex = Math.min(samples.length - 1, Math.floor(ratio * samples.length));
      const angle = ratio * TAU + rotation;
      const ringRadius = baseRadius + samples[sampleIndex] * gain * amplitude;
      const pointX = Math.sin(angle) * ringRadius;
      const pointY = -Math.cos(angle) * ringRadius;
      if (pointIndex === 0) ctx.moveTo(pointX, pointY);
      else ctx.lineTo(pointX, pointY);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  drawSpatialTelemetryLabel(ctx, centerX, centerY, radius, label, compact) {
    ctx.save();
    ctx.fillStyle = "rgba(17, 17, 17, 0.46)";
    ctx.font = `${compact ? 7 : 9}px "SF Mono", ui-monospace, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(label, centerX, centerY + radius + (compact ? 25 : 28));
    ctx.restore();
  }

  drawSpatialPosition(ctx, centerX, centerY, radius, spatialState, compact) {
    const current = spatialPoint(spatialState.angle, radius * 0.9);
    const previous = this.spatialHistory[this.spatialHistory.length - 1];
    const distance = previous ? Math.hypot(current.x - previous.x, current.y - previous.y) : Infinity;
    if (this.isRunning() && distance > radius * 0.012) {
      this.spatialHistory.push(current);
      if (this.spatialHistory.length > SPATIAL_HISTORY_LENGTH) this.spatialHistory.shift();
    } else if (this.spatialHistory.length === 0) {
      this.spatialHistory.push(current);
    }

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.lineCap = "round";
    for (let index = 1; index < this.spatialHistory.length; index += 1) {
      const recency = index / this.spatialHistory.length;
      ctx.strokeStyle = `rgba(17, 17, 17, ${0.025 + recency * recency * 0.28})`;
      ctx.lineWidth = compact ? 1 : 1.2;
      ctx.beginPath();
      ctx.moveTo(this.spatialHistory[index - 1].x, this.spatialHistory[index - 1].y);
      ctx.lineTo(this.spatialHistory[index].x, this.spatialHistory[index].y);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(17, 17, 17, 0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(current.x, current.y);
    ctx.stroke();

    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.arc(current.x, current.y, compact ? 4 : 5, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(17, 17, 17, 0.35)";
    ctx.beginPath();
    ctx.arc(current.x, current.y, compact ? 8 : 10, 0, TAU);
    ctx.stroke();

    ctx.fillStyle = "#f6f5ef";
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, compact ? 9 : 11, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, compact ? -5 : -7);
    ctx.lineTo(0, compact ? -13 : -16);
    ctx.stroke();

    ctx.fillStyle = "rgba(17, 17, 17, 0.5)";
    ctx.font = `${compact ? 7 : 8}px "SF Mono", ui-monospace, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("LISTENER", 0, compact ? 16 : 19);
    ctx.restore();
  }

  drawGrid(ctx, centerY, availableHeight, compact) {
    ctx.save();
    ctx.strokeStyle = "rgba(17, 17, 17, 0.075)";
    ctx.lineWidth = 1;
    const left = compact ? 20 : 42;
    const right = this.width - left;
    const lines = compact ? 4 : 6;
    for (let index = 0; index <= lines; index += 1) {
      const y = centerY - availableHeight * 0.36 + (availableHeight * 0.72 * index) / lines;
      ctx.beginPath();
      ctx.moveTo(left, Math.round(y) + 0.5);
      ctx.lineTo(right, Math.round(y) + 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawChannelLabels(ctx, centerY, radius, pairs, config, metrics, compact) {
    const primary = pairs[0];
    const leftLabel = metrics
      ? `L  LIVE  ${metrics.leftDbfs.toFixed(1)} DBFS`
      : config.presentationMode === "spatial"
        ? "L  MODEL  HRTF"
        : `L  MODEL  ${primary.left.toFixed(primary.left % 1 ? 1 : 0)} HZ`;
    const rightLabel = metrics
      ? `R  LIVE  ${metrics.rightDbfs.toFixed(1)} DBFS`
      : config.presentationMode === "spatial"
        ? "R  MODEL  HRTF"
        : `R  MODEL  ${primary.right.toFixed(primary.right % 1 ? 1 : 0)} HZ`;
    ctx.save();
    ctx.fillStyle = "rgba(17, 17, 17, 0.58)";
    ctx.font = `${compact ? 9 : 10}px "SF Mono", ui-monospace, monospace`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(leftLabel, compact ? 20 : 42, centerY - radius - 28);
    ctx.textAlign = "right";
    ctx.fillText(rightLabel, this.width - (compact ? 20 : 42), centerY - radius - 28);
    ctx.restore();
  }

  drawScopeGuides(ctx, x, y, radius, compact) {
    const scopeRadius = radius * 0.68;
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = "rgba(17, 17, 17, 0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, scopeRadius, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = "rgba(17, 17, 17, 0.11)";
    ctx.beginPath();
    ctx.moveTo(-scopeRadius, 0);
    ctx.lineTo(scopeRadius, 0);
    ctx.moveTo(0, -scopeRadius);
    ctx.lineTo(0, scopeRadius);
    ctx.stroke();
    ctx.fillStyle = "rgba(17, 17, 17, 0.46)";
    ctx.font = `${compact ? 8 : 9}px "SF Mono", ui-monospace, monospace`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText("M", scopeRadius + 7, 0);
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("S", 0, -scopeRadius - 6);
    ctx.textBaseline = "top";
    ctx.fillText("NORMALIZED", 0, scopeRadius + 7);
    ctx.restore();
  }

  buildScopePoints(left, right, step, gain) {
    const length = Math.min(left.length, right.length);
    const points = [];
    for (let index = 0; index < length; index += step) {
      const { mid, side } = encodeMidSide(left[index], right[index]);
      points.push({
        x: Math.max(-1, Math.min(1, mid * gain)),
        y: Math.max(-1, Math.min(1, side * gain)),
      });
    }
    return points;
  }

  getScopeGain(left, right) {
    let peak = 0;
    const length = Math.min(left.length, right.length);
    for (let index = 0; index < length; index += 4) {
      const { mid, side } = encodeMidSide(left[index], right[index]);
      peak = Math.max(peak, Math.abs(mid), Math.abs(side));
    }
    const target = peak > 0.0001 ? Math.min(12, 0.86 / peak) : 1;
    this.scopeGain += (target - this.scopeGain) * 0.14;
    return this.scopeGain;
  }

  drawScopePaths(ctx, centerX, centerY, radius, paths) {
    const scopeRadius = radius * 0.68;
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.lineWidth = 1.05;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    paths.forEach((points, index) => {
      if (points.length < 2) return;
      const recency = (index + 1) / paths.length;
      ctx.strokeStyle = `rgba(17, 17, 17, ${0.05 + recency * recency * 0.62})`;
      ctx.beginPath();
      points.forEach((point, pointIndex) => {
        const pointX = point.x * scopeRadius;
        const pointY = -point.y * scopeRadius;
        if (pointIndex === 0) ctx.moveTo(pointX, pointY);
        else ctx.lineTo(pointX, pointY);
      });
      ctx.stroke();
    });
    ctx.restore();
  }

  drawLiveVectorscope(ctx, centerX, centerY, radius, telemetry, compact) {
    const gain = this.getScopeGain(telemetry.left, telemetry.right);
    const points = this.buildScopePoints(telemetry.left, telemetry.right, compact ? 10 : 7, gain);
    if (this.isRunning()) {
      this.scopeHistory.push(points);
      if (this.scopeHistory.length > SCOPE_HISTORY_LENGTH) this.scopeHistory.shift();
    } else if (this.scopeHistory.length === 0) {
      this.scopeHistory.push(points);
    }
    this.drawScopePaths(ctx, centerX, centerY, radius, this.scopeHistory);
  }

  drawLiveTraces(ctx, centerX, centerY, radius, telemetry, compact) {
    const edge = compact ? 18 : 42;
    const gap = radius * 0.86;
    const scale = compact ? 210 : 240;
    ctx.save();
    ctx.lineWidth = 1.15;
    const pointStep = compact ? 1 : 2;
    this.drawPcmWave(ctx, edge, centerX - gap, centerY, telemetry.left, scale, pointStep);
    this.drawPcmWave(ctx, centerX + gap, this.width - edge, centerY, telemetry.right, scale, pointStep);
    ctx.restore();
  }

  drawPcmWave(ctx, startX, endX, centerY, samples, scale, pointStep) {
    const width = Math.max(1, endX - startX);
    ctx.strokeStyle = "rgba(17, 17, 17, 0.76)";
    ctx.beginPath();
    for (let step = 0; step <= Math.ceil(width); step += pointStep) {
      const ratio = step / width;
      const sampleIndex = Math.min(samples.length - 1, Math.floor(ratio * samples.length));
      const sample = Math.max(-0.28, Math.min(0.28, samples[sampleIndex]));
      const pointY = centerY + sample * scale;
      if (step === 0) ctx.moveTo(startX + step, pointY);
      else ctx.lineTo(startX + step, pointY);
    }
    ctx.stroke();
  }

  drawModelTraces(ctx, centerX, centerY, radius, pairs, config, pace, compact) {
    const edge = compact ? 18 : 42;
    const gap = radius * 0.86;
    const leftEnd = centerX - gap;
    const rightStart = centerX + gap;
    const amplitudes = compact ? 13 : 18;
    const pan = Math.sin((pace / 0.55) * TAU / config.panCycleSeconds);
    const panAngle = ((pan + 1) * Math.PI) / 4;
    const leftSpatialGain = Math.cos(panAngle);
    const rightSpatialGain = Math.sin(panAngle);

    ctx.save();
    ctx.lineWidth = 1.15;
    pairs.forEach((pair, pairIndex) => {
      const offset = (pairIndex - (pairs.length - 1) / 2) * (compact ? 22 : 28);
      const spatial = config.presentationMode === "spatial";
      this.drawModelWave(
        ctx,
        edge,
        leftEnd,
        centerY + offset,
        pair.left,
        pace,
        amplitudes * (spatial ? leftSpatialGain : 1),
      );
      this.drawModelWave(
        ctx,
        rightStart,
        this.width - edge,
        centerY + offset,
        spatial ? pair.left : pair.right,
        pace,
        amplitudes * (spatial ? rightSpatialGain : 1),
      );
    });
    ctx.restore();
  }

  drawModelWave(ctx, startX, endX, y, frequency, pace, amplitude) {
    const width = Math.max(1, endX - startX);
    const cycles = Math.max(2, width / 46) * (0.72 + frequency / 420);
    ctx.strokeStyle = "rgba(17, 17, 17, 0.72)";
    ctx.beginPath();
    for (let step = 0; step <= Math.ceil(width); step += 2) {
      const ratio = step / width;
      const envelope = Math.sin(Math.PI * ratio) * 0.45 + 0.55;
      const wave = Math.sin(ratio * TAU * cycles - pace * (frequency / 24));
      const pointY = y + wave * amplitude * envelope;
      if (step === 0) ctx.moveTo(startX + step, pointY);
      else ctx.lineTo(startX + step, pointY);
    }
    ctx.stroke();
  }

  drawModelVectorscope(ctx, centerX, centerY, radius, pairs, config, pace, compact) {
    const pointCount = compact ? 180 : 260;
    const windowSeconds = 0.075;
    const left = new Float32Array(pointCount);
    const right = new Float32Array(pointCount);
    const level = 0.34 / Math.sqrt(pairs.length);
    const pan = Math.sin((pace / 0.55) * TAU / config.panCycleSeconds);
    const panAngle = ((pan + 1) * Math.PI) / 4;
    const leftSpatialGain = Math.cos(panAngle);
    const rightSpatialGain = Math.sin(panAngle);
    for (let index = 0; index < pointCount; index += 1) {
      const time = pace * 0.035 + (index / (pointCount - 1)) * windowSeconds;
      pairs.forEach((pair) => {
        const contour = 1 + Math.sin(TAU * pair.difference * time) * config.contourDepth;
        left[index] += Math.sin(TAU * pair.left * time) * level * contour
          * (config.presentationMode === "spatial" ? leftSpatialGain : 1);
        right[index] += Math.sin(TAU * (config.presentationMode === "spatial" ? pair.left : pair.right) * time)
          * level * contour * (config.presentationMode === "spatial" ? rightSpatialGain : 1);
      });
    }
    let peak = 0;
    for (let index = 0; index < pointCount; index += 1) {
      const { mid, side } = encodeMidSide(left[index], right[index]);
      peak = Math.max(peak, Math.abs(mid), Math.abs(side));
    }
    const gain = peak > 0 ? 0.86 / peak : 1;
    const points = this.buildScopePoints(left, right, 1, gain);
    this.drawScopePaths(ctx, centerX, centerY, radius, [points]);
  }
}
