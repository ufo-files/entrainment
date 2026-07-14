import { expect, test } from "@playwright/test";

test("starts the stereo engine and switches to a three-pair program", async ({ page }) => {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await expect(page.locator("#signal-canvas")).toHaveAttribute("data-visualization", "mid-side-vectorscope");
  await page.getByRole("button", { name: "Start audio" }).click();
  await expect(page.locator("body")).toHaveClass(/has-started/);
  await expect(page.locator("#status")).toHaveText("Playing binaural signal");
  await expect(page.getByRole("button", { name: "Pause audio" })).toBeVisible();
  await expect(page.locator("#telemetry-mode")).toHaveText("Live PCM");
  await expect(page.locator("#left-level")).not.toHaveText("--");
  await expect(page.locator("#right-level")).not.toHaveText("--");
  await expect(page.locator("#difference-level")).not.toHaveText("--");
  await expect.poll(async () => Number(await page.locator("#left-level").textContent())).toBeGreaterThan(-100);
  await expect.poll(async () => Number(await page.locator("#right-level").textContent())).toBeGreaterThan(-100);
  await expect.poll(async () => Number(await page.locator("#difference-level").textContent())).toBeGreaterThan(-100);
  await expect.poll(async () => Number(await page.locator("#stereo-correlation").textContent())).toBeGreaterThanOrEqual(-1);
  await expect.poll(async () => Number(await page.locator("#stereo-correlation").textContent())).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "Pause audio" }).click();
  await expect(page.locator("#status")).toHaveText("Audio paused");
  await expect(page.getByRole("button", { name: "Resume audio" })).toBeVisible();
  await expect(page.locator("#telemetry-mode")).toHaveText("Paused PCM");

  await page.getByRole("button", { name: "Resume audio" }).click();
  await expect(page.locator("#status")).toHaveText("Playing binaural signal");

  await page.getByRole("button", { name: /Fig\. 3B/ }).click();
  await expect(page.locator("#pair-readout .pair-item")).toHaveCount(3);
  await expect(page.locator("#pair-count")).toHaveText("3 carrier pairs");
  await expect(page.locator("#program-summary")).toContainText("1.5 / 4 / 6 Hz");

  await page.getByRole("button", { name: /Reference/ }).click();
  await page.getByRole("button", { name: "Open controls" }).click();
  await expect(page.locator("body")).toHaveClass(/controls-open/);
  await page.locator("#carrier-frequency").fill("120");
  await expect(page.locator("#active-program-name")).toHaveText("Custom carrier pair");
  await page.locator("#pink-level").fill("-20");
  await expect(page.locator("#pink-level-output")).toHaveText("-20 dB");
  await page.getByLabel("Spatial", { exact: true }).check();
  await expect(page.locator("#signal-canvas")).toHaveAttribute("data-presentation-mode", "spatial");
  await expect(page.locator("#signal-canvas")).toHaveAttribute("data-visualization", "spatial-soundfield");
  await expect(page.locator("#signal-canvas")).toHaveAttribute("aria-label", /current HRTF source position/);
  await expect(page.locator("#pair-count")).toHaveText("1 spatial carrier");
  await expect(page.locator("#program-summary")).toContainText("carrier / 4 Hz contour");
  await expect(page.locator("#status")).toHaveText("Playing spatial signal");
  await expect.poll(async () => Number(await page.locator("#left-level").textContent())).toBeGreaterThan(-100);
  await expect.poll(async () => Number(await page.locator("#right-level").textContent())).toBeGreaterThan(-100);

  await page.getByLabel("Binaural", { exact: true }).check();
  await expect(page.locator("#signal-canvas")).toHaveAttribute("data-visualization", "mid-side-vectorscope");

  expect(errors).toEqual([]);
});

test("mobile drawers remain inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open programs" }).click();
  await expect(page.locator("body")).toHaveClass(/programs-open/);
  await expect(page.locator("#programs-panel")).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");

  const programsBox = await page.locator("#programs-panel").boundingBox();
  expect(programsBox).not.toBeNull();
  expect(programsBox.x).toBeGreaterThanOrEqual(0);
  expect(programsBox.x + programsBox.width).toBeLessThanOrEqual(390);
  expect(programsBox.y + programsBox.height).toBeLessThanOrEqual(844);

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Open controls" }).click();
  await expect(page.locator("#controls-panel")).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  await expect(page.locator("#controls-panel")).toHaveCSS("border-right-width", "1px");
  await expect(page.locator("#controls-panel")).toHaveCSS("border-bottom-width", "1px");
  const controlsBox = await page.locator("#controls-panel").boundingBox();
  expect(controlsBox).not.toBeNull();
  expect(controlsBox.x).toBeGreaterThanOrEqual(0);
  expect(controlsBox.x + controlsBox.width).toBeLessThanOrEqual(390);
});

test("spatial HRTF motion remains free of sample discontinuities", async ({ page }) => {
  await page.goto("/");
  const metrics = await page.evaluate(async () => {
    const { AudioEngine } = await import("/audio-engine.js");
    const sampleRate = 48000;
    const context = new OfflineAudioContext(2, sampleRate * 4, sampleRate);
    const engine = new AudioEngine();
    engine.context = context;
    const spatializer = engine.createSpatializer({ panCycleSeconds: 24 });
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 100;
    gain.gain.value = 0.34;
    oscillator.connect(gain);
    gain.connect(spatializer.input);
    spatializer.output.connect(context.destination);
    oscillator.start();
    const buffer = await context.startRendering();

    return [0, 1].map((channel) => {
      const samples = buffer.getChannelData(channel);
      let roughness = 0;
      let maxJump = 0;
      for (let index = 2; index < samples.length; index += 1) {
        const jump = samples[index] - samples[index - 1];
        const previousJump = samples[index - 1] - samples[index - 2];
        roughness += (jump - previousJump) ** 2;
        maxJump = Math.max(maxJump, Math.abs(jump));
      }
      return {
        roughness: Math.sqrt(roughness / samples.length),
        maxJump,
      };
    });
  });

  for (const channel of metrics) {
    expect(channel.roughness).toBeLessThan(0.00015);
    expect(channel.maxJump).toBeLessThan(0.015);
  }
});
