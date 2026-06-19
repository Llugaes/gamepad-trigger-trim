const STORAGE_KEY = "trigger-trim.profiles.v1";
const MAX_DISPLAY = 32767;
const TRIGGERS = ["lt", "rt"];
const QUERY = new URLSearchParams(window.location.search);
const MOCK_MODE = QUERY.has("mock");
const DEFAULT_PROFILE = {
  schema: "trigger-trim-profile.v1",
  lt: { source: { type: "button", index: 6 }, min: 0, max: 1, curve: 1 },
  rt: { source: { type: "button", index: 7 }, min: 0, max: 1, curve: 1 },
};

const state = {
  selectedIndex: null,
  profileKey: null,
  profile: structuredClone(DEFAULT_PROFILE),
  profiles: loadProfiles(),
  lastValues: { lt: 0, rt: 0 },
  capture: null,
  lastRenderKey: "",
};

const dom = {
  apiStatus: document.getElementById("apiStatus"),
  secureStatus: document.getElementById("secureStatus"),
  refreshBtn: document.getElementById("refreshBtn"),
  deviceList: document.getElementById("deviceList"),
  connectHint: document.getElementById("connectHint"),
  selectedName: document.getElementById("selectedName"),
  selectedMeta: document.getElementById("selectedMeta"),
  telemetryTable: document.getElementById("telemetryTable"),
  curveCanvas: document.getElementById("curveCanvas"),
  saveProfileBtn: document.getElementById("saveProfileBtn"),
  copyProfileBtn: document.getElementById("copyProfileBtn"),
  downloadProfileBtn: document.getElementById("downloadProfileBtn"),
  importProfileBtn: document.getElementById("importProfileBtn"),
  importFile: document.getElementById("importFile"),
  profileStatus: document.getElementById("profileStatus"),
  captureStatus: document.getElementById("captureStatus"),
};

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));
}

function toInt(value) {
  return Math.round(clamp(value) * MAX_DISPLAY);
}

function fromInt(value) {
  return clamp(Number(value) / MAX_DISPLAY);
}

function shortName(id) {
  if (!id) return "Unknown gamepad";
  return id.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
}

function loadProfiles() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveProfiles() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.profiles));
}

function getPads() {
  if (MOCK_MODE) return [mockGamepad()];
  if (!("getGamepads" in navigator)) return [];
  return Array.from(navigator.getGamepads()).filter(Boolean);
}

function mockGamepad() {
  const lt = fromInt(Number(QUERY.get("lt") ?? 26000));
  const rt = fromInt(Number(QUERY.get("rt") ?? 28000));
  const makeButton = (value) => ({ pressed: value > 0.05, touched: value > 0.05, value });
  return {
    id: "Mock Xbox Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)",
    index: 0,
    connected: true,
    mapping: "standard",
    timestamp: Date.now(),
    buttons: Array.from({ length: 17 }, (_, index) => {
      if (index === 6) return makeButton(lt);
      if (index === 7) return makeButton(rt);
      return makeButton(0);
    }),
    axes: [0, 0, 0, 0],
  };
}

function getSelectedPad() {
  if (state.selectedIndex === null) return null;
  return getPads().find((pad) => pad.index === state.selectedIndex) ?? null;
}

function profileKeyFor(pad) {
  return `${pad.id}|${pad.mapping || "raw"}|b${pad.buttons.length}|a${pad.axes.length}`;
}

function normalizeProfile(profile) {
  const merged = structuredClone(DEFAULT_PROFILE);
  for (const trigger of TRIGGERS) {
    const source = profile?.[trigger]?.source;
    if (source && (source.type === "button" || source.type === "axis")) {
      merged[trigger].source = {
        type: source.type,
        index: Number.isFinite(source.index) ? source.index : merged[trigger].source.index,
      };
    }
    merged[trigger].min = clamp(Number(profile?.[trigger]?.min ?? merged[trigger].min), 0, 0.95);
    merged[trigger].max = clamp(Number(profile?.[trigger]?.max ?? merged[trigger].max), 0.05, 1);
    merged[trigger].curve = clamp(Number(profile?.[trigger]?.curve ?? 1), 0.5, 2.5);
    if (merged[trigger].max <= merged[trigger].min + 0.02) {
      merged[trigger].max = clamp(merged[trigger].min + 0.02, 0.05, 1);
    }
  }
  return merged;
}

function selectPad(index) {
  const pad = getPads().find((item) => item.index === index);
  if (!pad) return;
  state.selectedIndex = pad.index;
  state.profileKey = profileKeyFor(pad);
  state.profile = normalizeProfile(state.profiles[state.profileKey]);
  renderSourceOptions(pad);
  syncControls();
  renderDevices();
  renderSelected(pad);
  drawCurve();
}

function ensureSelection() {
  const pads = getPads();
  if (!pads.length) {
    state.selectedIndex = null;
    state.profileKey = null;
    return null;
  }
  const selected = getSelectedPad();
  if (selected) return selected;
  selectPad(pads[0].index);
  return getSelectedPad();
}

function sourceValue(source) {
  return `${source.type}:${source.index}`;
}

function parseSource(value) {
  const [type, index] = String(value).split(":");
  return { type, index: Number(index) };
}

function sourceLabel(source, trigger) {
  if (source.type === "button") {
    const standard = source.index === 6 ? "LT" : source.index === 7 ? "RT" : `B${source.index}`;
    return `按钮 ${source.index} · ${standard}`;
  }
  return `Axis ${source.index} · -1..1`;
}

function renderSourceOptions(pad) {
  for (const trigger of TRIGGERS) {
    const select = document.querySelector(`.source-select[data-trigger="${trigger}"]`);
    const current = state.profile[trigger].source;
    const options = [];
    pad.buttons.forEach((_, index) => {
      options.push({ type: "button", index });
    });
    pad.axes.forEach((_, index) => {
      options.push({ type: "axis", index });
    });
    select.innerHTML = options
      .map((source) => `<option value="${sourceValue(source)}">${sourceLabel(source, trigger)}</option>`)
      .join("");
    select.value = sourceValue(current);
    if (!select.value && select.options.length) {
      select.selectedIndex = 0;
      state.profile[trigger].source = parseSource(select.value);
    }
  }
}

function readRaw(pad, trigger) {
  const source = state.profile[trigger].source;
  if (source.type === "button") {
    return clamp(pad.buttons[source.index]?.value ?? 0);
  }
  return clamp(((pad.axes[source.index] ?? -1) + 1) / 2);
}

function mapTrigger(raw, config) {
  const min = clamp(config.min, 0, 0.95);
  const max = Math.max(clamp(config.max), min + 0.001);
  const normalized = clamp((raw - min) / (max - min));
  return Math.pow(normalized, config.curve);
}

function exportProfile(pad = getSelectedPad()) {
  return {
    schema: "trigger-trim-profile.v1",
    generatedAt: new Date().toISOString(),
    device: pad
      ? {
          id: pad.id,
          index: pad.index,
          mapping: pad.mapping,
          buttons: pad.buttons.length,
          axes: pad.axes.length,
          profileKey: profileKeyFor(pad),
        }
      : null,
    formula: "output = pow(clamp((raw - min) / (comfortMax - min), 0, 1), curve)",
    profile: {
      lt: structuredClone(state.profile.lt),
      rt: structuredClone(state.profile.rt),
    },
  };
}

function persistCurrentProfile(showStatus = false) {
  if (!state.profileKey) return;
  state.profiles[state.profileKey] = {
    schema: "trigger-trim-profile.v1",
    updatedAt: new Date().toISOString(),
    lt: structuredClone(state.profile.lt),
    rt: structuredClone(state.profile.rt),
  };
  saveProfiles();
  if (showStatus) {
    setStatus("Profile 已保存到当前浏览器。");
  }
}

function setStatus(text) {
  dom.profileStatus.textContent = text;
  window.clearTimeout(setStatus.timer);
  setStatus.timer = window.setTimeout(() => {
    dom.profileStatus.textContent = "Profile 自动保存到当前浏览器。";
  }, 2600);
}

function renderDevices() {
  const pads = getPads();
  dom.connectHint.hidden = pads.length > 0;
  if (!pads.length) {
    dom.deviceList.innerHTML = "";
    return;
  }
  dom.deviceList.innerHTML = pads
    .map((pad) => {
      const active = pad.index === state.selectedIndex ? " active" : "";
      return `
        <button type="button" class="device-item${active}" data-index="${pad.index}">
          <span class="device-name">${escapeHtml(shortName(pad.id))}</span>
          <span class="device-meta">#${pad.index} · ${pad.mapping || "raw"} · ${pad.buttons.length} buttons · ${pad.axes.length} axes</span>
        </button>
      `;
    })
    .join("");
}

function renderSelected(pad) {
  if (!pad) {
    dom.selectedName.textContent = "未选择手柄";
    dom.selectedMeta.textContent = "等待输入";
    return;
  }
  dom.selectedName.textContent = shortName(pad.id);
  dom.selectedMeta.textContent = `index ${pad.index} · ${pad.mapping || "raw"} · ${pad.buttons.length} buttons · ${pad.axes.length} axes`;
}

function syncControls() {
  for (const trigger of TRIGGERS) {
    const config = state.profile[trigger];
    setControl(trigger, "min", config.min);
    setControl(trigger, "max", config.max);
    setControl(trigger, "curve", config.curve);
    setControl(trigger, "minInt", toInt(config.min));
    setControl(trigger, "maxInt", toInt(config.max));
    setControl(trigger, "curveNum", config.curve.toFixed(2));
    const readout = document.getElementById(`${trigger}Readout`);
    readout.textContent = `舒适满值 ${toInt(config.max)} · ${(config.max * 100).toFixed(1)}%`;
  }
}

function setControl(trigger, prop, value) {
  const input = document.querySelector(`[data-trigger="${trigger}"][data-prop="${prop}"]`);
  if (input) input.value = value;
}

function renderLoop() {
  updateStatuses();
  const pad = ensureSelection();
  const pads = getPads();
  const renderKey = pads.map((item) => `${item.index}:${item.id}:${item.buttons.length}:${item.axes.length}`).join("|");
  if (renderKey !== state.lastRenderKey) {
    state.lastRenderKey = renderKey;
    renderDevices();
    if (pad) {
      renderSelected(pad);
      renderSourceOptions(pad);
      syncControls();
    } else {
      renderSelected(null);
    }
  }
  if (pad) updateLiveValues(pad);
  requestAnimationFrame(renderLoop);
}

function updateStatuses() {
  const hasApi = MOCK_MODE || "getGamepads" in navigator;
  dom.apiStatus.textContent = MOCK_MODE ? "Mock Gamepad" : hasApi ? "Gamepad API 可用" : "Gamepad API 不可用";
  dom.apiStatus.classList.toggle("status-ok", hasApi);
  const secure = window.isSecureContext || location.hostname === "127.0.0.1" || location.hostname === "localhost";
  dom.secureStatus.textContent = secure ? "安全上下文" : "需要 HTTPS";
  dom.secureStatus.classList.toggle("status-ok", secure);
  dom.secureStatus.classList.toggle("status-warn", !secure);
}

function updateLiveValues(pad) {
  const telemetry = [];
  for (const trigger of TRIGGERS) {
    const raw = readRaw(pad, trigger);
    const mapped = mapTrigger(raw, state.profile[trigger]);
    state.lastValues[trigger] = raw;
    updateMeters(trigger, raw, mapped);
    telemetry.push({ key: trigger.toUpperCase(), raw, mapped });
  }
  updateCapture(pad);
  renderTelemetry(pad, telemetry);
}

function updateMeters(trigger, raw, mapped) {
  document.getElementById(`${trigger}RawText`).textContent = `${toInt(raw)} / ${MAX_DISPLAY}`;
  document.getElementById(`${trigger}MappedText`).textContent = `${toInt(mapped)} / ${MAX_DISPLAY}`;
  document.getElementById(`${trigger}RawFill`).style.width = `${raw * 100}%`;
  document.getElementById(`${trigger}MappedFill`).style.width = `${mapped * 100}%`;
}

function renderTelemetry(pad, triggerRows) {
  const buttonRows = pad.buttons.slice(0, 18).map((button, index) => ({
    key: `B${index}`,
    raw: button.value,
    mapped: button.pressed ? 1 : button.value,
  }));
  const axisRows = pad.axes.slice(0, 8).map((axis, index) => ({
    key: `A${index}`,
    raw: clamp((axis + 1) / 2),
    mapped: clamp((axis + 1) / 2),
    label: axis.toFixed(3),
  }));
  const rows = [...triggerRows, ...buttonRows, ...axisRows];
  dom.telemetryTable.innerHTML = rows
    .map((row) => {
      const value = row.label ?? toInt(row.raw);
      return `
        <div class="telemetry-row">
          <code>${row.key}</code>
          <div class="spark" aria-hidden="true"><span style="width:${row.raw * 100}%"></span></div>
          <span>${value}</span>
        </div>
      `;
    })
    .join("");
}

function updateCapture(pad) {
  if (!state.capture) {
    dom.captureStatus.textContent = "";
    return;
  }
  const now = performance.now();
  const raw = readRaw(pad, state.capture.trigger);
  state.capture.best = Math.max(state.capture.best, raw);
  const left = Math.max(0, state.capture.until - now);
  dom.captureStatus.textContent = `${state.capture.trigger.toUpperCase()} 采样中 ${(left / 1000).toFixed(1)}s`;
  document
    .querySelector(`.trigger-strip[data-trigger="${state.capture.trigger}"]`)
    ?.classList.add("capture-active");
  if (now >= state.capture.until) {
    const { trigger, best } = state.capture;
    state.profile[trigger].max = clamp(Math.max(best, state.profile[trigger].min + 0.02), 0.05, 1);
    state.capture = null;
    document.querySelectorAll(".capture-active").forEach((item) => item.classList.remove("capture-active"));
    syncControls();
    persistCurrentProfile(true);
    drawCurve();
    setStatus(`${trigger.toUpperCase()} 舒适满值已设为 ${toInt(best)}。`);
  }
}

function drawCurve() {
  const canvas = dom.curveCanvas;
  const ctx = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const pad = 28;
  const plotW = width - pad * 2;
  const plotH = height - pad * 2;
  ctx.strokeStyle = "#d7dfdb";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 4; i += 1) {
    const x = pad + (plotW * i) / 4;
    const y = pad + (plotH * i) / 4;
    ctx.moveTo(x, pad);
    ctx.lineTo(x, pad + plotH);
    ctx.moveTo(pad, y);
    ctx.lineTo(pad + plotW, y);
  }
  ctx.stroke();

  drawTriggerCurve(ctx, "lt", width, height, pad, "#b56a00");
  drawTriggerCurve(ctx, "rt", width, height, pad, "#007c70");
  ctx.fillStyle = "#17201d";
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillText("LT", pad + 8, pad + 16);
  ctx.fillText("RT", pad + 44, pad + 16);
}

function drawTriggerCurve(ctx, trigger, width, height, pad, color) {
  const config = state.profile[trigger];
  const plotW = width - pad * 2;
  const plotH = height - pad * 2;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i <= 140; i += 1) {
    const raw = i / 140;
    const mapped = mapTrigger(raw, config);
    const x = pad + raw * plotW;
    const y = pad + (1 - mapped) * plotH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function handleControlInput(event) {
  const input = event.target;
  const trigger = input.dataset.trigger;
  const prop = input.dataset.prop;
  if (!trigger || !prop) return;
  const config = state.profile[trigger];
  if (prop === "min") config.min = clamp(Number(input.value), 0, 0.95);
  if (prop === "max") config.max = clamp(Number(input.value), 0.05, 1);
  if (prop === "curve") config.curve = clamp(Number(input.value), 0.5, 2.5);
  if (prop === "minInt") config.min = fromInt(input.value);
  if (prop === "maxInt") config.max = fromInt(input.value);
  if (prop === "curveNum") config.curve = clamp(Number(input.value), 0.5, 2.5);
  if (config.max <= config.min + 0.02) {
    config.max = clamp(config.min + 0.02, 0.05, 1);
  }
  syncControls();
  persistCurrentProfile();
  drawCurve();
}

function handleAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const trigger = button.dataset.trigger;
  const action = button.dataset.action;
  const config = state.profile[trigger];
  const raw = state.lastValues[trigger] ?? 0;
  if (action === "set-min") config.min = clamp(Math.min(raw, config.max - 0.02), 0, 0.95);
  if (action === "set-max") config.max = clamp(Math.max(raw, config.min + 0.02), 0.05, 1);
  if (action === "capture-max") {
    state.capture = { trigger, best: raw, until: performance.now() + 1800 };
  }
  if (action === "reset") {
    const source = config.source;
    state.profile[trigger] = structuredClone(DEFAULT_PROFILE[trigger]);
    state.profile[trigger].source = source;
  }
  syncControls();
  persistCurrentProfile(true);
  drawCurve();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function copyProfile() {
  const json = JSON.stringify(exportProfile(), null, 2);
  await navigator.clipboard.writeText(json);
  setStatus("Profile JSON 已复制。");
}

function downloadProfile() {
  const pad = getSelectedPad();
  const name = pad ? shortName(pad.id).replace(/[^\w.-]+/g, "-").slice(0, 50) : "profile";
  const blob = new Blob([JSON.stringify(exportProfile(pad), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name || "profile"}-trigger-trim.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus("Profile JSON 已下载。");
}

function importProfile(file) {
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const data = JSON.parse(String(reader.result));
      const imported = normalizeProfile(data.profile ?? data);
      state.profile = imported;
      persistCurrentProfile(true);
      syncControls();
      drawCurve();
      setStatus("Profile JSON 已导入。");
    } catch {
      setStatus("导入失败：JSON 格式不正确。");
    }
  });
  reader.readAsText(file);
}

function bindEvents() {
  dom.refreshBtn.addEventListener("click", () => {
    ensureSelection();
    renderDevices();
  });
  dom.deviceList.addEventListener("click", (event) => {
    const item = event.target.closest(".device-item");
    if (item) selectPad(Number(item.dataset.index));
  });
  document.addEventListener("input", handleControlInput);
  document.addEventListener("click", handleAction);
  document.querySelectorAll(".source-select").forEach((select) => {
    select.addEventListener("change", (event) => {
      const trigger = event.target.dataset.trigger;
      state.profile[trigger].source = parseSource(event.target.value);
      persistCurrentProfile(true);
      drawCurve();
    });
  });
  window.addEventListener("gamepadconnected", (event) => {
    selectPad(event.gamepad.index);
  });
  window.addEventListener("gamepaddisconnected", () => {
    ensureSelection();
    renderDevices();
  });
  window.addEventListener("resize", drawCurve);
  dom.saveProfileBtn.addEventListener("click", () => persistCurrentProfile(true));
  dom.copyProfileBtn.addEventListener("click", copyProfile);
  dom.downloadProfileBtn.addEventListener("click", downloadProfile);
  dom.importProfileBtn.addEventListener("click", () => dom.importFile.click());
  dom.importFile.addEventListener("change", (event) => {
    const [file] = event.target.files;
    if (file) importProfile(file);
    event.target.value = "";
  });
}

bindEvents();
syncControls();
drawCurve();
renderLoop();
