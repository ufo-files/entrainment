import {
  DEFAULT_CONFIG,
  PROGRAMS,
  formatElapsed,
  formatFrequency,
  getCarrierPairs,
  sanitizeConfig,
} from "./audio-model.js";
import { AudioEngine } from "./audio-engine.js";
import { SignalVisualizer } from "./visualizer.js";

const elements = {
  signalCanvas: document.querySelector("#signal-canvas"),
  appSwitcher: document.querySelector("#app-switcher"),
  status: document.querySelector("#status"),
  sessionTime: document.querySelector("#session-time"),
  pairCount: document.querySelector("#pair-count"),
  telemetryMode: document.querySelector("#telemetry-mode"),
  leftLevel: document.querySelector("#left-level"),
  rightLevel: document.querySelector("#right-level"),
  differenceLevel: document.querySelector("#difference-level"),
  stereoCorrelation: document.querySelector("#stereo-correlation"),
  bottomTransportToggle: document.querySelector("#bottom-transport-toggle"),
  bottomTransportLabel: document.querySelector("#bottom-transport-label"),
  controlsToggle: document.querySelector("#controls-menu-toggle"),
  controlsPanel: document.querySelector("#controls-panel"),
  aboutToggle: document.querySelector("#about-toggle"),
  aboutPanel: document.querySelector("#about-panel"),
  programsToggle: document.querySelector("#programs-toggle"),
  programsPanel: document.querySelector("#programs-panel"),
  activeProgramName: document.querySelector("#active-program-name"),
  programSummary: document.querySelector("#program-summary"),
  pairReadout: document.querySelector("#pair-readout"),
  customFields: document.querySelector("#custom-fields"),
  customFieldsLegend: document.querySelector("#custom-fields-legend"),
  presentationModes: [...document.querySelectorAll('input[name="presentation-mode"]')],
  carrierFrequencyLabel: document.querySelector("#carrier-frequency-label"),
  beatFrequencyLabel: document.querySelector("#beat-frequency-label"),
  carrierFrequency: document.querySelector("#carrier-frequency"),
  beatFrequency: document.querySelector("#beat-frequency"),
  contourShape: document.querySelector("#contour-shape"),
  contourDepth: document.querySelector("#contour-depth"),
  contourDepthOutput: document.querySelector("#contour-depth-output"),
  pinkEnabled: document.querySelector("#pink-enabled"),
  pinkLevel: document.querySelector("#pink-level"),
  pinkLevelOutput: document.querySelector("#pink-level-output"),
  panCycle: document.querySelector("#pan-cycle"),
  panCycleOutput: document.querySelector("#pan-cycle-output"),
  volume: document.querySelector("#volume"),
  transportToggle: document.querySelector("#transport-toggle"),
  audioToggle: document.querySelector("#audio-toggle"),
  audioToggleLabel: document.querySelector("#audio-toggle-label"),
  reset: document.querySelector("#reset"),
  programButtons: [...document.querySelectorAll("[data-program]")],
};

let config = { ...DEFAULT_CONFIG };
let startedAt = 0;
let accumulatedSeconds = 0;
let clockTimer = null;

const engine = new AudioEngine((error) => {
  elements.status.textContent = `Audio error: ${error.message}`;
  document.body.classList.add("audio-error");
});

new SignalVisualizer(
  document.querySelector("#signal-canvas"),
  () => config,
  () => engine.running || !document.body.classList.contains("has-started"),
  () => engine.readTelemetry(),
  () => engine.readSpatialState(),
  (metrics, mode) => {
    elements.telemetryMode.textContent = mode === "live" ? "Live PCM" : mode === "paused" ? "Paused PCM" : "Model";
    elements.telemetryMode.dataset.mode = mode;
    if (!metrics) {
      elements.leftLevel.textContent = "--";
      elements.rightLevel.textContent = "--";
      elements.differenceLevel.textContent = "--";
      elements.stereoCorrelation.textContent = "--";
      return;
    }
    elements.leftLevel.textContent = metrics.leftDbfs.toFixed(1);
    elements.rightLevel.textContent = metrics.rightDbfs.toFixed(1);
    elements.differenceLevel.textContent = metrics.differenceDbfs.toFixed(1);
    elements.stereoCorrelation.textContent = metrics.correlation.toFixed(2);
  },
);

function syncConfigFromControls() {
  config = sanitizeConfig({
    ...config,
    presentationMode: elements.presentationModes.find((input) => input.checked)?.value,
    carrierFrequency: elements.carrierFrequency.value,
    beatFrequency: elements.beatFrequency.value,
    contourShape: elements.contourShape.value,
    contourDepth: elements.contourDepth.value,
    pinkEnabled: elements.pinkEnabled.checked,
    pinkLevelDb: elements.pinkLevel.value,
    panCycleSeconds: elements.panCycle.value,
    volume: elements.volume.value,
  });
  renderState();
  engine.applyConfig(config);
  if (engine.running) elements.status.textContent = `Playing ${config.presentationMode} signal`;
}

function selectProgram(programId) {
  if (!Object.hasOwn(PROGRAMS, programId)) return;
  config = sanitizeConfig({ ...config, program: programId });
  elements.programButtons.forEach((button) => {
    const active = button.dataset.program === programId;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  renderState();
  engine.applyConfig(config);
}

function renderState() {
  const program = PROGRAMS[config.program];
  const pairs = getCarrierPairs(config);
  const isSpatial = config.presentationMode === "spatial";
  const isModifiedReference = config.program === "reference"
    && (config.carrierFrequency !== DEFAULT_CONFIG.carrierFrequency || config.beatFrequency !== DEFAULT_CONFIG.beatFrequency);
  elements.activeProgramName.textContent = isModifiedReference ? "Custom carrier pair" : program.name;
  elements.customFields.disabled = config.program !== "reference";
  elements.customFieldsLegend.textContent = isSpatial ? "Custom spatial carrier" : "Custom carrier pair";
  elements.carrierFrequencyLabel.textContent = isSpatial ? "Base carrier" : "Left carrier";
  elements.beatFrequencyLabel.textContent = isSpatial ? "Contour rate" : "Difference";
  elements.signalCanvas.dataset.presentationMode = config.presentationMode;
  elements.signalCanvas.dataset.visualization = isSpatial ? "spatial-soundfield" : "mid-side-vectorscope";
  elements.signalCanvas.setAttribute(
    "aria-label",
    isSpatial
      ? "Immersive spatial soundfield with live PCM rings and the current HRTF source position"
      : "Stereo signal model with live left and right PCM traces and a normalized mid-side vectorscope",
  );
  elements.programSummary.textContent = isSpatial
    ? pairs.length === 1
      ? `${formatFrequency(pairs[0].left)} carrier / ${formatFrequency(pairs[0].difference)} contour`
      : `${pairs.length} carriers / ${pairs.map((pair) => formatFrequency(pair.difference)).join(" / ")} contours`
    : config.program === "reference"
      ? `${formatFrequency(pairs[0].left)} left / ${formatFrequency(pairs[0].right)} right`
      : program.citation;
  elements.pairCount.textContent = isSpatial
    ? `${pairs.length} spatial ${pairs.length === 1 ? "carrier" : "carriers"}`
    : `${pairs.length} carrier ${pairs.length === 1 ? "pair" : "pairs"}`;
  elements.contourDepthOutput.textContent = `${Math.round(config.contourDepth * 100)}%`;
  elements.pinkLevelOutput.textContent = `${config.pinkLevelDb} dB`;
  elements.panCycleOutput.textContent = `${config.panCycleSeconds} sec`;
  elements.pairReadout.replaceChildren(...pairs.map((pair, index) => {
    const item = document.createElement("div");
    item.className = "pair-item";
    item.innerHTML = isSpatial
      ? `<span>Carrier ${index + 1}</span><b>${formatFrequency(pair.left)}</b><small>Contour ${formatFrequency(pair.difference)}</small>`
      : `<span>Pair ${index + 1}</span><b>${formatFrequency(pair.left)} <i aria-hidden="true">/</i> ${formatFrequency(pair.right)}</b><small>&Delta; ${formatFrequency(pair.difference)}</small>`;
    return item;
  }));
}

function setControlsOpen(open) {
  document.body.classList.toggle("controls-open", open);
  elements.controlsToggle.setAttribute("aria-expanded", String(open));
  elements.controlsToggle.setAttribute("aria-label", open ? "Close controls" : "Open controls");
}

function setProgramsOpen(open) {
  document.body.classList.toggle("programs-open", open);
  elements.programsToggle.setAttribute("aria-expanded", String(open));
}

function setRunning(running) {
  document.body.classList.toggle("audio-paused", !running);
  elements.bottomTransportToggle.setAttribute("aria-label", running ? "Pause audio" : "Resume audio");
  elements.bottomTransportToggle.title = running ? "Pause audio" : "Resume audio";
  elements.bottomTransportLabel.textContent = running ? "Pause audio" : "Resume audio";
  elements.bottomTransportToggle.querySelector(".control-mark").className = `control-mark ${running ? "pause-mark" : "play-mark"}`;
  elements.transportToggle.hidden = false;
  elements.transportToggle.setAttribute("aria-label", running ? "Pause audio" : "Resume audio");
  elements.transportToggle.title = running ? "Pause audio" : "Resume audio";
  elements.transportToggle.querySelector(".control-mark").className = `control-mark ${running ? "pause-mark" : "play-mark"}`;
  elements.audioToggleLabel.textContent = running ? "Pause" : "Resume";
  elements.audioToggle.querySelector(".control-mark").className = `control-mark ${running ? "pause-mark" : "play-mark"}`;
  elements.status.textContent = running
    ? `Playing ${config.presentationMode} signal`
    : "Audio paused";
}

function updateClock() {
  const live = engine.running ? (performance.now() - startedAt) / 1000 : 0;
  elements.sessionTime.textContent = formatElapsed(accumulatedSeconds + live);
}

async function startAudio() {
  await engine.start(config);
  document.body.classList.add("has-started");
  startedAt = performance.now();
  setRunning(true);
  updateClock();
  clockTimer = window.setInterval(updateClock, 1000);
}

async function toggleAudio() {
  if (!engine.context) {
    await startAudio();
    return;
  }
  if (engine.running) {
    accumulatedSeconds += (performance.now() - startedAt) / 1000;
    await engine.pause();
    setRunning(false);
  } else {
    await engine.resume();
    startedAt = performance.now();
    setRunning(true);
  }
  updateClock();
}

function resetSession() {
  config = { ...DEFAULT_CONFIG };
  accumulatedSeconds = 0;
  startedAt = performance.now();
  elements.carrierFrequency.value = config.carrierFrequency;
  elements.beatFrequency.value = config.beatFrequency;
  elements.contourShape.value = config.contourShape;
  elements.contourDepth.value = config.contourDepth;
  elements.pinkEnabled.checked = config.pinkEnabled;
  elements.pinkLevel.value = config.pinkLevelDb;
  elements.panCycle.value = config.panCycleSeconds;
  elements.volume.value = config.volume;
  elements.presentationModes.forEach((input) => {
    input.checked = input.value === config.presentationMode;
  });
  selectProgram(config.program);
  updateClock();
}

elements.bottomTransportToggle.addEventListener("click", () => toggleAudio());
elements.transportToggle.addEventListener("click", () => toggleAudio());
elements.audioToggle.addEventListener("click", () => toggleAudio());
elements.reset.addEventListener("click", resetSession);
elements.controlsToggle.addEventListener("click", () => {
  setControlsOpen(!document.body.classList.contains("controls-open"));
});
elements.programsToggle.addEventListener("click", () => {
  setProgramsOpen(!document.body.classList.contains("programs-open"));
});
elements.aboutToggle.addEventListener("click", () => {
  const open = elements.aboutPanel.hidden;
  elements.aboutPanel.hidden = !open;
  elements.aboutToggle.setAttribute("aria-expanded", String(open));
});
elements.appSwitcher.addEventListener("change", (event) => {
  window.location.href = event.target.value;
});
elements.programButtons.forEach((button) => {
  button.addEventListener("click", () => selectProgram(button.dataset.program));
});
elements.presentationModes.forEach((input) => {
  input.addEventListener("change", syncConfigFromControls);
});

for (const input of [
  elements.carrierFrequency,
  elements.beatFrequency,
  elements.contourShape,
  elements.contourDepth,
  elements.pinkEnabled,
  elements.pinkLevel,
  elements.panCycle,
  elements.volume,
]) {
  input.addEventListener("input", syncConfigFromControls);
  input.addEventListener("change", syncConfigFromControls);
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setControlsOpen(false);
    setProgramsOpen(false);
  }
  if (event.code === "Space" && document.body.classList.contains("has-started") && !event.target.matches("input, select, button")) {
    event.preventDefault();
    toggleAudio();
  }
});

window.addEventListener("beforeunload", () => {
  if (clockTimer) window.clearInterval(clockTimer);
});

renderState();
