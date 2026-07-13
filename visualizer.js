import { getCarrierPairs } from "./audio-model.js";

const TAU = Math.PI * 2;

export class SignalVisualizer {
  constructor(canvas, getConfig, isRunning) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { alpha: false });
    this.getConfig = getConfig;
    this.isRunning = isRunning;
    this.width = 0;
    this.height = 0;
    this.pixelRatio = 1;
    this.elapsed = 0;
    this.lastTimestamp = null;
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
    this.draw();
    requestAnimationFrame(this.render);
  }

  draw() {
    const ctx = this.context;
    const config = this.getConfig();
    const pairs = getCarrierPairs(config);
    const compact = this.width < 720;
    const headerSpace = compact ? 86 : 96;
    const footerSpace = compact ? 182 : 180;
    const availableHeight = Math.max(180, this.height - headerSpace - footerSpace);
    const centerX = this.width / 2 + this.pointer.x * Math.min(18, this.width * 0.02);
    const centerY = headerSpace + availableHeight / 2 + this.pointer.y * 10;
    const fieldRadius = Math.min(this.width * (compact ? 0.38 : 0.28), availableHeight * 0.42, 250);
    const pace = this.elapsed * 0.55;

    ctx.fillStyle = "#f6f5ef";
    ctx.fillRect(0, 0, this.width, this.height);
    this.drawGrid(ctx, centerY, availableHeight, compact);
    this.drawChannelLabels(ctx, centerY, fieldRadius, pairs, compact);
    this.drawCarrierField(ctx, centerX, centerY, fieldRadius, pairs, pace);
    this.drawTraces(ctx, centerX, centerY, fieldRadius, pairs, pace, compact);
    this.drawDifference(ctx, centerX, centerY, fieldRadius, pairs, pace);
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

  drawChannelLabels(ctx, centerY, radius, pairs, compact) {
    const primary = pairs[0];
    ctx.save();
    ctx.fillStyle = "rgba(17, 17, 17, 0.58)";
    ctx.font = `${compact ? 10 : 11}px "SF Mono", ui-monospace, monospace`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(`L  ${primary.left.toFixed(primary.left % 1 ? 1 : 0)} HZ`, compact ? 20 : 42, centerY - radius - 28);
    ctx.textAlign = "right";
    ctx.fillText(`R  ${primary.right.toFixed(primary.right % 1 ? 1 : 0)} HZ`, this.width - (compact ? 20 : 42), centerY - radius - 28);
    ctx.restore();
  }

  drawCarrierField(ctx, x, y, radius, pairs, pace) {
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

  drawTraces(ctx, centerX, centerY, radius, pairs, pace, compact) {
    const edge = compact ? 18 : 42;
    const gap = radius * 0.86;
    const leftEnd = centerX - gap;
    const rightStart = centerX + gap;
    const amplitudes = compact ? 13 : 18;

    ctx.save();
    ctx.lineWidth = 1.15;
    pairs.forEach((pair, pairIndex) => {
      const offset = (pairIndex - (pairs.length - 1) / 2) * (compact ? 22 : 28);
      this.drawWave(ctx, edge, leftEnd, centerY + offset, pair.left, pace, amplitudes, "rgba(17, 17, 17, 0.72)");
      this.drawWave(ctx, rightStart, this.width - edge, centerY + offset, pair.right, pace, amplitudes, "rgba(17, 17, 17, 0.72)");
    });
    ctx.restore();
  }

  drawWave(ctx, startX, endX, y, frequency, pace, amplitude, stroke) {
    const width = Math.max(1, endX - startX);
    const cycles = Math.max(2, width / 46) * (0.72 + frequency / 420);
    ctx.strokeStyle = stroke;
    ctx.beginPath();
    for (let step = 0; step <= Math.ceil(width); step += 2) {
      const ratio = step / width;
      const envelope = Math.sin(Math.PI * ratio) * 0.45 + 0.55;
      const wave = Math.sin(ratio * TAU * cycles - pace * (frequency / 24));
      const x = startX + step;
      const pointY = y + wave * amplitude * envelope;
      if (step === 0) ctx.moveTo(x, pointY);
      else ctx.lineTo(x, pointY);
    }
    ctx.stroke();
  }

  drawDifference(ctx, centerX, centerY, radius, pairs, pace) {
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
