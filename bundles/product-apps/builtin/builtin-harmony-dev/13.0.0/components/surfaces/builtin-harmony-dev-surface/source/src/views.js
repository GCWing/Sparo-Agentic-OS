import { projectSummary, recommendedEmulator, selectedEmulator, targetState } from "./model.js";
import { selectionSummary } from "./preview/selection-overlay.js";
import { state } from "./state.js";
import { asArray, escapeHtml, formatTime, primaryDiagnostic, shortPath, t, workspaceLabel } from "./util.js";

function attrDisabled(condition) {
  return condition ? "disabled" : "";
}

function diagnostics() {
  return [
    ...asArray(state.diagnostics),
    ...asArray(state.build?.diagnostics),
    ...asArray(state.runtimeState?.diagnostics)
  ].slice(0, 6);
}

function emulatorLabel(emulator) {
  return [
    emulator?.name,
    emulator?.osVersion || emulator?.apiVersion,
    emulator?.deviceType
  ].filter(Boolean).join(" / ") || "-";
}

function selectedDevice() {
  const emulators = asArray(state.emulators);
  const recommended = state.recommendedEmulator || recommendedEmulator(emulators);
  const explicit = state.selectedEmulatorName ? selectedEmulator(emulators, state.selectedEmulatorName) : null;
  return explicit || emulators.find((item) => item?.isRunning) || recommended;
}

function productTitle(project) {
  const summary = projectSummary(project);
  const raw = String(summary.productName || "").trim();
  if (!raw || raw.startsWith("$")) return summary.bundleName || t("appTitle");
  return raw;
}

function statusModel() {
  const project = projectSummary(state.project);
  const target = targetState(state.targets);
  const diag = primaryDiagnostic();
  const emulator = selectedDevice();
  if (state.error) return { tone: "danger", label: state.error, detail: diag?.message || state.error };
  if (state.loading) return { tone: "busy", label: state.action || t("detecting"), detail: t("detecting") };
  if (state.project?.status === "notFound") return { tone: "warn", label: t("noProject"), detail: workspaceLabel() };
  if (target.target) return { tone: "success", label: t("targetReady"), detail: target.target.id || target.target.serial || project.bundleName };
  if (emulator) return { tone: "warn", label: t("emulatorReady"), detail: emulatorLabel(emulator) };
  return { tone: "muted", label: t("noTarget"), detail: project.bundleName };
}

function compactRow(label, value, title = "") {
  return `
    <div class="hd-kv">
      <dt>${escapeHtml(label)}</dt>
      <dd title="${escapeHtml(title || value || "")}">${escapeHtml(value || "-")}</dd>
    </div>
  `;
}

function renderKvs(rows) {
  return `<dl class="hd-kvs">${rows.join("")}</dl>`;
}

function renderTopbar() {
  const project = projectSummary(state.project);
  const target = targetState(state.targets).target;
  const status = statusModel();

  return `
    <header class="hd-topbar">
      <div class="hd-title">
        <strong>${escapeHtml(t("appTitle"))}</strong>
        <span title="${escapeHtml(state.workspacePath || "")}">${escapeHtml(workspaceLabel())}</span>
      </div>
      <div class="hd-topbar__meta">
        <span title="${escapeHtml(project.bundleName)}">${escapeHtml(project.bundleName)}</span>
        <span title="${escapeHtml(project.abilityName)}">${escapeHtml(project.abilityName)}</span>
        <span title="${escapeHtml(target?.id || "")}">${escapeHtml(target?.id || t("noTarget"))}</span>
      </div>
      <div class="hd-status hd-status--${status.tone}" title="${escapeHtml(status.detail || status.label)}">
        <span class="hd-status__dot" aria-hidden="true"></span>
        <span>${escapeHtml(status.label)}</span>
      </div>
    </header>
  `;
}

function renderEmulatorSelect(emulators, selected) {
  if (!emulators.length) {
    return `<span class="hd-device-empty">${escapeHtml(t("noTarget"))}</span>`;
  }

  return `
    <select class="hd-device-select" data-emulator-select aria-label="${escapeHtml(t("emulator"))}" title="${escapeHtml(emulatorLabel(selected))}">
      ${emulators.map((emulator) => `
        <option value="${escapeHtml(emulator.name)}" ${selected?.name === emulator.name ? "selected" : ""}>
          ${escapeHtml(emulatorLabel(emulator))}
        </option>
      `).join("")}
    </select>
  `;
}

function renderDiagnostics(items) {
  if (!items.length) return "";
  return `
    <div class="hd-menu-block">
      <h3>${escapeHtml(t("diagnostics"))}</h3>
      <ul class="hd-diagnostics">
        ${items.map((item) => `
          <li>
            <span>${escapeHtml(item.severity || item.stage || "info")}</span>
            <p>${escapeHtml(item.message || item.summary || item.code || String(item))}</p>
          </li>
        `).join("")}
      </ul>
    </div>
  `;
}

function renderCommandHeader() {
  const project = projectSummary(state.project);
  const target = targetState(state.targets).target;
  const emulators = asArray(state.emulators);
  const emulator = selectedDevice();
  const build = state.build || state.runtimeState?.build || {};
  const artifact = build.artifact || state.runtimeState?.latestArtifact;
  const screen = state.screen || state.runtimeState?.screen;
  const diagList = diagnostics();
  const busy = state.loading;
  const hasTarget = Boolean(target);
  const hasRunningEmulator = emulators.some((item) => item.isRunning);
  const canCapture = hasTarget || hasRunningEmulator || emulator?.isRunning;
  const emulatorAction = emulator?.isRunning ? "stop-emulator" : "start-emulator";
  const emulatorActionLabel = emulator?.isRunning ? t("stopEmulator") : t("startEmulator");

  const overviewRows = [
    compactRow("Bundle", project.bundleName),
    compactRow("Ability", project.abilityName),
    compactRow(t("target"), target?.id || t("noTarget"), target?.raw || target?.id),
    compactRow(t("latestArtifact"), shortPath(artifact?.path), artifact?.path || "")
  ];
  const environmentRows = [
    compactRow("Module", project.moduleName),
    compactRow("SDK", project.targetSdkVersion),
    compactRow("Signing", project.signing?.configured ? t("signed") : t("unsigned")),
    compactRow(t("updated"), formatTime(build.updatedAt || artifact?.createdAt || screen?.timestamp))
  ];

  return `
    <nav class="hd-command-header" aria-label="${escapeHtml(t("quickActions"))}">
      <div class="hd-command-title">
        <span>${escapeHtml(t("primaryAction"))}</span>
        <strong title="${escapeHtml(productTitle(state.project))}">${escapeHtml(productTitle(state.project))}</strong>
      </div>

      <div class="hd-command-actions">
        <button type="button" class="hd-run-button" data-action="build-run" ${attrDisabled(busy || !state.workspacePath)}>
          ${escapeHtml(t("buildRun"))}
        </button>
        <button type="button" class="hd-action" data-action="capture" ${attrDisabled(busy || !canCapture)}>${escapeHtml(t("capture"))}</button>
        <button type="button" class="hd-action" data-action="inspect" ${attrDisabled(busy || !hasTarget)}>${escapeHtml(t("inspect"))}</button>
        <button type="button" class="hd-action" data-action="hot-reload" ${attrDisabled(busy || !state.workspacePath)}>${escapeHtml(t("hotReload"))}</button>
      </div>

      <div class="hd-device-inline">
        <span class="hd-device-pill ${emulator?.isRunning || hasTarget ? "is-online" : ""}">
          <i aria-hidden="true"></i>
          ${escapeHtml(emulator?.isRunning || hasTarget ? t("online") : t("offline"))}
        </span>
        ${renderEmulatorSelect(emulators, emulator)}
        <button
          type="button"
          class="hd-state-button ${emulator?.isRunning ? "is-running" : ""}"
          data-action="${emulatorAction}"
          ${attrDisabled(busy || !emulator)}
        >
          ${escapeHtml(emulatorActionLabel)}
        </button>
      </div>

      <details class="hd-more-menu">
        <summary>${escapeHtml(t("more"))}</summary>
        <div class="hd-more-menu__panel">
          <div class="hd-more-actions">
            <button type="button" data-action="detect" ${attrDisabled(busy)}>${escapeHtml(t("detect"))}</button>
            <button type="button" data-action="test" ${attrDisabled(busy || !state.workspacePath)}>${escapeHtml(t("test"))}</button>
            <button type="button" data-action="build" ${attrDisabled(busy || !state.workspacePath)}>${escapeHtml(t("build"))}</button>
            <button type="button" data-action="install" ${attrDisabled(busy || !hasTarget)}>${escapeHtml(t("install"))}</button>
            <button type="button" data-action="launch" ${attrDisabled(busy || !hasTarget)}>${escapeHtml(t("launch"))}</button>
          </div>
          ${renderDiagnostics(diagList)}
          <div class="hd-menu-grid">
            <div class="hd-menu-block">
              <h3>${escapeHtml(t("overview"))}</h3>
              ${renderKvs(overviewRows)}
            </div>
            <div class="hd-menu-block">
              <h3>${escapeHtml(t("environment"))}</h3>
              ${renderKvs(environmentRows)}
            </div>
          </div>
        </div>
      </details>
    </nav>
  `;
}

function renderScreenStage() {
  const screen = state.screen || state.runtimeState?.screen;
  const selection = state.selection;
  const hasImage = Boolean(screen?.dataUrl || screen?.uri);
  const src = screen?.dataUrl || screen?.uri || "";
  const selectionBox = selection?.boundsPercent;
  const screenWidth = Number(screen?.width) > 0 ? Math.round(Number(screen.width)) : 9;
  const screenHeight = Number(screen?.height) > 0 ? Math.round(Number(screen.height)) : 19;
  const screenAspect = Math.max(0.05, Math.min(5, screenWidth / screenHeight));
  const screenMeta = hasImage
    ? `${screenWidth} x ${screenHeight}${screen?.timestamp ? ` / ${formatTime(screen.timestamp)}` : ""}`
    : t("previewUnavailable");

  return `
    <section class="hd-preview" data-testid="harmony-dev-preview">
      <div class="hd-preview__top">
        <span>${escapeHtml(t("screen"))}</span>
        <strong title="${escapeHtml(screen?.path || "")}">${escapeHtml(screenMeta)}</strong>
      </div>
      <div class="hd-device-stage">
        ${hasImage ? `
          <div class="hd-phone-shell">
            <div
              class="hd-screen-canvas"
              data-select-stage
              data-screen-width="${screenWidth}"
              data-screen-height="${screenHeight}"
              style="--hd-screen-ratio:${screenWidth} / ${screenHeight};--hd-screen-aspect:${screenAspect};"
            >
              <img class="hd-screen-image" src="${escapeHtml(src)}" alt="HarmonyOS screenshot" />
              ${selectionBox ? `
                <div class="hd-selection" style="left:${selectionBox.x}%;top:${selectionBox.y}%;width:${selectionBox.width}%;height:${selectionBox.height}%"></div>
              ` : ""}
              ${state.selectionDraft ? `
                <div class="hd-selection hd-selection--draft" style="left:${state.selectionDraft.x}%;top:${state.selectionDraft.y}%;width:${state.selectionDraft.width}%;height:${state.selectionDraft.height}%"></div>
              ` : ""}
            </div>
          </div>
        ` : `
          <div class="hd-phone-shell hd-phone-shell--empty">
            <div class="hd-preview-empty">
              <strong>${escapeHtml(t("previewUnavailable"))}</strong>
              <span>${escapeHtml(t("selectHint"))}</span>
            </div>
          </div>
        `}
      </div>
      <div class="hd-context-bar">
        <span>${escapeHtml(t("context"))}</span>
        <strong title="${escapeHtml(selectionSummary())}">${escapeHtml(selection ? selectionSummary() : t("noSelection"))}</strong>
        ${selection ? `<button type="button" class="hd-plain-button" data-action="clear-selection">${escapeHtml(t("clear"))}</button>` : ""}
        <button type="button" class="hd-plain-button hd-plain-button--accent" data-action="send-context" ${selection || screen ? "" : "disabled"}>${escapeHtml(t("sendContext"))}</button>
      </div>
    </section>
  `;
}

function fitScreenCanvas() {
  const root = document.getElementById("harmonyDevRoot");
  if (!root) return;
  root.querySelectorAll(".hd-screen-canvas").forEach((canvas) => {
    const stage = canvas.closest(".hd-device-stage");
    if (!stage) return;
    const screenWidth = Number(canvas.getAttribute("data-screen-width")) || 9;
    const screenHeight = Number(canvas.getAttribute("data-screen-height")) || 19;
    const rect = stage.getBoundingClientRect();
    const maxWidth = Math.max(1, rect.width - 44);
    const maxHeight = Math.max(1, rect.height - 44);
    const scale = Math.min(maxWidth / screenWidth, maxHeight / screenHeight);
    canvas.style.width = `${Math.max(1, Math.floor(screenWidth * scale))}px`;
    canvas.style.height = `${Math.max(1, Math.floor(screenHeight * scale))}px`;
  });
}

function renderMain() {
  if (!state.workspacePath) {
    return `
      <main class="hd-workbench hd-workbench--empty">
        <section class="hd-empty">${escapeHtml(t("noWorkspace"))}</section>
      </main>
    `;
  }
  return `
    <main class="hd-workbench">
      ${renderScreenStage()}
    </main>
  `;
}

function render() {
  const root = document.getElementById("harmonyDevRoot");
  if (!root) return;
  root.dataset.route = state.route;
  document.documentElement.dataset.route = state.route;
  root.innerHTML = `
    ${renderTopbar()}
    ${state.loading ? `<div class="hd-progress" role="progressbar"><span></span></div>` : `<div class="hd-progress hd-progress--idle"></div>`}
    ${renderCommandHeader()}
    <div class="hd-error ${state.error ? "" : "hd-error--empty"}">${state.error ? escapeHtml(state.error) : ""}</div>
    ${renderMain()}
  `;
  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(fitScreenCanvas);
  } else {
    setTimeout(fitScreenCanvas, 0);
  }
}

export { fitScreenCanvas, render };
