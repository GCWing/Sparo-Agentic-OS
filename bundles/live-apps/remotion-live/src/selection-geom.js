// remotion-live :: selection-geom.js (auto-split from ui.js; do not hand-merge)

import { activeFrameModel, currentComposition, selectedElementContext, selectedLayer } from './model.js';
import { state } from './state.js';
import { asElement, clamp, nodeInsideRoot, previewStageNode, projectName, round2, stopPlaybackTimer, t } from './util.js';

function hasLiveTextSelection() {
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
  if (!nodeInsideRoot(selection.anchorNode) && !nodeInsideRoot(selection.focusNode)) return false;
  return selection.toString().trim().length > 0;
}


function isSelectionStartTarget(target) {
  const element = asElement(target);
  if (!element || !nodeInsideRoot(element)) return false;
  if (element.closest('[data-preview-layer-id]')) return false;
  return !element.closest('button,input,select,textarea,[contenteditable="true"],[data-action]');
}


function pausePlaybackForSelection() {
  if (!state.playing && !state.playTimer) return;
  state.playing = false;
  stopPlaybackTimer();
  state.renderQueued = true;
}


function shouldDeferRenderForSelection() {
  return state.selectionPointerDown || state.selectionGuard || hasLiveTextSelection();
}


function buildSelectedVideoContext() {
  const composition = currentComposition();
  const model = activeFrameModel();
  const sel = state.selection;
  const fps = composition?.fps ?? null;
  const frame = Math.round(Number(state.frame) || 0);
  const context = {
    workspacePath: state.workspacePath || null,
    projectName: projectName(),
    entryPoint: state.project?.entryPoint || state.detection?.entryPoint || null,
    compositionId: composition?.id || null,
    frame,
    timeSeconds: model?.timeSeconds ?? (fps ? round2(frame / fps) : null),
    fps,
    durationInFrames: composition?.durationInFrames ?? null,
    previewMode: state.previewMode,
  };
  if (composition?.width && composition?.height) {
    context.size = { width: composition.width, height: composition.height };
  }
  if (sel?.type === 'element') {
    const elementContext = selectedElementContext();
    if (elementContext) {
      context.selection = { type: 'element', element: elementContext.element };
      context.contextSource = elementContext.contextSource;
    }
  } else if (sel?.type === 'point' && sel.point) {
    context.selection = { type: 'point', point: sel.point };
  } else if (sel?.type === 'region' && sel.normalizedBox) {
    context.selection = { type: 'region', normalizedBox: sel.normalizedBox };
  }
  return context;
}


function selectionContextSentence(context) {
  const parts = [`${t('composition')} ${context.compositionId || '-'} · ${t('frame')} ${context.frame}`];
  const sel = context.selection;
  if (!sel) {
    parts.push(t('selectionWhole'));
  } else if (sel.type === 'point' && sel.point) {
    parts.push(`${t('selectionPoint')} ${Math.round(sel.point.x)}%, ${Math.round(sel.point.y)}%`);
  } else if (sel.type === 'region' && sel.normalizedBox) {
    parts.push(`${t('selectionRegion')} ${Math.round(sel.normalizedBox.width)}% × ${Math.round(sel.normalizedBox.height)}%`);
  } else if (sel.type === 'element' && sel.element) {
    parts.push(`${t('selectionElement')} ${sel.element.label || sel.element.id || ''}`.trim());
  }
  return parts.join(' · ');
}


function stageNormalizedPoint(event) {
  const stage = previewStageNode();
  if (!stage) return null;
  const rect = stage.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100),
    y: clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100),
  };
}


function selectionSummary() {
  const composition = currentComposition();
  const base = `${composition?.id || '-'} · ${t('frame')} ${Math.round(Number(state.frame) || 0)}`;
  const sel = state.selection;
  if (!sel) return `${base} · ${t('selectionWhole')}`;
  if (sel.type === 'point' && sel.point) {
    return `${base} · ${t('selectionPoint')} ${Math.round(sel.point.x)}%, ${Math.round(sel.point.y)}%`;
  }
  if (sel.type === 'region' && sel.normalizedBox) {
    return `${base} · ${t('selectionRegion')} ${Math.round(sel.normalizedBox.width)}% × ${Math.round(sel.normalizedBox.height)}%`;
  }
  if (sel.type === 'element') {
    const selected = selectedLayer();
    const layer = selected?.layer;
    const label = layer?.label || layer?.id || layer?.type || t('selectionElement');
    return `${base} · ${t('selectionElement')} ${label}`;
  }
  return base;
}


export { buildSelectedVideoContext, hasLiveTextSelection, isSelectionStartTarget, pausePlaybackForSelection, selectionContextSentence, selectionSummary, shouldDeferRenderForSelection, stageNormalizedPoint };
