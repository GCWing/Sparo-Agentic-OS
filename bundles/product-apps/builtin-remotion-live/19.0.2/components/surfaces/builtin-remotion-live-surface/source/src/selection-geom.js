import { activeFrameModel, currentComposition, selectedElementContext, selectedLayer } from './model.js';
import { state } from './state.js';
import { asElement, clamp, nodeInsideRoot, previewStageNode, projectName, round2, t } from './util.js';

function isSelectionStartTarget(target) {
  if (state.interactionMode !== 'inspect') return false;
  const element = asElement(target);
  return Boolean(element && nodeInsideRoot(element) && element.closest('[data-select-capture],[data-preview-layer-id]'));
}

function shouldDeferRenderForSelection() {
  return state.selectionPointerDown || state.selectionDragging;
}

function buildSelectedVideoContext() {
  const composition = currentComposition();
  const model = activeFrameModel();
  const selection = state.selection;
  const fps = composition?.fps ?? null;
  const frame = Math.round(Number(state.playerRuntimeFrame ?? state.frame) || 0);
  const context = {
    workspacePath: state.workspacePath || null,
    projectName: projectName(),
    entryPoint: state.project?.entryPoint || state.detection?.entryPoint || null,
    compositionId: composition?.id || null,
    projectRevision: state.manifest?.projectRevision || state.manifest?.buildId || null,
    frame,
    frameState: 'committed',
    timeSeconds: model?.timeSeconds ?? (fps ? round2(frame / fps) : null),
    fps,
    durationInFrames: composition?.durationInFrames ?? null,
    descriptorRevision: composition?.descriptorRevision || state.manifest?.descriptorRevision || null,
    playbackState: state.playerPhase,
  };
  if (composition?.width && composition?.height) {
    context.size = { width: composition.width, height: composition.height };
  }
  if (selection?.type === 'element') {
    const elementContext = selectedElementContext();
    if (elementContext) {
      context.selection = { type: 'element', element: elementContext.element };
      context.contextSource = elementContext.contextSource;
    }
  } else if (selection?.type === 'point' && selection.point) {
    context.selection = { type: 'point', point: selection.point };
  } else if (selection?.type === 'region' && selection.normalizedBox) {
    context.selection = { type: 'region', normalizedBox: selection.normalizedBox };
  }
  return context;
}

function selectionContextSentence(context) {
  const parts = [`${t('composition')} ${context.compositionId || '-'}`, `${t('frame')} ${context.frame}`];
  const selection = context.selection;
  if (!selection) {
    parts.push(t('selectionWhole'));
  } else if (selection.type === 'point' && selection.point) {
    parts.push(`${t('selectionPoint')} ${Math.round(selection.point.x)}%, ${Math.round(selection.point.y)}%`);
  } else if (selection.type === 'region' && selection.normalizedBox) {
    parts.push(`${t('selectionRegion')} ${Math.round(selection.normalizedBox.width)}% × ${Math.round(selection.normalizedBox.height)}%`);
  } else if (selection.type === 'element' && selection.element) {
    parts.push(`${t('selectionElement')} ${selection.element.label || selection.element.id || ''}`.trim());
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
  const selection = state.selection;
  if (!selection) return `${base} · ${t('selectionWhole')}`;
  if (selection.type === 'point' && selection.point) {
    return `${base} · ${t('selectionPoint')} ${Math.round(selection.point.x)}%, ${Math.round(selection.point.y)}%`;
  }
  if (selection.type === 'region' && selection.normalizedBox) {
    return `${base} · ${t('selectionRegion')} ${Math.round(selection.normalizedBox.width)}% × ${Math.round(selection.normalizedBox.height)}%`;
  }
  if (selection.type === 'element') {
    const layer = selectedLayer()?.layer;
    return `${base} · ${t('selectionElement')} ${layer?.label || layer?.id || layer?.type || ''}`.trim();
  }
  return base;
}

export {
  buildSelectedVideoContext,
  isSelectionStartTarget,
  selectionContextSentence,
  selectionSummary,
  shouldDeferRenderForSelection,
  stageNormalizedPoint,
};
