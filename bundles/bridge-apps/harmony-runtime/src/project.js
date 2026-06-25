const fs = require("node:fs");
const path = require("node:path");
const { readJson5 } = require("./json5");
const { normalizeWorkspace, relativeToWorkspace } = require("./paths");
const { diagnostic, redactValue } = require("./redact");
const { writeRuntimeState, readRuntimeState } = require("./runtime-state");

function walkFiles(root, predicate, maxFiles = 4000) {
  const files = [];
  const stack = [root];
  const ignored = new Set([".git", ".hvigor", "oh_modules", "node_modules", "build", ".sparo_os"]);
  while (stack.length && files.length < maxFiles) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) stack.push(absolute);
      } else if (entry.isFile() && predicate(absolute)) {
        files.push(absolute);
      }
    }
  }
  return files;
}

function detectSourceHints(workspacePath) {
  const etsRoot = path.join(workspacePath, "entry", "src", "main", "ets");
  const etsFiles = fs.existsSync(etsRoot)
    ? walkFiles(etsRoot, (file) => /\.(ets|ts)$/i.test(file), 1200)
    : [];
  const componentNames = new Set();
  for (const file of etsFiles.slice(0, 100)) {
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const match of text.matchAll(/(?:struct|class)\s+([A-Za-z0-9_]+)/g)) {
      componentNames.add(match[1]);
    }
  }
  return {
    etsFiles: etsFiles.slice(0, 80).map((file) => relativeToWorkspace(workspacePath, file)),
    componentNames: Array.from(componentNames).slice(0, 80),
  };
}

function materialPathsPresent(material = {}) {
  const paths = [material.certpath, material.profile, material.storeFile].filter(Boolean);
  return paths.length > 0 && paths.every((filePath) => {
    try {
      return fs.existsSync(filePath);
    } catch {
      return false;
    }
  });
}

function signingSummary(buildProfile = {}) {
  const products = buildProfile?.app?.products || [];
  const signingConfigs = buildProfile?.app?.signingConfigs || [];
  const selected = products.find((product) => product.signingConfig)?.signingConfig;
  const config = signingConfigs.find((item) => item.name === selected) || signingConfigs[0];
  return {
    configured: Boolean(selected || config),
    materialPathsPresent: materialPathsPresent(config?.material),
    redacted: true,
  };
}

function detectProject(input = {}) {
  const workspacePath = normalizeWorkspace(input.workspacePath);
  const buildProfilePath = path.join(workspacePath, "build-profile.json5");
  const appJsonPath = path.join(workspacePath, "AppScope", "app.json5");
  const moduleJsonPath = path.join(workspacePath, "entry", "src", "main", "module.json5");
  const diagnostics = [];
  if (!fs.existsSync(buildProfilePath)) {
    const project = {
      kind: "unknown",
      status: "notFound",
      workspacePath,
    };
    return { ok: false, status: "notFound", project, diagnostics: [diagnostic("info", "build-profile.json5 was not found", { stage: "detectProject" })] };
  }
  const buildProfile = readJson5(buildProfilePath, {});
  const appJson = readJson5(appJsonPath, {});
  const moduleJson = readJson5(moduleJsonPath, {});
  const product = (buildProfile?.app?.products || [])[0] || {};
  const modules = (buildProfile?.modules || []).map((moduleRef) => {
    const moduleRoot = path.resolve(workspacePath, moduleRef.srcPath || moduleRef.name || "");
    const moduleConfigPath = moduleRef.name === "entry" ? moduleJsonPath : path.join(moduleRoot, "src", "main", "module.json5");
    const config = moduleRef.name === "entry" ? moduleJson : readJson5(moduleConfigPath, {});
    const module = config.module || {};
    return {
      name: module.name || moduleRef.name,
      srcPath: moduleRef.srcPath || "",
      type: module.type || "unknown",
      mainElement: module.mainElement || null,
      deviceTypes: module.deviceTypes || [],
      abilities: (module.abilities || []).map((ability) => ({
        name: ability.name,
        srcEntry: ability.srcEntry,
        exported: Boolean(ability.exported),
        label: ability.label,
      })),
      pages: module.pages || null,
    };
  });
  const isHarmony = product.runtimeOS === "HarmonyOS";
  if (!isHarmony) diagnostics.push(diagnostic("warning", "build-profile.json5 exists but runtimeOS is not HarmonyOS", { stage: "detectProject" }));
  const sourceHints = detectSourceHints(workspacePath);
  const project = redactValue({
    kind: isHarmony ? "harmonyos" : "unknown",
    status: isHarmony ? "matched" : "notFound",
    workspacePath,
    productName: appJson?.app?.label || appJson?.app?.bundleName || path.basename(workspacePath),
    runtimeOS: product.runtimeOS || null,
    targetSdkVersion: product.targetSdkVersion || null,
    compatibleSdkVersion: product.compatibleSdkVersion || null,
    bundleName: appJson?.app?.bundleName || null,
    app: {
      bundleName: appJson?.app?.bundleName || null,
      versionName: appJson?.app?.versionName || null,
      versionCode: appJson?.app?.versionCode || null,
      label: appJson?.app?.label || null,
    },
    modules,
    signing: signingSummary(buildProfile),
    sourceHints,
    files: {
      buildProfile: "build-profile.json5",
      appJson: fs.existsSync(appJsonPath) ? "AppScope/app.json5" : null,
      moduleJson: fs.existsSync(moduleJsonPath) ? "entry/src/main/module.json5" : null,
    },
  });
  const runtimeState = writeRuntimeState(workspacePath, {
    project,
    diagnostics,
  });
  return { ok: isHarmony, status: project.status, project, diagnostics, runtimeState };
}

function projectIdentity(workspacePath) {
  const state = readRuntimeState(workspacePath);
  if (state.project?.kind === "harmonyos") return state.project;
  return detectProject({ workspacePath }).project;
}

module.exports = {
  detectProject,
  projectIdentity,
};
