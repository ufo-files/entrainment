import { expect, test } from "@playwright/test";

test("starts the stereo engine and switches to a three-pair program", async ({ page }) => {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await page.getByRole("button", { name: "Start audio" }).click();
  await expect(page.locator("body")).toHaveClass(/has-started/);
  await expect(page.locator("#status")).toHaveText("Playing stereo signal");
  await expect(page.getByRole("button", { name: "Pause audio" })).toBeVisible();
  await expect(page.locator("#telemetry-mode")).toHaveText("Live PCM");
  await expect(page.locator("#left-level")).not.toHaveText("--");
  await expect(page.locator("#right-level")).not.toHaveText("--");
  await expect.poll(async () => Number(await page.locator("#left-level").textContent())).toBeGreaterThan(-100);
  await expect.poll(async () => Number(await page.locator("#right-level").textContent())).toBeGreaterThan(-100);
  await expect.poll(async () => Number(await page.locator("#stereo-correlation").textContent())).toBeGreaterThanOrEqual(-1);
  await expect.poll(async () => Number(await page.locator("#stereo-correlation").textContent())).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "Pause audio" }).click();
  await expect(page.locator("#status")).toHaveText("Audio paused");
  await expect(page.getByRole("button", { name: "Resume audio" })).toBeVisible();
  await expect(page.locator("#telemetry-mode")).toHaveText("Paused PCM");

  await page.getByRole("button", { name: "Resume audio" }).click();
  await expect(page.locator("#status")).toHaveText("Playing stereo signal");

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
  const controlsBox = await page.locator("#controls-panel").boundingBox();
  expect(controlsBox).not.toBeNull();
  expect(controlsBox.x).toBeGreaterThanOrEqual(0);
  expect(controlsBox.x + controlsBox.width).toBeLessThanOrEqual(390);
});
