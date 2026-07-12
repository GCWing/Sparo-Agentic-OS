import { state } from './state.js';
import { asArray, clamp } from './util.js';

function currentComposition() {
  const compositions = asArray(state.manifest?.compositions);
  return compositions.find((item) => item.id === state.activeCompositionId) || compositions[0] || null;
}

function compositionDuration(composition = currentComposition()) {
  return Math.max(1, Math.round(Number(composition?.durationInFrames || composition?.duration || 1)));
}

function defaultPreviewFrame() {
  return 0;
}

function timelineFramePercent(frame = state.frame, composition = currentComposition()) {
  const duration = compositionDuration(composition);
  if (duration <= 1) return 0;
  return clamp((Number(frame) || 0) * (100 / (duration - 1)), 0, 100);
}

function normalizeManifest(output) {
  return output?.manifest || output || { compositions: [] };
}

function layerBox(layer) {
  const bounds = layer?.bboxPercent || layer?.boundsPercent || layer?.bounds || null;
  if (!bounds) return null;
  const values = [bounds.x, bounds.y, bounds.width, bounds.height].map(Number);
  if (!values.every(Number.isFinite)) return null;
  const [rawX, rawY, rawWidth, rawHeight] = values;
  const x = clamp(rawX, 0, 100);
  const y = clamp(rawY, 0, 100);
  const width = clamp(rawWidth, 0, 100 - x);
  const height = clamp(rawHeight, 0, 100 - y);
  if (width <= 0 || height <= 0) return null;
  return {
    x,
    y,
    width,
    height,
    color: layer?.color || 'var(--rl-accent)',
    opacity: Number.isFinite(Number(layer?.opacity)) ? Number(layer.opacity) : 0.82,
  };
}

function frameModelMatches(model, composition = currentComposition()) {
  if (!model || !composition) return false;
  const modelCompositionId = model.compositionId || model.composition?.id;
  if (modelCompositionId && modelCompositionId !== composition.id) return false;
  if (model.frame === undefined || model.frame === null) return true;
  return Math.round(Number(model.frame) || 0) === Math.round(Number(state.frame) || 0);
}

function activeFrameModel() {
  if (frameModelMatches(state.playerFrameModel)) return state.playerFrameModel;
  return null;
}

function frameLayers() {
  return asArray(activeFrameModel()?.layers);
}

function layerElementId(layer, index) {
  return String(layer?.id || `${layer?.type || 'layer'}-${index + 1}`);
}

function selectedLayer() {
  if (!state.selectedElementId) return null;
  return frameLayers()
    .map((layer, index) => ({ layer, index, id: layerElementId(layer, index) }))
    .find((item) => item.id === state.selectedElementId) || null;
}

function selectedElementContext() {
  const selected = selectedLayer();
  const composition = currentComposition();
  if (!selected || !composition) return null;
  const { layer, index, id } = selected;
  const model = activeFrameModel();
  const box = layerBox(layer, index);
  if (!box) return null;
  return {
    workspacePath: state.workspacePath || null,
    compositionId: composition.id,
    frame: Math.round(Number(state.frame) || 0),
    timeSeconds: model?.timeSeconds ?? null,
    contextSource: model?.measurement || layer.source || 'player',
    element: {
      id,
      type: layer.type || null,
      label: layer.label || layer.id || layer.type || id,
      sourceHint: layer.sourceHint || layer.sourcePath || layer.componentPath || null,
      source: layer.source || model?.measurement || null,
      elementPath: layer.elementPath || null,
      sequenceId: layer.sequenceId || null,
      from: layer.from ?? null,
      duration: layer.duration ?? layer.durationInFrames ?? null,
      bboxPercent: { x: box.x, y: box.y, width: box.width, height: box.height },
    },
  };
}

export {
  activeFrameModel,
  compositionDuration,
  currentComposition,
  defaultPreviewFrame,
  frameLayers,
  layerBox,
  layerElementId,
  normalizeManifest,
  selectedElementContext,
  selectedLayer,
  timelineFramePercent,
};
