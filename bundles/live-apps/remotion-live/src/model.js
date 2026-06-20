// remotion-live :: model.js (auto-split from ui.js; do not hand-merge)

import { usePlayerPreview } from './preview-mode.js';
import { state } from './state.js';
import { asArray, clamp, escapeHtml } from './util.js';

function currentComposition() {
  const compositions = asArray(state.manifest?.compositions);
  return compositions.find((item) => item.id === state.activeCompositionId) || compositions[0] || null;
}


function compositionDuration(composition = currentComposition()) {
  return Math.max(1, Number(composition?.durationInFrames || composition?.duration || 1));
}


function defaultPreviewFrame(composition = currentComposition()) {
  const duration = compositionDuration(composition);
  if (duration <= 1) return 0;
  return clamp(Math.round(duration * 0.25), 0, duration - 1);
}


function previewFrameKey(composition = currentComposition(), frame = state.frame, scale = state.previewScale) {
  if (!composition) return '';
  return `${state.manifest?.buildId || 'build'}:${composition.id}:${Math.round(Number(frame) || 0)}:${scale}`;
}


function previewClipKey(composition = currentComposition(), frame = state.frame, scale = state.previewClipScale) {
  if (!composition) return '';
  return `${state.manifest?.buildId || 'build'}:${composition.id}:${Math.round(Number(frame) || 0)}:${scale}:${state.previewClipSeconds}`;
}


function timelineFramePercent(frame = state.frame, composition = currentComposition()) {
  const duration = compositionDuration(composition);
  if (duration <= 1) return 0;
  return Math.min(100, Math.max(0, (Number(frame) || 0) * (100 / (duration - 1))));
}


function normalizeManifest(output) {
  return output?.manifest || output?.compositionManifest || output || { compositions: [] };
}


function layerBox(layer, index) {
  const bounds = layer.bboxPercent || layer.boundsPercent || layer.bounds || null;
  const x = Number.isFinite(Number(bounds?.x ?? layer.x)) ? Number(bounds?.x ?? layer.x) : 8 + index * 4;
  const y = Number.isFinite(Number(bounds?.y ?? layer.y)) ? Number(bounds?.y ?? layer.y) : 10 + index * 7;
  const width = Number.isFinite(Number(bounds?.width ?? layer.width)) ? Number(bounds?.width ?? layer.width) : Math.max(18, 78 - index * 8);
  const height = Number.isFinite(Number(bounds?.height ?? layer.height)) ? Number(bounds?.height ?? layer.height) : Math.max(10, 24 - index * 2);
  const color = layer.color || ['#5dc6ff', '#f4c542', '#8de16d', '#ff7a90'][index % 4];
  const opacity = Number.isFinite(Number(layer.opacity)) ? Number(layer.opacity) : 0.82;
  return { x, y, width, height, color, opacity };
}


function layerStyle(layer, index) {
  const { x, y, width, height, color, opacity } = layerBox(layer, index);
  return `left:${x}%;top:${y}%;width:${width}%;height:${height}%;background:${escapeHtml(color)};opacity:${opacity};`;
}


function frameModelMatches(model, composition = currentComposition()) {
  if (!model || !composition) return false;
  const modelCompositionId = model.compositionId || model.composition?.id;
  if (modelCompositionId && modelCompositionId !== composition.id) return false;
  if (model.frame === undefined || model.frame === null) return true;
  return Math.round(Number(model.frame) || 0) === Math.round(Number(state.frame) || 0);
}


function activeFrameModel() {
  if (usePlayerPreview() && frameModelMatches(state.playerFrameModel)) {
    return state.playerFrameModel;
  }
  return frameModelMatches(state.frameModel) ? state.frameModel : null;
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
  return {
    workspacePath: state.workspacePath || null,
    compositionId: composition.id,
    frame: Math.round(Number(state.frame) || 0),
    timeSeconds: model?.timeSeconds ?? null,
    contextSource: model?.measurement || layer.source || 'bridge',
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
      bboxPercent: {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      },
    },
  };
}


export { activeFrameModel, compositionDuration, currentComposition, defaultPreviewFrame, frameLayers, layerBox, layerElementId, layerStyle, normalizeManifest, previewClipKey, previewFrameKey, selectedElementContext, selectedLayer, timelineFramePercent };
