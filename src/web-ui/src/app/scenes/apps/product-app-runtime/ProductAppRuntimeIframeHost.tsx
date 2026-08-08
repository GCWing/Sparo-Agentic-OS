/**
 * Bottom host adapter for the Product App runtime iframe.
 * Injects the bridge script (already in compiledHtml from Rust compiler)
 * and handles all postMessage RPC via useProductAppRuntimeBridge.
 */
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ProductAppRehearsalPlan } from '@/shared/types/app-manifest';
import type { ProductAppRuntimeSessionMetadata } from '@/shared/types/session-history';
import { useProductAppRuntimeBridge } from './useProductAppRuntimeBridge';
import { useTheme } from '@/infrastructure/theme/hooks/useTheme';
import { useI18n } from '@/infrastructure/i18n';
import { buildProductAppRuntimeThemeVars } from './productAppRuntimeThemeVars';
import { resolveProductAppHostSurfaceMeta } from './productAppRuntimeHostMeta';
import type { ProductAppHostSurface } from '@/infrastructure/api/service-api/ProductAppRuntimeHostAPI';
import type {
  ProductAppPreviewElementFingerprint,
  ProductAppPreviewElementSummary,
} from '@/shared/types/context';
import type { ProductAppRuntimeContext } from '@/shared/types/product-app-runtime';
import {
  appScopeFromWorkspacePath,
  normalizeAppScope,
  systemAppScope,
  type AppScope,
  workspacePathFromAppScope,
} from '@/shared/types/app-scope';
import { api } from '@/infrastructure/api/service-api/ApiClient';
import { useExcelLiveLaunchStore } from '@/app/agentic-os/excel-live/excelLiveLaunchStore';
import { useExcelLiveFocusStore } from '@/app/agentic-os/excel-live/excelLiveFocusStore';
import { MarkdownEditor } from '@/tools/markdown';
import {
  areHostedViewsEqual,
  normalizeHostedView,
  normalizeHostedViewId,
  normalizeHostedViewUpdate,
  type ProductAppRuntimeHostedView,
  type ProductAppRuntimeHostedViewBridge,
} from './productAppRuntimeHostedViews';
import './ProductAppRuntimeIframeHost.scss';

const EXCEL_LIVE_APP_ID = 'builtin-excel-live';
const MAX_HOSTED_VIEWS = 8;

function iframeFeaturePolicy(app: ProductAppHostSurface): string | undefined {
  const features: string[] = [];
  if (app.permissions.iframe?.autoplay) features.push('autoplay');
  if (app.permissions.iframe?.fullscreen) features.push('fullscreen');
  return features.length > 0 ? features.join('; ') : undefined;
}

interface AgentToolEventPayload {
  sessionId?: string;
  turnId?: string;
  toolEvent?: {
    tool_id?: string;
    tool_name?: string;
    event_type?: string;
    params?: unknown;
    result?: unknown;
  };
}

function findWorkbookId(value: unknown, depth = 0): string | undefined {
  if (depth > 8 || value == null) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return undefined;
    try {
      return findWorkbookId(JSON.parse(trimmed) as unknown, depth + 1);
    } catch {
      return undefined;
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findWorkbookId(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ['workbookId', 'workbook_id']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  for (const nested of Object.values(record)) {
    const found = findWorkbookId(nested, depth + 1);
    if (found) return found;
  }
  return undefined;
}

interface ProductAppRuntimeIframeHostProps {
  app: ProductAppHostSurface;
  route?: string;
  tabId?: string;
  sessionId?: string;
  scope?: AppScope | null;
  workspacePath?: string;
  runtimeContext?: ProductAppRuntimeContext | null;
  productAppRuntime?: ProductAppRuntimeSessionMetadata;
  elementInspectorEnabled?: boolean;
  onElementInspectorHover?: (payload: PreviewElementInspectorPayload | null) => void;
  onElementInspectorSelect?: (payload: PreviewElementInspectorPayload) => void;
  onElementInspectorExit?: () => void;
  onPreviewLoad?: (payload: ProductAppRuntimeReadyPayload | null) => void;
  onPreviewInteractionProbe?: (payload: ProductAppRuntimeInteractionProbePayload | null) => void;
  onPreviewUserPathRehearsal?: (payload: ProductAppRuntimeUserPathRehearsalPayload | null) => void;
  onPreviewBootTimeout?: () => void;
  previewBootTimeoutMs?: number;
  userPathRehearsalPlan?: ProductAppRehearsalPlan | null;
}

export interface PreviewElementInspectorPayload {
  appId?: string;
  route?: string;
  element?: ProductAppPreviewElementSummary;
  fingerprint?: ProductAppPreviewElementFingerprint;
  source?: 'iframe-element-inspector' | 'runtime-specific';
  confidence?: 'high' | 'medium' | 'low';
  timestamp?: number;
}

export type ProductAppPreviewElementInspectorPayload = PreviewElementInspectorPayload;

export interface ProductAppRuntimeReadyMetrics {
  bodyChildCount?: number;
  visibleElementCount?: number;
  interactiveElementCount?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  scrollWidth?: number;
  scrollHeight?: number;
}

export interface ProductAppRuntimeReadyPayload {
  appId?: string;
  hostSurfaceId?: string;
  readyState?: string;
  route?: string;
  timestampMs?: number;
  sourceRevision?: string;
  depsRevision?: string;
  depsDirty?: boolean;
  workerRestartRequired?: boolean;
  metrics?: ProductAppRuntimeReadyMetrics | null;
}

export interface ProductAppRuntimeInteractionProbeResult {
  candidateCount?: number;
  probed?: boolean;
  focused?: boolean;
  restoredFocus?: boolean;
  targetTag?: string;
  targetRole?: string;
  targetType?: string;
  error?: string;
}

export interface ProductAppRuntimeInteractionProbePayload {
  appId?: string;
  route?: string;
  timestampMs?: number;
  probe?: ProductAppRuntimeInteractionProbeResult | null;
}

export interface ProductAppRuntimeUserPathRehearsalStepResult {
  id?: string;
  action?: string;
  target?: string;
  status?: string;
  detail?: string;
  targetTag?: string;
  targetRole?: string;
  targetType?: string;
  focused?: boolean;
  expectationCount?: number;
  verifiedExpectationCount?: number;
  failedExpectations?: string[];
  error?: string;
}

export interface ProductAppRuntimeUserPathRehearsalScenarioResult {
  id?: string;
  kind?: string;
  stepCount?: number;
  steps?: ProductAppRuntimeUserPathRehearsalStepResult[];
}

export interface ProductAppRuntimeUserPathRehearsalSummary {
  status?: string;
  scenarioCount?: number;
  stepCount?: number;
  passedStepCount?: number;
  failedStepCount?: number;
  notVerifiedStepCount?: number;
  expectationCount?: number;
  verifiedExpectationCount?: number;
  failedExpectationCount?: number;
}

export interface ProductAppRuntimeUserPathRehearsalResult {
  status?: string;
  summary?: ProductAppRuntimeUserPathRehearsalSummary | null;
  scenarios?: ProductAppRuntimeUserPathRehearsalScenarioResult[];
  error?: string;
}

export interface ProductAppRuntimeUserPathRehearsalPayload {
  appId?: string;
  route?: string;
  timestampMs?: number;
  result?: ProductAppRuntimeUserPathRehearsalResult | null;
}

function finiteMetric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function runtimeReadyMetricsFromUnknown(value: unknown): ProductAppRuntimeReadyMetrics | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    bodyChildCount: finiteMetric(record.bodyChildCount),
    visibleElementCount: finiteMetric(record.visibleElementCount),
    interactiveElementCount: finiteMetric(record.interactiveElementCount),
    viewportWidth: finiteMetric(record.viewportWidth),
    viewportHeight: finiteMetric(record.viewportHeight),
    scrollWidth: finiteMetric(record.scrollWidth),
    scrollHeight: finiteMetric(record.scrollHeight),
  };
}

function runtimeReadyPayloadFromUnknown(value: unknown): ProductAppRuntimeReadyPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    appId: typeof record.appId === 'string' ? record.appId : undefined,
    hostSurfaceId: typeof record.hostSurfaceId === 'string' ? record.hostSurfaceId : undefined,
    readyState: typeof record.readyState === 'string' ? record.readyState : undefined,
    route: typeof record.route === 'string' ? record.route : undefined,
    timestampMs: finiteMetric(record.timestampMs),
    sourceRevision: optionalString(record.sourceRevision),
    depsRevision: typeof record.depsRevision === 'string' ? record.depsRevision : undefined,
    depsDirty: optionalBoolean(record.depsDirty),
    workerRestartRequired: optionalBoolean(record.workerRestartRequired),
    metrics: runtimeReadyMetricsFromUnknown(record.metrics),
  };
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return strings.length > 0 ? strings : undefined;
}

function interactionProbeResultFromUnknown(value: unknown): ProductAppRuntimeInteractionProbeResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    candidateCount: finiteMetric(record.candidateCount),
    probed: optionalBoolean(record.probed),
    focused: optionalBoolean(record.focused),
    restoredFocus: optionalBoolean(record.restoredFocus),
    targetTag: optionalString(record.targetTag),
    targetRole: optionalString(record.targetRole),
    targetType: optionalString(record.targetType),
    error: optionalString(record.error),
  };
}

function interactionProbePayloadFromUnknown(value: unknown): ProductAppRuntimeInteractionProbePayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    appId: optionalString(record.appId),
    route: optionalString(record.route),
    timestampMs: finiteMetric(record.timestampMs),
    probe: interactionProbeResultFromUnknown(record.probe),
  };
}

function userPathStepResultFromUnknown(value: unknown): ProductAppRuntimeUserPathRehearsalStepResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    id: optionalString(record.id),
    action: optionalString(record.action),
    target: optionalString(record.target),
    status: optionalString(record.status),
    detail: optionalString(record.detail),
    targetTag: optionalString(record.targetTag),
    targetRole: optionalString(record.targetRole),
    targetType: optionalString(record.targetType),
    focused: optionalBoolean(record.focused),
    expectationCount: finiteMetric(record.expectationCount),
    verifiedExpectationCount: finiteMetric(record.verifiedExpectationCount),
    failedExpectations: optionalStringArray(record.failedExpectations),
    error: optionalString(record.error),
  };
}

function userPathScenarioResultFromUnknown(value: unknown): ProductAppRuntimeUserPathRehearsalScenarioResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const steps = Array.isArray(record.steps)
    ? record.steps.map(userPathStepResultFromUnknown).filter((step): step is ProductAppRuntimeUserPathRehearsalStepResult => Boolean(step))
    : undefined;
  return {
    id: optionalString(record.id),
    kind: optionalString(record.kind),
    stepCount: finiteMetric(record.stepCount),
    steps,
  };
}

function userPathSummaryFromUnknown(value: unknown): ProductAppRuntimeUserPathRehearsalSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    status: optionalString(record.status),
    scenarioCount: finiteMetric(record.scenarioCount),
    stepCount: finiteMetric(record.stepCount),
    passedStepCount: finiteMetric(record.passedStepCount),
    failedStepCount: finiteMetric(record.failedStepCount),
    notVerifiedStepCount: finiteMetric(record.notVerifiedStepCount),
    expectationCount: finiteMetric(record.expectationCount),
    verifiedExpectationCount: finiteMetric(record.verifiedExpectationCount),
    failedExpectationCount: finiteMetric(record.failedExpectationCount),
  };
}

function userPathResultFromUnknown(value: unknown): ProductAppRuntimeUserPathRehearsalResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const scenarios = Array.isArray(record.scenarios)
    ? record.scenarios.map(userPathScenarioResultFromUnknown).filter((scenario): scenario is ProductAppRuntimeUserPathRehearsalScenarioResult => Boolean(scenario))
    : undefined;
  return {
    status: optionalString(record.status),
    summary: userPathSummaryFromUnknown(record.summary),
    scenarios,
    error: optionalString(record.error),
  };
}

function userPathRehearsalPayloadFromUnknown(value: unknown): ProductAppRuntimeUserPathRehearsalPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    appId: optionalString(record.appId),
    route: optionalString(record.route),
    timestampMs: finiteMetric(record.timestampMs),
    result: userPathResultFromUnknown(record.result),
  };
}

const ProductAppRuntimeIframeHost: React.FC<ProductAppRuntimeIframeHostProps> = ({
  app,
  route,
  tabId,
  sessionId,
  scope,
  workspacePath,
  runtimeContext,
  productAppRuntime,
  elementInspectorEnabled = false,
  onElementInspectorHover,
  onElementInspectorSelect,
  onElementInspectorExit,
  onPreviewLoad,
  onPreviewInteractionProbe,
  onPreviewUserPathRehearsal,
  onPreviewBootTimeout,
  previewBootTimeoutMs = 12000,
  userPathRehearsalPlan = null,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const hostedViewsRef = useRef<Record<string, ProductAppRuntimeHostedView>>({});
  const [hostedViews, setHostedViews] = useState<Record<string, ProductAppRuntimeHostedView>>({});
  const previewLoadedRef = useRef(false);
  const iframeLoadedRef = useRef(false);
  const { theme } = useTheme();
  const { currentLanguage } = useI18n();
  const displayMeta = resolveProductAppHostSurfaceMeta(app, currentLanguage);
  const normalizedRoute = useMemo(() => route?.trim() || '/', [route]);
  const effectiveScope = useMemo(
    () => normalizeAppScope(
      scope ||
      productAppRuntime?.scope ||
      appScopeFromWorkspacePath(workspacePath) ||
      systemAppScope(),
    ),
    [productAppRuntime?.scope, scope, workspacePath],
  );
  const effectiveWorkspacePath = workspacePathFromAppScope(effectiveScope);
  const effectiveRuntimeContext = runtimeContext ?? productAppRuntime?.runtimeContext ?? null;
  const productAppId = productAppRuntime?.appId ?? effectiveRuntimeContext?.appId ?? app.id;
  const isExcelLive = productAppId === EXCEL_LIVE_APP_ID;
  const replaceHostedViews = useCallback((next: Record<string, ProductAppRuntimeHostedView>) => {
    hostedViewsRef.current = next;
    setHostedViews(next);
  }, []);
  const hostedViewBridge = useMemo<ProductAppRuntimeHostedViewBridge>(() => ({
    mount(value) {
      const view = normalizeHostedView(value);
      const current = hostedViewsRef.current;
      if (current[view.viewId]) throw new Error(`hosted view already exists: ${view.viewId}`);
      if (Object.keys(current).length >= MAX_HOSTED_VIEWS) {
        throw new Error(`a Product App surface can host at most ${MAX_HOSTED_VIEWS} views`);
      }
      replaceHostedViews({ ...current, [view.viewId]: view });
      return { viewId: view.viewId };
    },
    update(value) {
      const record = value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
      const viewId = normalizeHostedViewId(record.viewId);
      const current = hostedViewsRef.current[viewId];
      if (!current) throw new Error(`hosted view does not exist: ${viewId}`);
      const view = normalizeHostedViewUpdate(value, current);
      if (areHostedViewsEqual(current, view)) return { viewId };
      replaceHostedViews({ ...hostedViewsRef.current, [viewId]: view });
      return { viewId };
    },
    unmount(value) {
      const viewId = normalizeHostedViewId(value);
      const current = hostedViewsRef.current;
      if (!current[viewId]) return;
      const next = { ...current };
      delete next[viewId];
      replaceHostedViews(next);
    },
  }), [replaceHostedViews]);
  useProductAppRuntimeBridge(iframeRef, app, {
    scope: effectiveScope,
    runtimeContext: effectiveRuntimeContext,
    sessionId,
    spreadsheetFocusEnabled: isExcelLive,
    hostedViews: hostedViewBridge,
  });

  useEffect(() => {
    replaceHostedViews({});
  }, [app.compiled_html, effectiveRuntimeContext?.runtimeInstanceId, replaceHostedViews]);

  const postHostedViewEvent = useCallback((event: 'hostedView:change' | 'hostedView:save', payload: unknown) => {
    iframeRef.current?.contentWindow?.postMessage({
      type: 'sparo:event',
      event,
      payload,
    }, '*');
  }, []);

  const pushElementInspectorState = useCallback(() => {
    const target = iframeRef.current?.contentWindow;
    if (!target) return;
    target.postMessage(
      {
        type: 'sparo:event',
        event: 'previewElementInspectorSetEnabled',
        payload: {
          appId: app.id,
          route: normalizedRoute,
          enabled: elementInspectorEnabled,
        },
      },
      '*',
    );
  }, [app.id, elementInspectorEnabled, normalizedRoute]);

  const pushWorkbenchContext = useCallback(() => {
    const target = iframeRef.current?.contentWindow;
    if (!target) return;

    const appId = productAppRuntime?.appId ?? effectiveRuntimeContext?.appId ?? app.id;
    const excelLaunchKey = productAppRuntime?.entityId || null;
    // Peek while the iframe may still be booting; only consume the pending
    // path once the runtime signalled readiness so the message is not lost.
    const iframeReady = previewLoadedRef.current || iframeLoadedRef.current;
    const launchPath = appId === EXCEL_LIVE_APP_ID && excelLaunchKey
      ? (iframeReady
        ? useExcelLiveLaunchStore.getState().consumePendingPath(excelLaunchKey)
        : useExcelLiveLaunchStore.getState().peekPendingPath(excelLaunchKey))
      : null;

    target.postMessage(
      {
        type: 'sparo:event',
        event: 'productAppRuntimeRouteChange',
        payload: {
          productAppId: appId,
          productAppName: productAppRuntime?.appName ?? displayMeta.name,
          hostSurfaceId: app.id,
          hostSurfaceName: displayMeta.name,
          route: normalizedRoute,
          tabId,
          sessionId,
          runtimeContext: effectiveRuntimeContext,
          workspacePath: effectiveWorkspacePath || null,
          scope: effectiveScope,
          entityId: productAppRuntime?.entityId || null,
          launchPath,
          path: launchPath,
          runtime: productAppRuntime
            ? {
              appId: productAppRuntime.appId,
              appName: productAppRuntime.appName,
              hostSurfaceId: productAppRuntime.hostSurfaceId,
              hostSurfaceName: productAppRuntime.hostSurfaceName,
              profile: productAppRuntime.profile,
              entityId: productAppRuntime.entityId,
              workspacePath: productAppRuntime.workspacePath,
              scope: productAppRuntime.scope,
              runtimeContext: productAppRuntime.runtimeContext ?? null,
              interactionTitle: productAppRuntime.interactionTitle,
            }
            : null,
        },
      },
      '*',
    );
  }, [
    app.id,
    displayMeta.name,
    effectiveRuntimeContext,
    effectiveScope,
    effectiveWorkspacePath,
    productAppRuntime,
    normalizedRoute,
    sessionId,
    tabId,
  ]);

  const pushInitialRuntimeState = useCallback(() => {
    const target = iframeRef.current?.contentWindow;
    if (!target) return;

    const themePayload = buildProductAppRuntimeThemeVars(theme);
    if (themePayload) {
      target.postMessage({ type: 'sparo:event', event: 'themeChange', payload: themePayload }, '*');
    }
    if (currentLanguage) {
      target.postMessage(
        { type: 'sparo:event', event: 'localeChange', payload: { locale: currentLanguage } },
        '*',
      );
    }
    pushWorkbenchContext();
    pushElementInspectorState();
  }, [currentLanguage, pushElementInspectorState, pushWorkbenchContext, theme]);

  const requestRuntimeReady = useCallback(() => {
    const target = iframeRef.current?.contentWindow;
    if (!target) return;
    target.postMessage(
      {
        type: 'sparo:event',
        event: 'runtimeReadyProbe',
        payload: {
          appId: app.id,
          route: normalizedRoute,
        },
      },
      '*',
    );
  }, [app.id, normalizedRoute]);

  const requestRuntimeInteractionProbe = useCallback(() => {
    const target = iframeRef.current?.contentWindow;
    if (!target) return;
    target.postMessage(
      {
        type: 'sparo:event',
        event: 'runtimeInteractionProbe',
        payload: {
          appId: app.id,
          route: normalizedRoute,
        },
      },
      '*',
    );
  }, [app.id, normalizedRoute]);

  const requestRuntimeUserPathRehearsal = useCallback(() => {
    const target = iframeRef.current?.contentWindow;
    if (!target || !userPathRehearsalPlan) return;
    target.postMessage(
      {
        type: 'sparo:event',
        event: 'runtimeUserPathRehearsal',
        payload: userPathRehearsalPlan,
      },
      '*',
    );
  }, [userPathRehearsalPlan]);

  const pushSpreadsheetFocusPreference = useCallback((includeOnSend: boolean) => {
    if (!isExcelLive) return;
    const target = iframeRef.current?.contentWindow;
    if (!target) return;
    target.postMessage(
      {
        type: 'sparo:event',
        event: 'spreadsheetFocusPreferenceChange',
        payload: { includeOnSend },
      },
      '*',
    );
  }, [isExcelLive]);

  const handlePreviewLoad = useCallback(() => {
    // The load event fires after the srcdoc module scripts ran, so the
    // iframe message listeners are attached from this point on.
    iframeLoadedRef.current = true;
    pushInitialRuntimeState();
    pushSpreadsheetFocusPreference(useExcelLiveFocusStore.getState().includeOnSend);
    requestRuntimeReady();
  }, [pushInitialRuntimeState, pushSpreadsheetFocusPreference, requestRuntimeReady]);

  useEffect(() => {
    previewLoadedRef.current = false;
    iframeLoadedRef.current = false;
    if (!onPreviewBootTimeout) return undefined;
    const timeout = window.setTimeout(() => {
      if (!previewLoadedRef.current) {
        onPreviewBootTimeout();
      }
    }, previewBootTimeoutMs);
    return () => window.clearTimeout(timeout);
  }, [app.compiled_html, app.id, normalizedRoute, onPreviewBootTimeout, previewBootTimeoutMs]);

  // Ambient spreadsheet focus must not outlive the Excel Live surface,
  // otherwise unrelated chat sessions keep receiving stale focus context.
  useEffect(() => {
    if (!isExcelLive || !sessionId) return undefined;
    return () => {
      const focusState = useExcelLiveFocusStore.getState();
      if (!focusState.getAmbientForSession(sessionId)) return;
      focusState.clearAmbientFocus(sessionId);
    };
  }, [isExcelLive, sessionId]);

  useEffect(() => {
    if (!isExcelLive) return undefined;
    return useExcelLiveFocusStore.subscribe((state, previousState) => {
      if (state.includeOnSend === previousState.includeOnSend) return;
      pushSpreadsheetFocusPreference(state.includeOnSend);
    });
  }, [isExcelLive, pushSpreadsheetFocusPreference]);

  // Forward agent tool completions from the bound chat session so the
  // surface can refresh proposals and cells the agent changed.
  useEffect(() => {
    if (!isExcelLive || !sessionId) return undefined;
    const unlisten = api.listen<AgentToolEventPayload>('agentic://tool-event', (payload) => {
      if (!payload?.sessionId || payload.sessionId !== sessionId) return;
      const target = iframeRef.current?.contentWindow;
      if (!target) return;
      const toolEvent = payload.toolEvent;
      // ToolEventData is a tagged enum: event_type is the variant name
      // (Completed / Failed / ...). Also accept lowercase for safety.
      const eventType = toolEvent?.event_type;
      const workbookId = findWorkbookId(toolEvent?.result)
        ?? findWorkbookId(toolEvent?.params);
      target.postMessage(
        {
          type: 'sparo:event',
          event: 'productAppRuntimeAgentToolEvent',
          payload: {
            sessionId: payload.sessionId,
            toolName: toolEvent?.tool_name,
            eventType,
            workbookId,
          },
        },
        '*',
      );
    });
    return unlisten;
  }, [isExcelLive, sessionId]);

  useEffect(() => {
    pushWorkbenchContext();
  }, [pushWorkbenchContext]);

  useEffect(() => {
    pushElementInspectorState();
  }, [pushElementInspectorState]);

  useLayoutEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as {
        method?: string;
        type?: string;
        appId?: string;
        route?: string;
        event?: string;
        payload?: PreviewElementInspectorPayload;
        params?: {
          appId?: string;
          readyState?: string;
          timestampMs?: number;
        };
      };
      if (data?.method === 'sparo/runtime-ready') {
        const parsedReadyPayload = runtimeReadyPayloadFromUnknown(data.params) ?? (
          data.appId ? { appId: data.appId } : null
        );
        const readyPayload = parsedReadyPayload
          ? {
            ...parsedReadyPayload,
            appId: parsedReadyPayload.appId ?? data.appId ?? app.id,
            hostSurfaceId: parsedReadyPayload.hostSurfaceId,
            sourceRevision: parsedReadyPayload.sourceRevision,
            depsRevision: parsedReadyPayload.depsRevision,
            depsDirty: parsedReadyPayload.depsDirty,
            workerRestartRequired: parsedReadyPayload.workerRestartRequired,
          }
          : null;
        const readyAppId = readyPayload?.appId ?? data.appId;
        if (readyAppId && readyAppId !== app.id) return;
        if (!previewLoadedRef.current) {
          previewLoadedRef.current = true;
          pushInitialRuntimeState();
          requestRuntimeInteractionProbe();
          requestRuntimeUserPathRehearsal();
          onPreviewLoad?.(readyPayload);
        }
        return;
      }
      if (data?.method === 'sparo/interaction-probe') {
        const probePayload = interactionProbePayloadFromUnknown(data.params) ?? (
          data.appId ? { appId: data.appId } : null
        );
        const probeAppId = probePayload?.appId ?? data.appId;
        if (probeAppId && probeAppId !== app.id) return;
        onPreviewInteractionProbe?.(probePayload);
        return;
      }
      if (data?.method === 'sparo/user-path-rehearsal') {
        const rehearsalPayload = userPathRehearsalPayloadFromUnknown(data.params) ?? (
          data.appId ? { appId: data.appId } : null
        );
        const rehearsalAppId = rehearsalPayload?.appId ?? data.appId;
        if (rehearsalAppId && rehearsalAppId !== app.id) return;
        onPreviewUserPathRehearsal?.(rehearsalPayload);
        return;
      }

      if (data?.type !== 'sparo:preview-element-inspector') return;
      if (data.appId && data.appId !== app.id) return;

      if (data.event === 'hover') {
        onElementInspectorHover?.(data.payload ?? null);
      } else if (data.event === 'hover-cleared') {
        onElementInspectorHover?.(null);
      } else if (data.event === 'selected' && data.payload?.element) {
        onElementInspectorSelect?.({ ...data.payload, route: data.route || data.payload.route || normalizedRoute });
      } else if (data.event === 'disabled') {
        onElementInspectorHover?.(null);
        onElementInspectorExit?.();
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [
    app.id,
    normalizedRoute,
    onElementInspectorExit,
    onElementInspectorHover,
    onElementInspectorSelect,
    onPreviewInteractionProbe,
    onPreviewUserPathRehearsal,
    onPreviewLoad,
    pushInitialRuntimeState,
    requestRuntimeInteractionProbe,
    requestRuntimeUserPathRehearsal,
  ]);

  return (
    <div className="product-app-runtime-iframe-host">
      <iframe
        ref={iframeRef}
        className="product-app-runtime-iframe-host__frame"
        srcDoc={app.compiled_html}
        data-app-id={app.id}
        data-product-app-id={effectiveRuntimeContext?.appId ?? productAppRuntime?.appId ?? app.id}
        data-route={normalizedRoute}
        onLoad={handlePreviewLoad}
        sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"
        allow={iframeFeaturePolicy(app)}
        style={{
          background: 'var(--ds-color-bg-app)',
        }}
        title={displayMeta.name}
      />
      {Object.keys(hostedViews).length > 0 && (
        <div className="product-app-runtime-hosted-views">
          {Object.values(hostedViews).map((view) => (
            <div
              key={view.viewId}
              className="product-app-runtime-hosted-view"
              role="region"
              aria-label={view.options.fileName}
              style={{
                display: view.rect.visible ? 'block' : 'none',
                left: view.rect.x,
                top: view.rect.y,
                width: view.rect.width,
                height: view.rect.height,
              }}
            >
              <MarkdownEditor
                initialContent={view.options.content}
                fileName={view.options.fileName}
                readOnly={view.options.readOnly}
                savedVersion={view.options.savedVersion}
                isActiveTab={view.rect.visible}
                modeToolbarHost={view.options.showToolbar ? undefined : null}
                showOutline={view.options.showOutline}
                onContentChange={(content, dirty) => postHostedViewEvent('hostedView:change', {
                  viewId: view.viewId,
                  content,
                  dirty,
                })}
                onSave={(content) => postHostedViewEvent('hostedView:save', {
                  viewId: view.viewId,
                  content,
                })}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ProductAppRuntimeIframeHost;
