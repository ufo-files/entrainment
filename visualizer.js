import { calculateTelemetryMetrics, getCarrierPairs } from "./audio-model.js";

const TAU = Math.PI * 2;

export class SignalVisualizer {
  constructor(canvas, getConfig, isRunning, getTelemetry, onTelemetry = () => {}) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { alpha: false });
    this.getConfig = getConfig;
    this.isRunning = isRunning;
    this.getTelemetry = getTelemetry;
    this.onTelemetry = onTelemetry;
    this.width = 0;
    this.height = 0;
    this.pixelRatio = 1;
    this.elapsed = 0;
    this.lastTimestamp = null;
    this.lastTelemetryUpdate = 0;
    this.displayMetrics = null;
    this.pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    this.resize = this.resize.bind(this);
    this.render = this.render.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerLeave = this.onPointerLeave.bind(this);

    window.addEventListener("resize", this.resize, { passive: true });
    window.addEventListener("pointermove", this.onPointerMove, { passive: true });
    window.addEventListener("pointerleave", this.onPointerLeave, { passive: true });
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
  }

  onPointerMove(event) {
    this.pointer.targetX = (event.clientX / this.width - 0.5) * 2;
    this.pointer.targetY = (event.clientY / this.height - 0.5) * 2;
  }

  onPointerLeave() {
    this.pointer.targetX = 0;
    this.pointer.targetY = 0;
  }

  render(timestamp) {
    if (this.lastTimestamp === null) this.lastTimestamp = timestamp;
    const delta = Math.min(0.05, Math.max(0, (timestamp - this.lastTimestamp) / 1000));
    this.lastTimestamp = timestamp;
    if (!this.reducedMotion && this.isRunning()) this.elapsed += delta;
    this.pointer.x += (this.pointer.targetX - this.pointer.x) * Math.min(1, delta * 3);
    this.pointer.y += (this.pointer.targetY - this.pointer.y) * Math.min(1, delta * 3);
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
    const compact = this.width < 720;
    const headerSpace = compact ? 86 : 96;
    const footerSpace = compact ? 182 : 180;
    const availableHeight = Math.max(180, this.height - headerSpace - footerSpace);
    const centerX = this.width / 2 + this.pointer.x * Math.min(18, this.width * 0.02);
    const centerY = headerSpace + availableHeight / 2 + this.pointer.y * 10;
    const fieldRadius = Math.min(this.width * (compact ? 0.38 : 0.28), availableHeight * 0.42, 250);
    const pace = this.elapsed * 0.55;

    if (timestamp - this.lastTelemetryUpdate >= 180) {
      this.displayMetrics = metrics;
      this.onTelemetry(metrics, telemetryMode);
      this.lastTelemetryUpdate = timestamp;
    }
    const displayMetrics = this.displayMetrics ?? metrics;

    ctx.fillStyle = "#f6f5ef";
    ctx.fillRect(0, 0, this.width, this.height);
    this.drawGrid(ctx, centerY, availableHeight, compact);
    this.drawChannelLabels(ctx, centerY, fieldRadius, pairs, displayMetrics, compact);
    if (telemetry) {
      this.drawLiveField(ctx, centerX, centerY, fieldRadius, telemetry, metrics);
      this.drawLiveTraces(ctx, centerX, centerY, fieldRadius, telemetry, compact);
      this.drawLiveCore(ctx, centerX, centerY, fieldRadius, displayMetrics);
    } else {
      this.drawModelField(ctx, centerX, centerY, fieldRadius, pairs, pace);
      this.drawModelTraces(ctx, centerX, centerY, fieldRadius, pairs, pace, compact);
      this.drawModelCore(ctx, centerX, centerY, fieldRadius, pairs, pace);
    }
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

  drawChannelLabels(ctx, centerY, radius, pairs, metrics, compact) {
    const primary = pairs[0];
    const leftLabel = metrics
      ? `L  LIVE  ${metrics.leftDbfs.toFixed(1)} DBFS`
      : `L  MODEL  ${primary.left.toFixed(primary.left % 1 ? 1 : 0)} HZ`;
    const rightLabel = metrics
      ? `R  LIVE  ${metrics.rightDbfs.toFixed(1)} DBFS`
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

  drawLiveField(ctx, x, y, radius, telemetry, metrics) {
    const { left, right } = telemetry;
    const sampleCount = Math.min(left.length, right.length);
    const rings = Math.max(12, Math.round(radius / 9));
    const points = Math.max(96, Math.round(radius * 0.7));
    const amplitude = Math.min(1, metrics.differenceRms * 7);

    ctx.save();
    ctx.translate(x, y);
    ctx.lineWidth = 1;
    for (let ring = rings; ring >= 1; ring -= 1) {
      const ratio = ring / rings;
      const baseHorizontal = radius * ratio;
      const baseVertical = radius * ratio * 0.72;
      const deformationScale = radius * (0.1 + (1 - ratio) * 0.12);
      ctx.strokeStyle = `rgba(17, 17, 17, ${0.05 + (1 - ratio) * 0.16 + amplitude * 0.04})`;
      ctx.beginPath();
      for (let point = 0; point <= points; point += 1) {
        const angle = (point / points) * TAU;
        const sampleIndex = (Math.floor((point / points) * sampleCount) + ring * 37) % sampleCount;
        const difference = left[sampleIndex] - right[sampleIndex];
        const horizontal = baseHorizontal + difference * deformationScale;
        const vertical = baseVertical + difference * deformationScale * 0.72;
        const pointX = Math.cos(angle) * horizontal;
        const pointY = Math.sin(angle) * vertical;
        if (point === 0) ctx.moveTo(pointX, pointY);
        else ctx.lineTo(pointX, pointY);
      }
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
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

  drawLiveCore(ctx, centerX, centerY, radius, metrics) {
    const energy = Math.min(1, metrics.differenceRms * 8);
    const core = radius * (0.065 + energy * 0.025);
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.fillStyle = `rgba(17, 17, 17, ${0.76 + energy * 0.2})`;
    ctx.beginPath();
    ctx.arc(0, 0, core, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(17, 17, 17, 0.32)";
    ctx.lineWidth = 1;
    for (let index = 1; index <= 3; index += 1) {
      ctx.beginPath();
      ctx.arc(0, 0, core + index * radius * 0.05 + energy * 4, 0, TAU);
      ctx.stroke();
    }
    ctx.fillStyle = "#f6f5ef";
    ctx.font = `${Math.max(8, radius * 0.038)}px "SF Mono", ui-monospace, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("LIVE", 0, 0);
    ctx.fillStyle = "rgba(17, 17, 17, 0.62)";
    ctx.font = `${Math.max(8, radius * 0.034)}px "SF Mono", ui-monospace, monospace`;
    ctx.fillText(`CORR ${metrics.correlation.toFixed(2)}`, 0, core + radius * 0.19);
    ctx.restore();
  }

  drawModelField(ctx, x, y, radius, pairs, pace) {
    ctx.save();
    ctx.translate(x, y);
    ctx.lineWidth = 1;
    const rings = Math.max(12, Math.round(radius / 9));
    for (let index = rings; index >= 1; index -= 1) {
      const ratio = index / rings;
      const beat = pairs[index % pairs.length].difference;
      const wobble = Math.sin(pace * beat + index * 0.64) * radius * 0.018;
      const horizontal = radius * ratio + wobble;
      const vertical = radius * ratio * (0.72 + Math.sin(index * 0.4 + pace) * 0.04);
      const opacity = 0.05 + (1 - ratio) * 0.14;
      ctx.strokeStyle = `rgba(17, 17, 17, ${opacity})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, Math.max(1, horizontal), Math.max(1, vertical), Math.sin(pace * 0.1 + index) * 0.08, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawModelTraces(ctx, centerX, centerY, radius, pairs, pace, compact) {
    const edge = compact ? 18 : 42;
    const gap = radius * 0.86;
    const leftEnd = centerX - gap;
    const rightStart = centerX + gap;
    const amplitudes = compact ? 13 : 18;

    ctx.save();
    ctx.lineWidth = 1.15;
    pairs.forEach((pair, pairIndex) => {
      const offset = (pairIndex - (pairs.length - 1) / 2) * (compact ? 22 : 28);
      this.drawModelWave(ctx, edge, leftEnd, centerY + offset, pair.left, pace, amplitudes);
      this.drawModelWave(ctx, rightStart, this.width - edge, centerY + offset, pair.right, pace, amplitudes);
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

  drawModelCore(ctx, centerX, centerY, radius, pairs, pace) {
    const average = pairs.reduce((sum, pair) => sum + pair.difference, 0) / pairs.length;
    const pulse = (Math.sin(pace * average * TAU * 0.2) + 1) / 2;
    const core = radius * (0.07 + pulse * 0.025);
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.fillStyle = `rgba(17, 17, 17, ${0.72 + pulse * 0.2})`;
    ctx.beginPath();
    ctx.arc(0, 0, core, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(17, 17, 17, 0.32)";
    ctx.lineWidth = 1;
    for (let index = 1; index <= 3; index += 1) {
      ctx.beginPath();
      ctx.arc(0, 0, core + index * radius * 0.055 + pulse * 3, 0, TAU);
      ctx.stroke();
    }
    ctx.fillStyle = "#f6f5ef";
    ctx.font = `${Math.max(9, radius * 0.042)}px "SF Mono", ui-monospace, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${average.toFixed(average % 1 ? 1 : 0)} HZ`, 0, 0);
    ctx.restore();
  }
}
