import type {
  LiveAppPreviewElementFingerprint,
  LiveAppPreviewElementSelectionContext,
  LiveAppPreviewElementSummary,
} from '@/shared/types/context';

export interface PreviewElementInspectorPayload {
  appId?: string;
  route?: string;
  element?: LiveAppPreviewElementSummary;
  fingerprint?: LiveAppPreviewElementFingerprint;
  source?: 'iframe-element-inspector' | 'runtime-specific';
  confidence?: 'high' | 'medium' | 'low';
  timestamp?: number;
}

export interface BuildPreviewElementSelectionContextParams {
  appId: string;
  appName?: string;
  sessionId?: string | null;
  route?: string;
  runtimeRevision?: string;
  payload: PreviewElementInspectorPayload;
}

const SELECTION_SCHEMA_VERSION = 1;

export function buildLiveAppPreviewElementSelectionContext({
  appId,
  appName,
  sessionId,
  route,
  runtimeRevision,
  payload,
}: BuildPreviewElementSelectionContextParams): LiveAppPreviewElementSelectionContext | null {
  if (!payload.element || !payload.fingerprint) return null;
  const timestamp = payload.timestamp ?? Date.now();
  return {
    id: `live-app-preview-element-selection-${timestamp}`,
    timestamp,
    type: 'live-app-preview-element-selection',
    schemaVersion: SELECTION_SCHEMA_VERSION,
    appId,
    appName,
    sessionId,
    route: payload.route || route || '/',
    runtimeRevision,
    element: payload.element,
    fingerprint: payload.fingerprint,
    source: payload.source || 'iframe-element-inspector',
    confidence: payload.confidence || 'high',
  };
}

export function summarizeLiveAppPreviewElementSelection(
  context: LiveAppPreviewElementSelectionContext,
): string {
  const appLabel = context.appName || context.appId;
  const route = context.route || '/';
  const label = context.element.label || context.element.textContent || context.element.selectorPath;
  const tag = context.element.tagName.toLowerCase();
  return `${appLabel} @ ${route} ${tag} "${label}"`;
}
