import type {
  ProductAppPreviewElementSelectionContext,
} from '@/shared/types/context';
import type {
  ProductAppPreviewElementInspectorPayload,
} from './ProductAppRuntimeIframeHost';

export interface BuildPreviewElementSelectionContextParams {
  appId: string;
  appName?: string;
  sessionId?: string | null;
  route?: string;
  runtimeRevision?: string;
  payload: ProductAppPreviewElementInspectorPayload;
}

const SELECTION_SCHEMA_VERSION = 1;

export function buildProductAppPreviewElementSelectionContext({
  appId,
  appName,
  sessionId,
  route,
  runtimeRevision,
  payload,
}: BuildPreviewElementSelectionContextParams): ProductAppPreviewElementSelectionContext | null {
  if (!payload.element || !payload.fingerprint) return null;
  const timestamp = payload.timestamp ?? Date.now();
  return {
    id: `product-app-preview-element-selection-${timestamp}`,
    timestamp,
    type: 'product-app-preview-element-selection',
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

export function summarizeProductAppPreviewElementSelection(
  context: ProductAppPreviewElementSelectionContext,
): string {
  const appLabel = context.appName || context.appId;
  const route = context.route || '/';
  const label = context.element.label || context.element.textContent || context.element.selectorPath;
  const tag = context.element.tagName.toLowerCase();
  return `${appLabel} @ ${route} ${tag} "${label}"`;
}
