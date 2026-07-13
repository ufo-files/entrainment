import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import process from "node:process";

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
  stdio: "ignore",
});

const waitForServer = async () => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(BASE_URL);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Screenshot server did not start.");
};

try {
  await waitForServer();
  await mkdir("screenshots", { recursive: true });
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const captures = [
    { name: "entrainment-desktop.png", viewport: { width: 1440, height: 1000 } },
    { name: "entrainment-mobile.png", viewport: { width: 390, height: 844 } },
  ];

  for (const capture of captures) {
    const page = await browser.newPage({ viewport: capture.viewport, deviceScaleFactor: 1 });
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Start audio" }).click();
    await page.locator("body.has-started").waitFor();
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      const style = document.createElement("style");
      style.textContent = "html::after{content:'';position:fixed;inset:0;border:1px solid #111;pointer-events:none;z-index:2147483647}";
      document.head.appendChild(style);
    });
    const pixelSample = await page.locator("#signal-canvas").evaluate((canvas) => {
      const context = canvas.getContext("2d");
      const x = Math.floor(canvas.width / 2);
      const y = Math.floor(canvas.height / 2);
      return [...context.getImageData(x, y, 1, 1).data];
    });
    if (pixelSample[3] === 0) throw new Error(`Blank canvas detected for ${capture.name}`);
    await page.screenshot({ path: `screenshots/${capture.name}`, fullPage: false });
    await page.close();
  }
  await browser.close();
} finally {
  server.kill("SIGTERM");
}

process.exit(0);
