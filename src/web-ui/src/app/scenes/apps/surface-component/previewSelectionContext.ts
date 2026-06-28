import type {
  SurfaceComponentPreviewElementFingerprint,
  SurfaceComponentPreviewElementSelectionContext,
  SurfaceComponentPreviewElementSummary,
} from '@/shared/types/context';

export interface PreviewElementInspectorPayload {
  appId?: string;
  route?: string;
  element?: SurfaceComponentPreviewElementSummary;
  fingerprint?: SurfaceComponentPreviewElementFingerprint;
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

export function buildSurfaceComponentPreviewElementSelectionContext({
  appId,
  appName,
  sessionId,
  route,
  runtimeRevision,
  payload,
}: BuildPreviewElementSelectionContextParams): SurfaceComponentPreviewElementSelectionContext | null {
  if (!payload.element || !payload.fingerprint) return null;
  const timestamp = payload.timestamp ?? Date.now();
  return {
    id: `surface-component-preview-element-selection-${timestamp}`,
    timestamp,
    type: 'surface-component-preview-element-selection',
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

export function summarizeSurfaceComponentPreviewElementSelection(
  context: SurfaceComponentPreviewElementSelectionContext,
): string {
  const appLabel = context.appName || context.appId;
  const route = context.route || '/';
  const label = context.element.label || context.element.textContent || context.element.selectorPath;
  const tag = context.element.tagName.toLowerCase();
  return `${appLabel} @ ${route} ${tag} "${label}"`;
}
