import { asArray } from "./util.js";

function projectSummary(project) {
  const modules = asArray(project?.modules);
  const firstModule = modules[0] || {};
  const ability = asArray(firstModule.abilities)[0] || {};
  return {
    productName: project?.productName || project?.app?.label || "HarmonyOS",
    bundleName: project?.bundleName || project?.app?.bundleName || "-",
    moduleName: firstModule.name || "-",
    abilityName: firstModule.mainElement || ability.name || "-",
    targetSdkVersion: project?.targetSdkVersion || "-",
    signing: project?.signing || null
  };
}

function targetState(targets) {
  const list = asArray(targets);
  if (!list.length) return { kind: "none", target: null };
  const online = list.find((target) => target.state === "online") || list[0];
  return { kind: "online", target: online };
}

function recommendedEmulator(emulators) {
  return asArray(emulators)
    .slice()
    .sort((left, right) => (Number(right.rank || 0) - Number(left.rank || 0)) || String(left.name).localeCompare(String(right.name)))[0] || null;
}

function selectedEmulator(emulators, selectedName) {
  const list = asArray(emulators);
  if (selectedName) return list.find((item) => item.name === selectedName) || null;
  return recommendedEmulator(list);
}

function runtimeCapabilities(runtimeState) {
  return runtimeState?.capabilities || {};
}

export { projectSummary, recommendedEmulator, runtimeCapabilities, selectedEmulator, targetState };
