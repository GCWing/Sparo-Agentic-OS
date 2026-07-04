import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  AlertTriangle,
  AppWindow,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  GitCompareArrows,
  MoreHorizontal,
  MousePointer2,
  RefreshCw,
  ScrollText,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { DotMatrixLoader } from '@/design-system';
import { api } from '@/infrastructure/api/service-api/ApiClient';
import {
  productAppRuntimeHostAPI,
  type ProductAppHostSurface,
  type ProductAppHostSurfacePermissions,
} from '@/infrastructure/api/service-api/ProductAppRuntimeHostAPI';
import type {
  AppSurfaceMode,
  ProductAppCatalogEntry,
} from '@/infrastructure/api/service-api/AppCatalogAPI';
import { appCatalogAPI } from '@/infrastructure/api/service-api/AppCatalogAPI';
import { useTheme } from '@/infrastructure/theme/hooks/useTheme';
import { useI18n } from '@/infrastructure/i18n';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  DropdownMenu,
  EmptyState,
  FilterPill,
  FilterPillGroup,
  IconButton,
  Search,
  SegmentedControl,
} from '@/design-system';
import type { DropdownMenuEntry } from '@/design-system';
import { flowChatManager } from '@/flow_chat/services/FlowChatManager';
import { flowChatStore } from '@/flow_chat/store/FlowChatStore';
import { notificationService } from '@/shared/notification-system';
import { useContextStore } from '@/shared/stores/contextStore';
import type { ProductAppPreviewElementSelectionContext } from '@/shared/types/context';
import type {
  AppStudioFacts,
  AppStudioIssue,
  AppStudioRuntimeLog,
  AppStudioValidationSummary,
} from '@/shared/types/session-history';
import { agenticOsWorkApi } from '@/app/agentic-os/work/data/workApi';
import { useWorkStore } from '@/app/agentic-os/work/data/workStore';
import type {
  WorkScope,
  WorkExecutionGraph,
  WorkRecord,
  WorkStudioPreviewResult,
  WorkStudioValidationResult,
} from '@/app/agentic-os/work/domain/workTypes';
import { useProductAppRuntimeStore } from '../product-app-runtime/productAppRuntimeStore';
import { useProductAppRuntimeHostActions } from '../product-app-runtime/productAppRuntimeHostActions';
import {
  formatRuntimeTimestamp,
  inferRuntimeHint,
  buildProductAppRuntimeHostSummary,
  isBuiltinBundledProductAppHost,
} from '../product-app-runtime/productAppRuntimeHostModel';
import { resolveProductAppHostSurfaceMeta } from '../product-app-runtime/productAppRuntimeHostMeta';
import {
  openProductAppRuntimeForWorkSurface,
  isProductAppStudioPreviewResolveError,
  resolveProductAppStudioPreviewTarget,
  type ProductAppStudioPreviewFailureContext,
  type ProductAppStudioPreviewTarget,
} from '../product-app-runtime/productAppRuntimeService';
import {
  buildProductAppPreviewElementSelectionContext,
  summarizeProductAppPreviewElementSelection,
} from '../product-app-runtime/productAppRuntimePreviewSelectionContext';
import {
  appScopeIdentity,
  normalizeAppScope,
  systemAppScope,
  type AppScope,
  workspacePathFromAppScope,
} from '@/shared/types/app-scope';
import {
  productAppRuntimeHostEvents,
  type ProductAppRuntimeContext,
} from '@/shared/types/product-app-runtime';
import ProductAppRuntimeIframeHost, {
  type ProductAppPreviewElementInspectorPayload,
  type ProductAppRuntimeInteractionProbePayload,
  type ProductAppRuntimeReadyPayload,
  type ProductAppRuntimeUserPathRehearsalPayload,
} from '../product-app-runtime/ProductAppRuntimeIframeHost';
import {
  buildAppStudioFacts,
  issuesFromExecutionGraph,
  logsFromExecutionGraph,
  mergeStudioIssues,
  mergeStudioLogs,
  normalizeProductAppValidationSummary,
  normalizeRuntimeIssueEvent,
  normalizeRuntimeLogEvent,
  type AppStudioPermissionSummary,
  type AppStudioComponentSubjectFacts,
} from './appStudioFacts';
import {
  buildWorkStudioPreviewResultFromToolResult,
  compactFactId,
  normalizeStudioFactStatus,
  stringFromRecord,
} from './appStudioPreviewResult';
import {
  buildRuntimeBoundaryPreviewResult,
  type RuntimeBoundaryDataProbe,
  type RuntimeBoundaryStorageProbe,
} from './appStudioRuntimeBoundaryEvidence';
import { buildRuntimeDependencyPreviewResult } from './appStudioRuntimeDependencyEvidence';
import {
  buildPermissionReviewPreviewResult,
  permissionReviewElevatedPermissionNames,
} from './appStudioPermissionReviewEvidence';
import './AppStudioWorkbench.scss';

interface AppStudioWorkbenchProps {
  sessionId: string | null;
  appId?: string;
  componentId?: string;
  componentKind?: string;
  componentVersion?: string;
  componentPackageRoot?: string | null;
  componentName?: string | null;
  componentDescription?: string | null;
  scope?: AppScope | null;
  productAppFacts?: {
    packagePath?: string | null;
  } | null;
}

type LogLevel = 'all' | 'error' | 'warn' | 'info';
type DockState = 'collapsed' | 'open';
type AppStudioLatestRelease = NonNullable<NonNullable<AppStudioFacts['versionSummary']>['latestRelease']>;
type WorkbenchTabId =
  | 'blueprint'
  | 'preview'
  | 'issues'
  | 'components'
  | 'agent'
  | 'data'
  | 'eval'
  | 'validation'
  | 'versions'
  | 'permissions'
  | 'share';

function buildReleaseTemplateAppId(sourceAppId: string | undefined, releaseId: string): string {
  const base = (sourceAppId || releaseId || 'release-template')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${base || 'release-template'}-template`;
}

type PreviewObservationOptions = {
  status?: WorkStudioPreviewResult['status'];
  source?: WorkStudioPreviewResult['source'];
  detail?: string;
  runtimeReady?: ProductAppRuntimeReadyPayload | null;
  interactionProbe?: ProductAppRuntimeInteractionProbePayload | null;
  checks?: WorkStudioPreviewResult['checks'];
  issueCount?: number;
  fatalIssueCount?: number;
  warningIssueCount?: number;
  triggerTurnId?: string | null;
};
type WorkStudioPreviewCheck = NonNullable<WorkStudioPreviewResult['checks']>[number];

type PreviewSurfaceDescriptor = {
  kind: WorkStudioPreviewResult['kind'];
  harnessMode: string;
  surfaceMode: AppSurfaceMode | string;
  verified: boolean;
  detail: string;
};

const MAX_VISIBLE_ISSUES = 20;
const MAX_VISIBLE_LOGS = 100;
const WORKBENCH_TAB_IDS: WorkbenchTabId[] = [
  'blueprint',
  'preview',
  'issues',
  'components',
  'agent',
  'data',
  'eval',
  'validation',
  'versions',
  'permissions',
  'share',
];

function stringifyDiagnostic(parts: unknown[]): string {
  return parts
    .filter((part) => part != null && part !== '')
    .map((part) => (typeof part === 'string' ? part : JSON.stringify(part, null, 2)))
    .join('\n');
}

// 鈹€鈹€鈹€ Issue Row 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

interface IssueRowProps {
  issue: AppStudioIssue;
  t: (key: string, opts?: Record<string, unknown>) => string;
  onCopy: (text: string) => void;
  onRecompile: () => void;
  onRestart: () => void;
  onFixWithAi: (issue: AppStudioIssue) => void;
  currentLanguage: string;
  restartLabel: string;
}

const IssueRow: React.FC<IssueRowProps> = ({
  issue, t, onCopy, onRecompile, onRestart, onFixWithAi, currentLanguage, restartLabel,
}) => {
  const [expanded, setExpanded] = useState(issue.severity === 'fatal');
  const hintKey = inferRuntimeHint(issue.message, issue.category ?? undefined);
  const detailText = stringifyDiagnostic([issue.source, issue.stack]);
  const diagText = stringifyDiagnostic([issue.message, detailText]);

  return (
    <div className={`studio-issue is-${issue.severity}`}>
      <Button
        variant="ghost"
        size="small"
        className="studio-issue__summary"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="studio-issue__severity-dot" />
        <span className="studio-issue__message">{issue.message}</span>
        <span className="studio-issue__meta">
          {issue.category ? <span className="studio-issue__category">{issue.category}</span> : null}
          <span>{formatRuntimeTimestamp(issue.timestampMs, currentLanguage)}</span>
        </span>
        <span className="studio-issue__chevron">
          {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </span>
      </Button>

      {expanded ? (
        <div className="studio-issue__detail">
          {hintKey ? (
            <div className="studio-issue__hint">
              {t(`diagnostics.hints.${hintKey}`)}
            </div>
          ) : null}
          {detailText ? <pre className="studio-issue__pre">{detailText}</pre> : null}
          <div className="studio-issue__actions">
            {issue.severity === 'fatal' ? (
              <Button
                variant="accent"
                size="small"
                onClick={() => onFixWithAi(issue)}
              >
                {t('diagnostics.fixWithAi')}
              </Button>
            ) : null}
            {issue.severity === 'fatal' ? (
              <Button variant="secondary" size="small" onClick={onRecompile}>
                {t('panel.menu.recompile')}
              </Button>
            ) : null}
            {issue.severity === 'fatal' ? (
              <Button variant="secondary" size="small" onClick={onRestart}>
                {restartLabel}
              </Button>
            ) : null}
            <IconButton
              variant="ghost"
              size="xs"
              onClick={() => onCopy(diagText)}
              tooltip={t('diagnostics.copy')}
              aria-label={t('diagnostics.copy')}
            >
              <Copy size={11} />
            </IconButton>
          </div>
        </div>
      ) : null}
    </div>
  );
};

// 鈹€鈹€鈹€ Log Row 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

interface LogRowProps {
  entry: AppStudioRuntimeLog;
  onCopy: (text: string) => void;
  currentLanguage: string;
  copyAriaLabel: string;
}

const LogRow: React.FC<LogRowProps> = ({ entry, onCopy, currentLanguage, copyAriaLabel }) => {
  const [expanded, setExpanded] = useState(false);
  const detailText = stringifyDiagnostic([
    entry.source,
    entry.details != null ? entry.details : undefined,
    entry.stack,
  ]);
  const diagText = stringifyDiagnostic([entry.message, detailText]);
  const hasDetail = Boolean(detailText);

  return (
    <div className={`studio-log is-${entry.level}`}>
      <Button
        variant="ghost"
        size="small"
        className="studio-log__summary"
        onClick={() => hasDetail && setExpanded((v) => !v)}
        aria-expanded={hasDetail ? expanded : undefined}
        style={{ cursor: hasDetail ? 'pointer' : 'default' }}
      >
        <span className="studio-log__level-bar" />
        <span className="studio-log__message">{entry.message}</span>
        <span className="studio-log__meta">
          <span className="studio-log__category">{entry.level}/{entry.category}</span>
          <span>{formatRuntimeTimestamp(entry.timestampMs, currentLanguage)}</span>
        </span>
        {hasDetail ? (
          <span className="studio-log__chevron">
            {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </span>
        ) : null}
      </Button>

      {expanded && detailText ? (
        <div className="studio-log__detail">
          <pre className="studio-log__pre">{detailText}</pre>
          <div className="studio-log__actions">
            <IconButton
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => onCopy(diagText)}
              tooltip={copyAriaLabel}
              aria-label={copyAriaLabel}
            >
              <Copy size={11} />
            </IconButton>
          </div>
        </div>
      ) : null}
    </div>
  );
};

interface FactRow {
  label: string;
  value: React.ReactNode;
  state?: 'ok' | 'warning' | 'error' | 'neutral';
}

interface FactSectionProps {
  title: string;
  description?: string;
  rows: FactRow[];
  empty?: string;
}

const FactSection: React.FC<FactSectionProps> = ({ title, description, rows, empty }) => (
  <section className="studio-fact-section">
    <div className="studio-fact-section__header">
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
    </div>
    {rows.length > 0 ? (
      <div className="studio-fact-grid">
        {rows.map((row) => (
          <div className="studio-fact-row" key={row.label}>
            <span className="studio-fact-row__label">{row.label}</span>
            <span className={`studio-fact-row__value${row.state ? ` is-${row.state}` : ''}`}>
              {row.value}
            </span>
          </div>
        ))}
      </div>
    ) : (
      <div className="studio-fact-section__empty">{empty}</div>
    )}
  </section>
);

function textOrFallback(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function boolState(enabled: boolean): 'ok' | 'neutral' {
  return enabled ? 'ok' : 'neutral';
}

function workScopeFromAppScope(scope: AppScope): WorkScope {
  return scope.kind === 'workspace' && scope.workspacePath
    ? { kind: 'workspace', workspacePath: scope.workspacePath }
    : { kind: 'system' };
}

function previewCheck(
  id: string,
  status: WorkStudioPreviewCheck['status'],
  detail: string,
): WorkStudioPreviewCheck {
  return { id, status, detail };
}

function hasPositiveMetric(value: number | undefined): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function countPreviewChecks(
  checks: readonly WorkStudioPreviewCheck[],
  statuses: readonly WorkStudioPreviewCheck['status'][],
): number {
  return checks.filter((check) => statuses.includes(check.status)).length;
}

function derivePreviewObservationStatus(
  checks: readonly WorkStudioPreviewCheck[],
): WorkStudioPreviewResult['status'] {
  if (checks.some((check) => check.status === 'failed' || check.status === 'blocked')) return 'failed';
  if (checks.some((check) => check.status === 'running' || check.status === 'waiting')) return 'running';
  if (checks.some((check) => check.status === 'notRun' || check.status === 'notVerified')) return 'notVerified';
  if (checks.some((check) => check.status === 'warning')) return 'warning';
  return checks.length > 0 ? 'passed' : 'notVerified';
}

function previewSurfaceDescriptorForMode(
  surfaceMode: AppSurfaceMode | string | null | undefined,
): PreviewSurfaceDescriptor {
  switch (surfaceMode) {
    case 'chatPrimary':
      return {
        kind: 'product-app-preview',
        harnessMode: 'product-app-preview',
        surfaceMode,
        verified: false,
        detail: 'Product App declares chatPrimary; Agent Chat preview requires the hidden-turn harness, so this iframe host observation remains a generic runtime preview.',
      };
    case 'sidecarLinked':
      return {
        kind: 'sidecar',
        harnessMode: 'sidecar',
        surfaceMode,
        verified: true,
        detail: 'Product App declares sidecarLinked; Workbench recorded the sidecar preview harness for this app shape.',
      };
    case 'immersivePrimary':
      return {
        kind: 'full-app',
        harnessMode: 'full-app',
        surfaceMode,
        verified: true,
        detail: 'Product App declares immersivePrimary; Workbench recorded the full app preview harness for this app shape.',
      };
    case 'embeddedObject':
      return {
        kind: 'embedded',
        harnessMode: 'embedded',
        surfaceMode,
        verified: true,
        detail: 'Product App declares embeddedObject; Workbench recorded the embedded object preview harness for this app shape.',
      };
    default:
      return {
        kind: 'product-app-preview',
        harnessMode: 'product-app-preview',
        surfaceMode: surfaceMode || 'unknown',
        verified: false,
        detail: 'Product App did not provide a recognized primary surface mode; Workbench recorded a generic Product App preview.',
      };
  }
}

function previewSurfaceDescriptorForTarget(target: ProductAppStudioPreviewTarget): PreviewSurfaceDescriptor {
  if (target.productApp.launch?.kind === 'agentSession') {
    return {
      kind: 'agent-chat',
      harnessMode: 'agent-chat',
      surfaceMode: 'agentSession',
      verified: true,
      detail: 'Product App declares an agentSession entry; Workbench recorded the Agent Chat preview harness for this app shape.',
    };
  }
  return previewSurfaceDescriptorForMode(target.productApp.primarySurfaceMode);
}

function previewSurfaceDescriptorForFailureContext(
  context: ProductAppStudioPreviewFailureContext,
): PreviewSurfaceDescriptor {
  if (context.productApp.launch?.kind === 'agentSession') {
    return {
      kind: 'agent-chat',
      harnessMode: 'agent-chat',
      surfaceMode: 'agentSession',
      verified: true,
      detail: 'Product App declares an agentSession entry; Workbench recorded the Agent Chat preview harness for this app shape.',
    };
  }
  return previewSurfaceDescriptorForMode(context.productApp.primarySurfaceMode);
}

function buildPreviewObservationChecks(
  target: ProductAppStudioPreviewTarget,
  options: PreviewObservationOptions,
): WorkStudioPreviewCheck[] {
  if (options.checks) return options.checks;

  const previewSurface = previewSurfaceDescriptorForTarget(target);
  const runtimeReady = options.runtimeReady ?? null;
  const interactionProbe = options.interactionProbe ?? null;
  const metrics = runtimeReady?.metrics ?? null;
  const probe = interactionProbe?.probe ?? null;
  const isFailedObservation = options.status === 'failed' || options.status === 'blocked';
  const viewportWidth = metrics?.viewportWidth;
  const viewportHeight = metrics?.viewportHeight;
  const bodyChildCount = metrics?.bodyChildCount;
  const visibleElementCount = metrics?.visibleElementCount;
  const interactiveElementCount = metrics?.interactiveElementCount;
  const interactionCandidateCount = probe?.candidateCount ?? interactiveElementCount;
  const hasVisualRoot = hasPositiveMetric(bodyChildCount) || hasPositiveMetric(visibleElementCount);
  const hasViewport = hasPositiveMetric(viewportWidth) && hasPositiveMetric(viewportHeight);
  const interactionProbeRan = interactionProbe != null;
  const interactionProbeFailed = Boolean(probe?.error) || (
    interactionProbeRan &&
    hasPositiveMetric(interactionCandidateCount) &&
    probe?.focused === false
  );
  const interactionSurfaceStatus: WorkStudioPreviewCheck['status'] =
    interactionProbeFailed
      ? 'failed'
      : probe?.focused
        ? 'passed'
        : 'notVerified';
  const interactionDetail = interactionProbeRan
    ? (
      probe?.focused
        ? `Runtime focus probe reached ${probe.targetTag || 'an interactive element'} from ${interactionCandidateCount ?? 0} candidate(s).`
        : probe?.error
          ? `Runtime focus probe failed: ${probe.error}`
          : `Runtime focus probe found ${interactionCandidateCount ?? 0} candidate(s), but no focusable interaction target was verified.`
    )
    : metrics
      ? `Runtime DOM reported ${interactionCandidateCount ?? 0} interactive candidate(s); focus probe has not completed.`
      : 'No runtime interaction metrics were provided.';

  return [
    previewCheck(
      'surfaceMode',
      previewSurface.verified ? 'passed' : 'notVerified',
      previewSurface.detail,
    ),
    previewCheck(
      'runtimeReady',
      runtimeReady ? 'passed' : (isFailedObservation ? 'failed' : 'notVerified'),
      runtimeReady
        ? `Iframe runtime bridge reported ${runtimeReady.readyState || 'ready'} for ${runtimeReady.appId || target.resolvedRuntime.productAppId}.`
        : 'No iframe runtime-ready bridge handshake was observed.',
    ),
    previewCheck(
      'hostFrame',
      'passed',
      `Product App Runtime host bound runtime ${target.resolvedRuntime.runtimeInstanceId} to surface ${target.resolvedRuntime.productAppSurfaceId}/${target.resolvedRuntime.surfaceId}.`,
    ),
    previewCheck(
      'visualRoot',
      metrics ? (hasVisualRoot ? 'passed' : 'failed') : 'notVerified',
      metrics
        ? `Runtime DOM reported ${bodyChildCount ?? 0} body child node(s) and ${visibleElementCount ?? 0} visible element(s).`
        : 'Runtime did not provide DOM root metrics.',
    ),
    previewCheck(
      'viewport',
      metrics ? (hasViewport ? 'passed' : 'warning') : 'notVerified',
      metrics
        ? `Runtime viewport reported ${viewportWidth ?? 0}x${viewportHeight ?? 0}; scroll area ${metrics.scrollWidth ?? 0}x${metrics.scrollHeight ?? 0}.`
        : 'Runtime did not provide viewport metrics.',
    ),
    previewCheck(
      'interactionSurface',
      interactionSurfaceStatus,
      interactionDetail,
    ),
  ];
}

function sharedConsumerComponents(
  productApp: ProductAppCatalogEntry,
): NonNullable<ProductAppCatalogEntry['components']> {
  return (productApp.components ?? []).filter((component) => component.source === 'shared');
}

function buildConsumerCompatibilityPreviewResults(
  target: ProductAppStudioPreviewTarget,
  observedAt: number,
  runtimeReady: ProductAppRuntimeReadyPayload | null,
  primaryChecks: readonly WorkStudioPreviewCheck[],
  primaryStatus: WorkStudioPreviewResult['status'],
): WorkStudioPreviewResult[] {
  const components = sharedConsumerComponents(target.productApp);
  if (components.length === 0) return [];

  const previewFailed =
    primaryStatus === 'failed' ||
    primaryStatus === 'blocked' ||
    primaryChecks.some((check) => check.status === 'failed' || check.status === 'blocked');
  const primaryChecksPassed = primaryChecks.length > 0 &&
    primaryChecks.every((check) => check.status === 'passed');
  const canPass = Boolean(runtimeReady) && !previewFailed && primaryChecksPassed;
  return components.map((component) => {
    const versionLabel = component.version ? `@${component.version}` : '';
    const status: WorkStudioPreviewResult['status'] = canPass ? 'passed' : 'notVerified';
    const detail = canPass
      ? `Consumer Product App ${target.productApp.id}@${target.productApp.version} loaded runtime instance ${target.resolvedRuntime.runtimeInstanceId} with shared ${component.kind} component ${component.componentId}${versionLabel}.`
      : runtimeReady
        ? `Consumer Product App ${target.productApp.id}@${target.productApp.version} reached runtime-ready, but primary preview checks are not all passed before ${component.componentId}${versionLabel} compatibility can pass.`
        : `Consumer Product App ${target.productApp.id}@${target.productApp.version} declares shared ${component.kind} component ${component.componentId}${versionLabel}, but runtime-ready consumer evidence has not been recorded.`;

    return {
      id: `preview:consumer-compatibility:${target.resolvedRuntime.runtimeInstanceId}:${component.componentId}`,
      kind: 'capability',
      status,
      source: 'runtime-observation',
      harnessMode: 'consumer-compatibility',
      triggerTurnId: null,
      detail,
      checks: [
        previewCheck('consumerCompatibility', status, detail),
      ],
      workId: target.work.id,
      runtimeInstanceId: target.resolvedRuntime.runtimeInstanceId,
      productAppId: target.resolvedRuntime.productAppId,
      componentId: component.componentId,
      productAppSurfaceId: target.resolvedRuntime.productAppSurfaceId,
      surfaceId: target.resolvedRuntime.surfaceId,
      observedAt,
      issueCount: 0,
      fatalIssueCount: 0,
      warningIssueCount: 0,
    };
  });
}

function buildSharedComponentRuntimeEvidencePreviewResults(
  target: ProductAppStudioPreviewTarget,
  previewResult: WorkStudioPreviewResult,
): WorkStudioPreviewResult[] {
  const components = sharedConsumerComponents(target.productApp);
  if (components.length === 0) return [];

  const checks = previewResult.checks ?? [];
  return components.map((component) => {
    const versionLabel = component.version ? `@${component.version}` : '';
    return {
      ...previewResult,
      id: `${previewResult.id}:${component.componentId}`,
      detail: `Consumer Product App ${target.productApp.id}@${target.productApp.version} recorded ${previewResult.harnessMode} evidence for shared ${component.kind} component ${component.componentId}${versionLabel}. ${previewResult.detail ?? ''}`.trim(),
      checks: checks.map((check) => ({
        ...check,
        detail: check.detail
          ? `Consumer Product App ${target.productApp.id}@${target.productApp.version} -> ${component.componentId}${versionLabel}: ${check.detail}`
          : check.detail,
      })),
      componentId: component.componentId,
      productAppSurfaceId: target.resolvedRuntime.productAppSurfaceId,
      surfaceId: target.resolvedRuntime.surfaceId,
    };
  });
}

function userPathStatusFromRehearsal(
  payload: ProductAppRuntimeUserPathRehearsalPayload | null,
): WorkStudioPreviewCheck['status'] {
  const summary = payload?.result?.summary;
  const resultStatus = payload?.result?.status;
  if (resultStatus === 'failed' || resultStatus === 'blocked') {
    return resultStatus;
  }
  if (summary) {
    if ((summary.failedStepCount ?? 0) > 0) return 'failed';
    if ((summary.notVerifiedStepCount ?? 0) > 0) return 'notVerified';
    if (!hasPositiveMetric(summary.expectationCount)) return 'notVerified';
    if ((summary.failedExpectationCount ?? 0) > 0) return 'notVerified';
    if (
      hasPositiveMetric(summary.expectationCount) &&
      (summary.verifiedExpectationCount ?? 0) < (summary.expectationCount ?? 0)
    ) return 'notVerified';
  }
  if (resultStatus === 'notVerified') {
    return resultStatus;
  }
  if (!summary || !hasPositiveMetric(summary.scenarioCount) || !hasPositiveMetric(summary.stepCount)) return 'notVerified';
  if (resultStatus === 'passed') return 'passed';
  return 'notVerified';
}

function userPathDetailFromRehearsal(
  payload: ProductAppRuntimeUserPathRehearsalPayload | null,
): string {
  const summary = payload?.result?.summary;
  if (payload?.result?.error) return `User-path rehearsal failed: ${payload.result.error}`;
  if (!summary) return 'No user-path rehearsal result was returned by the iframe runtime.';
  const expectationDetail = hasPositiveMetric(summary.expectationCount)
    ? ` Expectations verified ${summary.verifiedExpectationCount ?? 0}/${summary.expectationCount ?? 0}; ${summary.failedExpectationCount ?? 0} failed.`
    : ' No runtime expectations were declared or verified.';
  return `Executed ${summary.scenarioCount ?? 0} user-path scenario(s), ${summary.stepCount ?? 0} step(s): ${summary.passedStepCount ?? 0} passed, ${summary.failedStepCount ?? 0} failed, ${summary.notVerifiedStepCount ?? 0} not verified.${expectationDetail}`;
}

function statusState(status: string): 'ok' | 'warning' | 'error' | 'neutral' {
  if (status === 'passed') return 'ok';
  if (status === 'failed' || status === 'blocked') return 'error';
  if (status === 'warning' || status === 'ready' || status === 'notRun' || status === 'notVerified') return 'warning';
  return 'neutral';
}

function lifecyclePolicyLabelKey(value: string | null | undefined): string {
  switch (value) {
    case 'workRuntimeScoped':
      return 'workbench.values.lifecycleWorkRuntimeScoped';
    case 'sessionScoped':
      return 'workbench.values.lifecycleSessionScoped';
    case 'userManaged':
      return 'workbench.values.lifecycleUserManaged';
    case 'externalSystem':
      return 'workbench.values.lifecycleExternalSystem';
    case 'deleteWithWork':
      return 'workbench.values.lifecycleDeleteWithWork';
    case 'deleteOnUserRequest':
      return 'workbench.values.lifecycleDeleteOnUserRequest';
    case 'noDurableData':
      return 'workbench.values.lifecycleNoDurableData';
    case 'notSupported':
      return 'workbench.values.lifecycleNotSupported';
    case 'exportImport':
      return 'workbench.values.lifecycleExportImport';
    case 'schemaVersioned':
      return 'workbench.values.lifecycleSchemaVersioned';
    case 'excludeRuntimePrivateData':
      return 'workbench.values.lifecycleExcludeRuntimePrivateData';
    case 'declaredWorkObjectsOnly':
      return 'workbench.values.lifecycleDeclaredWorkObjectsOnly';
    case 'externalReferenceOnly':
      return 'workbench.values.lifecycleExternalReferenceOnly';
    default:
      return 'workbench.values.notVerified';
  }
}

function visibilityLabelKey(value: string | null | undefined): string | null {
  switch (value) {
    case 'privateDraft':
      return 'workbench.values.privateDraft';
    case 'privateRelease':
      return 'workbench.values.privateRelease';
    case 'catalogSource':
      return 'workbench.values.catalogSource';
    default:
      return null;
  }
}

function visibilityLabel(value: string | null | undefined, t: (key: string) => string): string {
  const labelKey = visibilityLabelKey(value);
  if (labelKey) return t(labelKey);
  return value || t('workbench.values.unknown');
}

function joinList(values: readonly string[] | undefined, fallback: string): string {
  return values && values.length > 0 ? values.join(', ') : fallback;
}

function compactDigest(value?: string | null): string {
  if (!value) return '';
  const prefix = value.startsWith('sha256:') ? 'sha256:' : '';
  const digest = prefix ? value.slice(prefix.length) : value;
  return `${prefix}${digest.slice(0, 12)}`;
}

function persistedAppStudioFactsForSession(sessionId: string | null): AppStudioFacts | null {
  if (!sessionId) return null;
  return flowChatStore.getState().sessions.get(sessionId)?.customMetadata?.appStudioFacts ?? null;
}

function runtimeHostPermissionSummary(app: ProductAppHostSurface): AppStudioPermissionSummary {
  const permissions: ProductAppHostSurfacePermissions = app.permissions ?? {};
  return {
    readsWorkspace: permissionScopesIncludeWorkspace(permissions.fs?.read),
    writesWorkspace: permissionScopesIncludeWorkspace(permissions.fs?.write),
    shellEnabled: permissionAllowListEnabled(permissions.shell?.allow),
    netEnabled: permissionAllowListEnabled(permissions.net?.allow),
    aiEnabled: permissions.ai?.enabled === true,
    nodeEnabled: permissions.node?.enabled === true,
  };
}

function permissionScopesIncludeWorkspace(scopes: readonly string[] | undefined): boolean {
  return Array.isArray(scopes) && scopes.includes('{workspace}');
}

function permissionAllowListEnabled(allowList: readonly string[] | undefined): boolean {
  return Array.isArray(allowList) && allowList.length > 0;
}

async function recordPreviewObservationForTarget(
  target: ProductAppStudioPreviewTarget,
  options: PreviewObservationOptions,
  refreshExecutionGraph: (workId: string) => Promise<void>,
): Promise<void> {
  const observedAt = Date.now();
  const previewSurface = previewSurfaceDescriptorForTarget(target);
  const checks = buildPreviewObservationChecks(target, options);
  const derivedFatalIssueCount = countPreviewChecks(checks, ['failed', 'blocked']);
  const derivedWarningIssueCount = countPreviewChecks(checks, ['warning']);
  const fatalIssueCount = options.fatalIssueCount ?? derivedFatalIssueCount;
  const warningIssueCount = options.warningIssueCount ?? derivedWarningIssueCount;
  const issueCount = options.issueCount ?? fatalIssueCount + warningIssueCount;
  const previewResult: WorkStudioPreviewResult = {
    id: `preview:${target.resolvedRuntime.runtimeInstanceId}`,
    kind: previewSurface.kind,
    status: options.status ?? derivePreviewObservationStatus(checks),
    source: options.source ?? 'runtime-observation',
    harnessMode: previewSurface.harnessMode,
    triggerTurnId: options.triggerTurnId ?? null,
    detail: options.detail ?? 'Preview iframe runtime bridge reported ready.',
    checks,
    workId: target.work.id,
    runtimeInstanceId: target.resolvedRuntime.runtimeInstanceId,
    productAppId: target.resolvedRuntime.productAppId,
    componentId: target.resolvedRuntime.productAppSurfaceId,
    productAppSurfaceId: target.resolvedRuntime.productAppSurfaceId,
    surfaceId: target.resolvedRuntime.surfaceId,
    observedAt,
    issueCount,
    fatalIssueCount,
    warningIssueCount,
  };
  await agenticOsWorkApi.recordStudioPreviewResult({
    workId: target.work.id,
    previewResult,
  });
  for (const componentPreviewResult of buildConsumerCompatibilityPreviewResults(
    target,
    observedAt,
    options.runtimeReady ?? null,
    checks,
    previewResult.status,
  )) {
    await agenticOsWorkApi.recordStudioPreviewResult({
      workId: target.work.id,
      previewResult: componentPreviewResult,
    });
  }
  await refreshExecutionGraph(target.work.id);
}

async function recordPreviewObservationForFailureContext(
  context: ProductAppStudioPreviewFailureContext,
  detail: string,
  refreshExecutionGraph: (workId: string) => Promise<void>,
): Promise<void> {
  const runtimeInstanceId = context.resolvedRuntime?.runtimeInstanceId ?? context.runtimeInstance?.id;
  const previewId = runtimeInstanceId
    ? `preview:${runtimeInstanceId}`
    : `preview:${context.work.id}:${context.stage}:${context.surface.productAppSurfaceId}:${context.surface.surfaceId}`;
  const observedAt = Date.now();
  const previewSurface = previewSurfaceDescriptorForFailureContext(context);
  const checks: WorkStudioPreviewCheck[] = [
    previewCheck(
      'surfaceMode',
      previewSurface.verified ? 'passed' : 'notVerified',
      previewSurface.detail,
    ),
    previewCheck(
      'runtimeReady',
      runtimeInstanceId ? 'notVerified' : 'blocked',
      runtimeInstanceId
        ? `Runtime instance ${runtimeInstanceId} was resolved, but no runtime-ready bridge handshake was observed.`
        : 'No runtime instance was available for preview observation.',
    ),
    previewCheck(
      'hostFrame',
      'failed',
      detail,
    ),
    previewCheck(
      'visualRoot',
      'notVerified',
      'Preview failed before iframe runtime DOM metrics could be observed.',
    ),
    previewCheck(
      'interactionSurface',
      'notVerified',
      'Preview failed before runtime interaction metrics could be observed.',
    ),
  ];
  const previewResult: WorkStudioPreviewResult = {
    id: previewId,
    kind: previewSurface.kind,
    status: 'failed',
    source: 'runtime-observation',
    harnessMode: previewSurface.harnessMode,
    triggerTurnId: null,
    detail,
    checks,
    workId: context.work.id,
    runtimeInstanceId: runtimeInstanceId ?? null,
    productAppId: context.resolvedRuntime?.productAppId ?? context.surface.productAppId,
    componentId: context.resolvedRuntime?.productAppSurfaceId ?? context.surface.productAppSurfaceId,
    productAppSurfaceId: context.resolvedRuntime?.productAppSurfaceId ?? context.surface.productAppSurfaceId,
    surfaceId: context.resolvedRuntime?.surfaceId ?? context.surface.surfaceId,
    observedAt,
    issueCount: 1,
    fatalIssueCount: 1,
    warningIssueCount: 0,
  };
  await agenticOsWorkApi.recordStudioPreviewResult({
    workId: context.work.id,
    previewResult,
  });
  await refreshExecutionGraph(context.work.id);
}

async function recordUserPathRehearsalForTarget(
  target: ProductAppStudioPreviewTarget,
  payload: ProductAppRuntimeUserPathRehearsalPayload | null,
  refreshExecutionGraph: (workId: string) => Promise<void>,
): Promise<void> {
  const observedAt = payload?.timestampMs ?? Date.now();
  const userPathStatus = userPathStatusFromRehearsal(payload);
  const detail = userPathDetailFromRehearsal(payload);
  const failed = userPathStatus === 'failed' || userPathStatus === 'blocked';
  const checks: WorkStudioPreviewCheck[] = [
    previewCheck(
      'criticalPath',
      userPathStatus,
      userPathStatus === 'passed'
        ? 'New-user critical path rehearsal executed in the iframe runtime.'
        : detail,
    ),
    previewCheck('userPath', userPathStatus, detail),
  ];
  const previewResult: WorkStudioPreviewResult = {
    id: `preview:user-path-rehearsal:${target.resolvedRuntime.runtimeInstanceId}`,
    kind: 'user-path-rehearsal',
    status: userPathStatus,
    source: 'runtime-observation',
    harnessMode: 'user-path-rehearsal',
    triggerTurnId: null,
    detail,
    checks,
    workId: target.work.id,
    runtimeInstanceId: target.resolvedRuntime.runtimeInstanceId,
    productAppId: target.resolvedRuntime.productAppId,
    componentId: target.resolvedRuntime.productAppSurfaceId,
    productAppSurfaceId: target.resolvedRuntime.productAppSurfaceId,
    surfaceId: target.resolvedRuntime.surfaceId,
    observedAt,
    issueCount: failed ? 1 : 0,
    fatalIssueCount: failed ? 1 : 0,
    warningIssueCount: 0,
  };
  await agenticOsWorkApi.recordStudioPreviewResult({
    workId: target.work.id,
    previewResult,
  });
  await refreshExecutionGraph(target.work.id);
}

async function recordRuntimeBoundaryEvidenceForTarget(
  target: ProductAppStudioPreviewTarget,
  permissionSummary: AppStudioPermissionSummary | null,
  refreshExecutionGraph: (workId: string) => Promise<void>,
): Promise<void> {
  let storageProbe: RuntimeBoundaryStorageProbe;
  let dataProbe: RuntimeBoundaryDataProbe = { status: 'notVerified' };
  try {
    const probe = await productAppRuntimeHostAPI.probeRuntimeStorage(
      target.resolvedRuntime.host.surfaceId,
      target.resolvedRuntime.runtimeContext,
      target.workspacePath,
    );
    storageProbe = probe.available === true
      ? { status: 'passed', scope: probe.scope ?? 'work-runtime' }
      : { status: 'failed', error: 'Runtime storage probe did not confirm availability.' };
  } catch (error) {
    storageProbe = {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (storageProbe.status === 'passed') {
    try {
      const probe = await productAppRuntimeHostAPI.probeRuntimeDataLifecycle(
        target.resolvedRuntime.host.surfaceId,
        target.resolvedRuntime.runtimeContext,
        target.workspacePath,
      );
      dataProbe = probe.available === true &&
        probe.writeVerified === true &&
        probe.readVerified === true &&
        probe.deleteVerified === true
        ? {
          status: 'passed',
          scope: probe.scope ?? 'work-runtime',
          probeKey: probe.probeKey ?? null,
          writeVerified: true,
          readVerified: true,
          deleteVerified: true,
        }
        : {
          status: 'failed',
          scope: probe.scope ?? 'work-runtime',
          probeKey: probe.probeKey ?? null,
          writeVerified: probe.writeVerified,
          readVerified: probe.readVerified,
          deleteVerified: probe.deleteVerified,
          error: 'Runtime storage readiness probe did not verify write/read/delete behavior.',
        };
    } catch (error) {
      dataProbe = {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const previewResult = buildRuntimeBoundaryPreviewResult({
    workId: target.work.id,
    productApp: target.productApp,
    runtimeContext: target.resolvedRuntime.runtimeContext,
    componentId: target.resolvedRuntime.productAppSurfaceId,
    productAppSurfaceId: target.resolvedRuntime.productAppSurfaceId,
    surfaceId: target.resolvedRuntime.surfaceId,
    permissionSummary,
    storageProbe,
    dataProbe,
    observedAt: Date.now(),
  });

  await agenticOsWorkApi.recordStudioPreviewResult({
    workId: target.work.id,
    previewResult,
  });
  for (const componentPreviewResult of buildSharedComponentRuntimeEvidencePreviewResults(
    target,
    previewResult,
  )) {
    await agenticOsWorkApi.recordStudioPreviewResult({
      workId: target.work.id,
      previewResult: componentPreviewResult,
    });
  }
  await refreshExecutionGraph(target.work.id);
}

async function recordRuntimeDependencyEvidenceForTarget(
  target: ProductAppStudioPreviewTarget,
  hostSurface: ProductAppHostSurface | null,
  runtimeSummary: ReturnType<typeof buildProductAppRuntimeHostSummary> | null,
  runtimeReady: ProductAppRuntimeReadyPayload | null,
  refreshExecutionGraph: (workId: string) => Promise<void>,
): Promise<void> {
  if (!hostSurface || !runtimeSummary) return;
  const previewResult = buildRuntimeDependencyPreviewResult({
    workId: target.work.id,
    productApp: target.productApp,
    runtimeContext: target.resolvedRuntime.runtimeContext,
    componentId: target.resolvedRuntime.productAppSurfaceId,
    productAppSurfaceId: target.resolvedRuntime.productAppSurfaceId,
    surfaceId: target.resolvedRuntime.surfaceId,
    hostSurface,
    runtimeSummary,
    runtimeReady,
    observedAt: Date.now(),
  });
  await agenticOsWorkApi.recordStudioPreviewResult({
    workId: target.work.id,
    previewResult,
  });
  for (const componentPreviewResult of buildSharedComponentRuntimeEvidencePreviewResults(
    target,
    previewResult,
  )) {
    await agenticOsWorkApi.recordStudioPreviewResult({
      workId: target.work.id,
      previewResult: componentPreviewResult,
    });
  }
  await refreshExecutionGraph(target.work.id);
}

// 鈹€鈹€鈹€ Main Component 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

const AppStudioWorkbench: React.FC<AppStudioWorkbenchProps> = ({
  sessionId,
  appId,
  componentId,
  componentKind,
  componentVersion,
  componentPackageRoot,
  componentName,
  componentDescription,
  scope,
  productAppFacts,
}) => {
  const { themeType } = useTheme();
  const { currentLanguage, t } = useI18n('scenes/app-studio');
  const runningWorkerIds = useProductAppRuntimeStore((state) => state.runningWorkerIds);
  const runtimeStatus = useProductAppRuntimeStore((state) => state.runtimeStatus);

  const [productApp, setProductApp] = useState<ProductAppCatalogEntry | null>(null);
  const [previewTarget, setPreviewTarget] = useState<ProductAppStudioPreviewTarget | null>(null);
  const [componentWork, setComponentWork] = useState<WorkRecord | null>(null);
  const [app, setApp] = useState<ProductAppHostSurface | null>(null);
  const [runtimeContext, setRuntimeContext] = useState<ProductAppRuntimeContext | null>(null);
  const [executionGraph, setExecutionGraph] = useState<WorkExecutionGraph | null>(null);
  const [runtimeEventIssues, setRuntimeEventIssues] = useState<AppStudioIssue[]>([]);
  const [runtimeEventLogs, setRuntimeEventLogs] = useState<AppStudioRuntimeLog[]>([]);
  const [validationSummary, setValidationSummary] = useState<AppStudioValidationSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [runtimeView, setRuntimeView] = useState<'issues' | 'logs'>('issues');
  const [dockState, setDockState] = useState<DockState>('collapsed');
  const [sendingIssues, setSendingIssues] = useState(false);
  const [clearingIssues, setClearingIssues] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [logFilter, setLogFilter] = useState<LogLevel>('all');
  const [logSearch, setLogSearch] = useState('');
  const [followTail, setFollowTail] = useState(true);
  const [newLogCount, setNewLogCount] = useState(0);
  const [previewInspectorEnabled, setPreviewInspectorEnabled] = useState(false);
  const [previewInspectorHover, setPreviewInspectorHover] = useState<ProductAppPreviewElementInspectorPayload | null>(null);
  const [previewSelection, setPreviewSelection] = useState<ProductAppPreviewElementSelectionContext | null>(null);
  const [addingPreviewSelection, setAddingPreviewSelection] = useState(false);
  const [recordingPermissionReview, setRecordingPermissionReview] = useState(false);
  const [restoreReleaseTarget, setRestoreReleaseTarget] = useState<AppStudioLatestRelease | null>(null);
  const [requestingReleaseRestore, setRequestingReleaseRestore] = useState(false);
  const [requestingReleaseCompare, setRequestingReleaseCompare] = useState(false);
  const [requestingReleaseTemplate, setRequestingReleaseTemplate] = useState(false);
  const [activeTab, setActiveTab] = useState<WorkbenchTabId>('preview');

  const menuAnchorRef = useRef<HTMLButtonElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsScrollRef = useRef<HTMLDivElement>(null);
  const previewTargetRef = useRef<ProductAppStudioPreviewTarget | null>(null);
  const lastRuntimeReadyRef = useRef<ProductAppRuntimeReadyPayload | null>(null);
  const pendingFixRerunRef = useRef<{ issueId: string; requestedAt: number } | null>(null);
  const nextPreviewObservationRef = useRef<{
    source: WorkStudioPreviewResult['source'];
    detail: string;
    triggerTurnId?: string | null;
  } | null>(null);
  const subscribeAppStudioFacts = useCallback((notify: () => void) => flowChatStore.subscribeSelector(
      (state) => (sessionId
        ? state.sessions.get(sessionId)?.customMetadata?.appStudioFacts ?? null
        : null),
      () => notify(),
    ), [sessionId]);
  const persistedAppStudioFacts = useSyncExternalStore(
    subscribeAppStudioFacts,
    () => persistedAppStudioFactsForSession(sessionId),
    () => persistedAppStudioFactsForSession(sessionId),
  );
  const effectiveScope = useMemo(
    () => normalizeAppScope(scope || systemAppScope()),
    [scope],
  );
  const componentSubject = useMemo<AppStudioComponentSubjectFacts | null>(() => {
    if (!componentId || !componentKind) return null;
    return {
      componentId,
      componentKind,
      version: componentVersion || '1.0.0',
      packageRoot: componentPackageRoot || null,
      name: componentName || null,
      description: componentDescription || null,
    };
  }, [componentDescription, componentId, componentKind, componentName, componentPackageRoot, componentVersion]);
  const workspacePath = workspacePathFromAppScope(effectiveScope);
  const hostSurfaceId = previewTarget?.resolvedRuntime.host.surfaceId ?? app?.id;
  const studioWorkId = previewTarget?.work.id ?? componentWork?.id;
  const hostIsRunning = Boolean(hostSurfaceId && runningWorkerIds.includes(hostSurfaceId));
  const isRunning = hostIsRunning;
  const runtimeSummary = useMemo(() => {
    if (!app) return null;
    return buildProductAppRuntimeHostSummary(app, { isOpen: false, isRunning: hostIsRunning, runtimeStatus });
  }, [app, hostIsRunning, runtimeStatus]);

  const actions = useProductAppRuntimeHostActions(hostSurfaceId, { scope: effectiveScope });
  const permissionSummary = useMemo<AppStudioPermissionSummary | null>(() => {
    if (!app) return null;
    return runtimeHostPermissionSummary(app);
  }, [app]);
  const elevatedPermissionNames = useMemo(
    () => productApp && permissionSummary
      ? permissionReviewElevatedPermissionNames(productApp, permissionSummary)
      : [],
    [permissionSummary, productApp],
  );

  const refreshExecutionGraph = useCallback(async (workId: string) => {
    try {
      const graph = await agenticOsWorkApi.getWorkExecutionGraph(workId);
      setExecutionGraph(graph);
    } catch {
      setExecutionGraph(null);
    }
  }, []);

  const resolveComponentWorkbenchWork = useCallback(async () => {
    if (!componentSubject || appId) return;
    setLoading(true);
    try {
      const { work } = await useWorkStore.getState().resolveComponentWork({
        component: {
          componentId: componentSubject.componentId,
          componentKind: componentSubject.componentKind,
          version: componentSubject.version ?? undefined,
          packageRoot: componentSubject.packageRoot ?? undefined,
        },
        intent: 'develop',
        title: `${componentSubject.name || componentSubject.componentId} Component package`,
        objective: componentSubject.description ||
          `Develop Component package ${componentSubject.componentKind}/${componentSubject.componentId}`,
        scope: workScopeFromAppScope(effectiveScope),
        visibility: 'secondary',
        primarySurfacePolicy: 'work_center',
      });
      setComponentWork(work);
      await refreshExecutionGraph(work.id);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setComponentWork(null);
      setExecutionGraph(null);
    } finally {
      setLoading(false);
    }
  }, [appId, componentSubject, effectiveScope, refreshExecutionGraph]);

  const load = useCallback(async () => {
    if (!appId) return;
    setLoading(true);
    try {
      const catalogProductApp = await appCatalogAPI.getProductApp(appId);
      if (catalogProductApp.launch?.kind === 'agentSession') {
        setProductApp(catalogProductApp);
        setPreviewTarget(null);
        previewTargetRef.current = null;
        setRuntimeContext(null);
        setApp(null);
        setExecutionGraph(null);
        setError(null);
        return;
      }
      const target = await resolveProductAppStudioPreviewTarget(appId, {
        scope: effectiveScope,
        theme: themeType ?? 'dark',
      });
      setProductApp(target.productApp);
      setPreviewTarget(target);
      previewTargetRef.current = target;
      setRuntimeContext(target.resolvedRuntime.runtimeContext);
      setApp(target.hostSurface);
      await refreshExecutionGraph(target.work.id);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      if (isProductAppStudioPreviewResolveError(err)) {
        try {
          await recordPreviewObservationForFailureContext(
            err.context,
            `Preview ${err.context.stage} failed: ${message}`,
            refreshExecutionGraph,
          );
        } catch {
          // The visible load error above is the primary signal; failure to persist it should not hide it.
        }
      } else if (previewTargetRef.current) {
        try {
          await recordPreviewObservationForTarget(
            previewTargetRef.current,
            {
              status: 'failed',
              source: 'runtime-observation',
              detail: `Preview load failed: ${message}`,
              issueCount: 1,
              fatalIssueCount: 1,
              warningIssueCount: 0,
            },
            refreshExecutionGraph,
          );
        } catch {
          // The visible load error above is the primary signal; failure to persist it should not hide it.
        }
      }
    } finally {
      setLoading(false);
    }
  }, [appId, effectiveScope, refreshExecutionGraph, themeType]);

  const markNextPreviewObservationAsFixRerun = useCallback(() => {
    const pending = pendingFixRerunRef.current;
    if (!pending) return;
    nextPreviewObservationRef.current = {
      source: 'fix-rerun',
      detail: `Preview rerun after Fix with AI for issue ${pending.issueId}.`,
      triggerTurnId: null,
    };
    pendingFixRerunRef.current = null;
  }, []);

  const recordPreviewObservation = useCallback(async (options: PreviewObservationOptions = {}) => {
    const target = previewTarget;
    if (!target) return;
    const pendingObservation = options.source ? null : nextPreviewObservationRef.current;
    if (!options.source) nextPreviewObservationRef.current = null;
    try {
      await recordPreviewObservationForTarget(
        target,
        {
          ...options,
          source: options.source ?? pendingObservation?.source ?? 'runtime-observation',
          triggerTurnId: options.triggerTurnId ?? pendingObservation?.triggerTurnId ?? null,
          detail: options.detail ?? pendingObservation?.detail ?? 'Preview iframe loaded.',
        },
        refreshExecutionGraph,
      );
    } catch (err) {
      notificationService.error(err instanceof Error ? err.message : String(err), { duration: 4000 });
    }
  }, [previewTarget, refreshExecutionGraph]);

  const handlePreviewLoad = useCallback((runtimeReady: ProductAppRuntimeReadyPayload | null) => {
    lastRuntimeReadyRef.current = runtimeReady;
    void recordPreviewObservation({ runtimeReady });
    const target = previewTarget;
    if (target && runtimeReady) {
      void recordRuntimeBoundaryEvidenceForTarget(target, permissionSummary, refreshExecutionGraph)
        .catch((err) => {
          notificationService.error(err instanceof Error ? err.message : String(err), { duration: 4000 });
        });
      void recordRuntimeDependencyEvidenceForTarget(target, target.hostSurface, runtimeSummary, runtimeReady, refreshExecutionGraph)
        .catch((err) => {
          notificationService.error(err instanceof Error ? err.message : String(err), { duration: 4000 });
        });
    }
  }, [permissionSummary, previewTarget, recordPreviewObservation, refreshExecutionGraph, runtimeSummary]);

  const handleRecordPermissionReview = useCallback(async () => {
    const target = previewTarget;
    if (!target || !permissionSummary) return;
    setRecordingPermissionReview(true);
    try {
      await agenticOsWorkApi.recordStudioPreviewResult({
        workId: target.work.id,
        previewResult: buildPermissionReviewPreviewResult({
          workId: target.work.id,
          productApp: target.productApp,
          runtimeContext: target.resolvedRuntime.runtimeContext,
          componentId: target.resolvedRuntime.productAppSurfaceId,
          permissionSummary,
          observedAt: Date.now(),
        }),
      });
      await refreshExecutionGraph(target.work.id);
      notificationService.success(t('workbench.permissions.reviewRecorded'), { duration: 1800 });
    } catch (err) {
      notificationService.error(err instanceof Error ? err.message : String(err), { duration: 4000 });
    } finally {
      setRecordingPermissionReview(false);
    }
  }, [permissionSummary, previewTarget, refreshExecutionGraph, t]);

  const handlePreviewInteractionProbe = useCallback((interactionProbe: ProductAppRuntimeInteractionProbePayload | null) => {
    void recordPreviewObservation({
      runtimeReady: lastRuntimeReadyRef.current,
      interactionProbe,
      detail: 'Preview iframe runtime bridge and safe interaction probe completed.',
    });
  }, [recordPreviewObservation]);

  const handlePreviewUserPathRehearsal = useCallback((payload: ProductAppRuntimeUserPathRehearsalPayload | null) => {
    const target = previewTarget;
    if (!target) return;
    void (async () => {
      try {
        await recordUserPathRehearsalForTarget(target, payload, refreshExecutionGraph);
      } catch (err) {
        notificationService.error(err instanceof Error ? err.message : String(err), { duration: 4000 });
      }
    })();
  }, [previewTarget, refreshExecutionGraph]);

  const handlePreviewBootTimeout = useCallback(() => {
    void recordPreviewObservation({
      status: 'failed',
      source: 'runtime-observation',
      detail: 'Preview iframe boot timed out.',
      issueCount: 1,
      fatalIssueCount: 1,
      warningIssueCount: 0,
    });
  }, [recordPreviewObservation]);

  useEffect(() => {
    setProductApp(null);
    setPreviewTarget(null);
    previewTargetRef.current = null;
    setComponentWork(null);
    setApp(null);
    setRuntimeContext(null);
    setExecutionGraph(null);
    setRuntimeEventIssues([]);
    setRuntimeEventLogs([]);
    setValidationSummary(null);
    lastRuntimeReadyRef.current = null;
    setPreviewSelection(null);
    setPreviewInspectorHover(null);
    setPreviewInspectorEnabled(false);
    if (appId) void load();
    else if (componentSubject) void resolveComponentWorkbenchWork();
  }, [appId, componentSubject, load, resolveComponentWorkbenchWork]);

  useEffect(() => {
    if (!hostSurfaceId) return;
    const shouldHandle = (payload?: { id?: string }) => payload?.id === hostSurfaceId;
    const reload = (payload?: { id?: string }) => {
      if (!shouldHandle(payload)) return;
      markNextPreviewObservationAsFixRerun();
      void load();
    };
    const reloadAfterRecompile = (payload?: { id?: string }) => {
      if (!shouldHandle(payload)) return;
      setRuntimeEventIssues([]);
      reload(payload);
    };
    const unlistenUpdated = api.listen<{ id?: string }>(productAppRuntimeHostEvents.updated, reload);
    const unlistenRecompiled = api.listen<{ id?: string }>(
      productAppRuntimeHostEvents.recompiled,
      reloadAfterRecompile,
    );
    const unlistenIssue = api.listen<Record<string, unknown>>(productAppRuntimeHostEvents.runtimeIssue, (payload) => {
      if (payload?.appId !== hostSurfaceId || payload.severity === 'noise') return;
      const issue = normalizeRuntimeIssueEvent(payload as any, runtimeContext);
      if (!issue) return;
      setRuntimeEventIssues((current) => mergeStudioIssues([issue], current).slice(0, MAX_VISIBLE_ISSUES));
      if (issue.severity === 'fatal') setDockState('open');
      if (previewTarget?.work.id) {
        void recordPreviewObservation({
          status: issue.severity === 'fatal' ? 'failed' : 'warning',
          source: 'runtime-observation',
          detail: `Preview runtime ${issue.severity}: ${issue.message}`,
          issueCount: 1,
          fatalIssueCount: issue.severity === 'fatal' ? 1 : 0,
          warningIssueCount: issue.severity === 'warning' ? 1 : 0,
        });
      }
    });
    const unlistenLog = api.listen<Record<string, unknown>>(productAppRuntimeHostEvents.runtimeLog, (payload) => {
      if (payload?.appId !== hostSurfaceId) return;
      const logEntry = normalizeRuntimeLogEvent(payload as any, runtimeContext);
      if (!logEntry) return;
      setRuntimeEventLogs((current) => mergeStudioLogs(current, [logEntry]).slice(-MAX_VISIBLE_LOGS));
      setNewLogCount((n) => (followTail ? 0 : n + 1));
      if (previewTarget?.work.id) void refreshExecutionGraph(previewTarget.work.id);
    });
    const unlistenCleared = api.listen<{ appId?: string }>(productAppRuntimeHostEvents.runtimeIssuesCleared, (payload) => {
      if (payload?.appId !== hostSurfaceId) return;
      setRuntimeEventIssues([]);
      setRuntimeEventLogs([]);
      setNewLogCount(0);
    });
    const handleWindowUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string; appId?: string }>).detail;
      const id = detail?.id ?? detail?.appId;
      if (id !== hostSurfaceId) return;
      setRuntimeEventIssues([]);
      markNextPreviewObservationAsFixRerun();
      void load();
    };
    window.addEventListener(productAppRuntimeHostEvents.updated, handleWindowUpdated);

    return () => {
      unlistenUpdated();
      unlistenRecompiled();
      unlistenIssue();
      unlistenLog();
      unlistenCleared();
      window.removeEventListener(productAppRuntimeHostEvents.updated, handleWindowUpdated);
    };
  }, [hostSurfaceId, followTail, load, markNextPreviewObservationAsFixRerun, previewTarget?.work.id, recordPreviewObservation, refreshExecutionGraph, runtimeContext]);

  useEffect(() => {
    const handleValidationResult = (event: Event) => {
      void (async () => {
      const detail = (event as CustomEvent<{ result?: unknown; appId?: string; componentId?: string; toolName?: string }>).detail;
      const summary = normalizeProductAppValidationSummary(detail?.result ?? detail);
      if (!summary) return;
      const result = (detail?.result ?? detail) as Record<string, unknown> | undefined;
      const validatedAppId = typeof detail?.appId === 'string'
        ? detail.appId
        : typeof result?.app_id === 'string'
          ? result.app_id
          : typeof result?.appId === 'string'
            ? result.appId
            : undefined;
      const validatedComponentId = typeof detail?.componentId === 'string'
        ? detail.componentId
        : typeof result?.component_id === 'string'
          ? result.component_id
          : typeof result?.componentId === 'string'
            ? result.componentId
            : undefined;
      if (validatedAppId && productApp?.id && validatedAppId !== productApp.id) return;
      if (validatedComponentId && componentSubject?.componentId && validatedComponentId !== componentSubject.componentId) return;
      setValidationSummary(summary);
      const workId = studioWorkId;
      if (!workId) return;
      const toolName = detail?.toolName || (componentSubject ? 'ValidateComponentPackage' : 'ValidateProductAppPackage');
      const status = normalizeStudioFactStatus(String(summary.status));
      const isComponentValidation = Boolean(componentSubject && !productApp);
      const appValidationId = validatedAppId || productApp?.id;
      const componentValidationId = validatedComponentId || componentSubject?.componentId;
      const componentValidationKind = typeof result?.component_kind === 'string'
        ? result.component_kind
        : typeof result?.componentKind === 'string'
          ? result.componentKind
          : typeof result?.kind === 'string'
            ? result.kind
            : componentSubject?.componentKind;
      if (!isComponentValidation && !appValidationId) return;
      if (isComponentValidation && (!componentValidationId || !componentValidationKind)) return;
      const validationResult: WorkStudioValidationResult = {
        id: isComponentValidation
          ? `validation:component:${compactFactId(componentValidationKind)}:${compactFactId(componentValidationId)}`
          : `validation:product-app:${compactFactId(appValidationId)}`,
        toolName,
        targetKind: isComponentValidation ? 'component' : 'product-app',
        status,
        workId,
        appId: isComponentValidation ? null : appValidationId,
        componentId: isComponentValidation ? componentValidationId : null,
        componentKind: isComponentValidation ? componentValidationKind : null,
        version: typeof result?.version === 'string'
          ? result.version
          : isComponentValidation
            ? componentSubject?.version ?? null
            : productApp?.version ?? null,
        packageRoot: typeof result?.path === 'string'
          ? result.path
          : typeof result?.packageRoot === 'string'
            ? result.packageRoot
            : productAppFacts?.packagePath || productApp?.catalogSource?.packageUri || componentSubject?.packageRoot || null,
        observedAt: summary.updatedAt,
        failedCount: summary.failed,
        warningCount: summary.warnings,
        checks: summary.checks.map((check) => ({
          id: check.id,
          status: normalizeStudioFactStatus(String(check.status)),
          detail: check.detail ?? null,
        })),
      };
      try {
        await agenticOsWorkApi.recordStudioValidationResult({
          workId,
          validationResult,
        });
        await refreshExecutionGraph(workId);
      } catch (err) {
        notificationService.error(err instanceof Error ? err.message : String(err), { duration: 4000 });
      }
      })();
    };
    window.addEventListener('app-studio-validation-result', handleValidationResult);
    return () => window.removeEventListener('app-studio-validation-result', handleValidationResult);
  }, [
    componentSubject,
    productApp,
    productAppFacts?.packagePath,
    refreshExecutionGraph,
    studioWorkId,
  ]);

  useEffect(() => {
    const handlePreviewResult = (event: Event) => {
      void (async () => {
        const detail = (event as CustomEvent<{ result?: unknown; toolName?: string; turnId?: string }>).detail;
        const result = (detail?.result ?? detail) as Record<string, unknown> | undefined;
        if (!result || typeof result !== 'object') return;
        const workId = studioWorkId;
        if (!workId) return;

        const resultAppId = stringFromRecord(result, ['appId', 'app_id']);
        const resultComponentId = stringFromRecord(result, ['componentId', 'component_id']);
        if (resultAppId && productApp?.id && resultAppId !== productApp.id) return;
        if (resultComponentId && componentSubject?.componentId && resultComponentId !== componentSubject.componentId) return;

        const previewResult = buildWorkStudioPreviewResultFromToolResult(result, {
          workId,
          turnId: detail?.turnId ?? null,
          runtimeContext,
          productAppId: productApp?.id ?? null,
          componentId: componentSubject?.componentId ?? null,
        });
        try {
          await agenticOsWorkApi.recordStudioPreviewResult({
            workId,
            previewResult,
          });
          await refreshExecutionGraph(workId);
        } catch (err) {
          notificationService.error(err instanceof Error ? err.message : String(err), { duration: 4000 });
        }
      })();
    };
    window.addEventListener('app-studio-preview-result', handlePreviewResult);
    return () => window.removeEventListener('app-studio-preview-result', handlePreviewResult);
  }, [
    componentSubject,
    productApp,
    refreshExecutionGraph,
    runtimeContext,
    studioWorkId,
  ]);

  const handleLogsScroll = useCallback(() => {
    const el = logsScrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (atBottom && !followTail) {
      setFollowTail(true);
      setNewLogCount(0);
    } else if (!atBottom && followTail) {
      setFollowTail(false);
    }
  }, [followTail]);

  const handleResumeFollow = useCallback(() => {
    setFollowTail(true);
    setNewLogCount(0);
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const displayMeta = useMemo(
    () => (app ? resolveProductAppHostSurfaceMeta(app, currentLanguage) : null),
    [app, currentLanguage],
  );
  const displayName = productApp?.name || componentSubject?.name || displayMeta?.name || t('panel.title');
  const displayDescription = productApp?.description || componentSubject?.description || displayMeta?.description || '';

  const previewSelectionSummary = useMemo(
    () => (previewSelection ? summarizeProductAppPreviewElementSelection(previewSelection) : null),
    [previewSelection],
  );

  const previewInspectorHoverLabel = useMemo(() => {
    const element = previewInspectorHover?.element;
    if (!element) return null;
    return element.label || element.textContent || element.selectorPath || element.tagName;
  }, [previewInspectorHover]);

  const handleTogglePreviewSelection = useCallback(() => {
    setPreviewInspectorEnabled((enabled) => !enabled);
    setPreviewInspectorHover(null);
  }, []);

  const handleClearPreviewSelection = useCallback(() => {
    setPreviewSelection(null);
  }, []);

  const handleElementInspectorHover = useCallback((payload: ProductAppPreviewElementInspectorPayload | null) => {
    setPreviewInspectorHover(payload);
  }, []);

  const handleElementInspectorSelect = useCallback(
    (payload: ProductAppPreviewElementInspectorPayload) => {
      if (!app || !productApp) return;
      const context = buildProductAppPreviewElementSelectionContext({
        appId: productApp.id,
        appName: productApp.name,
        sessionId,
        route: payload.route || '/',
        runtimeRevision: app.runtime?.source_revision,
        payload,
      });
      if (context) setPreviewSelection(context);
    },
    [app, productApp, sessionId],
  );

  const handleElementInspectorExit = useCallback(() => {
    setPreviewInspectorEnabled(false);
    setPreviewInspectorHover(null);
  }, []);

  const handleAddPreviewSelectionContext = useCallback(async () => {
    if (!previewSelection || addingPreviewSelection) return;
    setAddingPreviewSelection(true);
    try {
      const exists = useContextStore.getState().contexts.some(context => context.id === previewSelection.id);
      if (!exists) {
        useContextStore.getState().addContext(previewSelection);
        window.dispatchEvent(new CustomEvent('insert-context-tag', { detail: { context: previewSelection } }));
      }
      notificationService.success(t(exists ? 'previewSelection.alreadyAdded' : 'previewSelection.added'), { duration: 1800 });
    } catch (err) {
      notificationService.error(err instanceof Error ? err.message : String(err), { duration: 4000 });
    } finally {
      setAddingPreviewSelection(false);
    }
  }, [addingPreviewSelection, previewSelection, t]);

  const graphIssues = useMemo(
    () => issuesFromExecutionGraph(executionGraph, runtimeContext),
    [executionGraph, runtimeContext],
  );
  const graphLogs = useMemo(
    () => logsFromExecutionGraph(executionGraph, runtimeContext),
    [executionGraph, runtimeContext],
  );
  const issues = useMemo(
    () => mergeStudioIssues(graphIssues, runtimeEventIssues).slice(0, MAX_VISIBLE_ISSUES),
    [graphIssues, runtimeEventIssues],
  );
  const logs = useMemo(
    () => mergeStudioLogs(graphLogs, runtimeEventLogs).slice(-MAX_VISIBLE_LOGS),
    [graphLogs, runtimeEventLogs],
  );

  // Auto-scroll logs to bottom when following tail
  useEffect(() => {
    if (followTail && runtimeView === 'logs') {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      setNewLogCount(0);
    }
  }, [logs, followTail, runtimeView]);

  const issueCounts = useMemo(
    () =>
      issues.reduce(
        (acc, issue) => {
          if (issue.severity === 'fatal') acc.fatal += 1;
          if (issue.severity === 'warning') acc.warning += 1;
          acc.total += 1;
          return acc;
        },
        { fatal: 0, warning: 0, total: 0 },
      ),
    [issues],
  );

  const filteredLogs = useMemo(() => {
    let result = logs.filter((e) => e.level !== 'debug');
    if (logFilter !== 'all') {
      const levels = logFilter === 'error' ? ['error'] : logFilter === 'warn' ? ['warn'] : ['info'];
      result = result.filter((e) => levels.includes(e.level));
    }
    if (logSearch.trim()) {
      const q = logSearch.toLowerCase();
      result = result.filter(
        (e) =>
          e.message.toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q) ||
          (e.source ?? '').toLowerCase().includes(q),
      );
    }
    return result;
  }, [logFilter, logSearch, logs]);

  const runnerKey = useMemo(
    () =>
      app
        ? `${productApp?.id ?? app.id}:${app.id}:${runtimeContext?.runtimeInstanceId ?? 'no-runtime'}:${app.runtime?.source_revision ?? 'runtime'}:${themeType ?? 'dark'}:${appScopeIdentity(effectiveScope)}:${reloadNonce}`
        : `loading:${appId ?? 'none'}:${reloadNonce}`,
    [app, appId, effectiveScope, productApp?.id, reloadNonce, runtimeContext?.runtimeInstanceId, themeType],
  );

  const handleOpenInApps = useCallback(() => {
    if (previewTarget) {
      void openProductAppRuntimeForWorkSurface({
        workId: previewTarget.work.id,
        productAppId: previewTarget.surface.productAppId,
        runtimeInstanceId: previewTarget.resolvedRuntime.runtimeInstanceId,
        productAppVersion: previewTarget.appRef?.appVersion,
        componentLockDigest: previewTarget.appRef?.componentLockDigest,
        productAppSurfaceId: previewTarget.surface.productAppSurfaceId,
        surfaceId: previewTarget.surface.surfaceId,
      }, {
        scope: effectiveScope,
        locale: currentLanguage,
        runtimeContext: previewTarget.resolvedRuntime.runtimeContext,
        context: previewTarget.workContext,
      });
    }
  }, [currentLanguage, effectiveScope, previewTarget]);

  const handleReloadUi = useCallback(() => {
    setReloadNonce((v) => v + 1);
    void load();
  }, [load]);

  const handleClearIssues = useCallback(async () => {
    if (!hostSurfaceId || clearingIssues) return;
    setClearingIssues(true);
    try {
      await productAppRuntimeHostAPI.clearRuntimeIssues(hostSurfaceId);
      setRuntimeEventIssues([]);
      setRuntimeEventLogs([]);
      setNewLogCount(0);
    } catch (err) {
      notificationService.error(err instanceof Error ? err.message : String(err), { duration: 4000 });
    } finally {
      setClearingIssues(false);
    }
  }, [clearingIssues, hostSurfaceId]);

  const copyDiagnostic = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        notificationService.success(t('diagnostics.copied'), { duration: 1800 });
      } catch (err) {
        notificationService.error(err instanceof Error ? err.message : String(err));
      }
    },
    [t],
  );

  const buildIssuePrompt = useCallback(
    (singleIssue?: AppStudioIssue) => {
      const packageRoot = productAppFacts?.packagePath ||
        productApp?.catalogSource?.packageUri ||
        componentSubject?.packageRoot ||
        (productApp
          ? `product-app://${productApp.id}@${productApp.version}`
          : componentSubject
            ? `component://${componentSubject.componentKind}/${componentSubject.componentId}@${componentSubject.version ?? '1.0.0'}`
            : undefined);
      const subjectLabel = productApp
        ? `${productApp.name} (${productApp.id})`
        : componentSubject
          ? `${componentSubject.name || componentSubject.componentId} (${componentSubject.componentKind})`
          : appId ?? 'current App Studio subject';
      const subjectKind = productApp ? 'Product App' : componentSubject ? 'Component package' : 'App Studio subject';
      if (singleIssue) {
        const structuredContext = {
          workId: studioWorkId,
          issueId: singleIssue.id,
          productAppId: singleIssue.productAppId ?? productApp?.id ?? appId,
          subjectKind,
          componentKind: componentSubject?.componentKind,
          runtimeInstanceId: singleIssue.runtimeInstanceId ?? runtimeContext?.runtimeInstanceId,
          componentId: singleIssue.componentId ?? componentSubject?.componentId,
          previewResultId: singleIssue.previewResultId,
          packageRoot,
          severity: singleIssue.severity,
          category: singleIssue.category,
          source: singleIssue.source,
          message: singleIssue.message,
        };
        return [
          `Fix the following ${subjectKind} issue. Subject: ${subjectLabel}`,
          '',
          'Structured Studio issue context:',
          JSON.stringify(structuredContext, null, 2),
          '',
          'Diagnostic details:',
          stringifyDiagnostic([singleIssue.message, singleIssue.source, singleIssue.stack]),
        ].join('\n');
      }
      const issueLines = issues.slice(0, MAX_VISIBLE_ISSUES).map((issue, index) => {
        const detail = stringifyDiagnostic([issue.source, issue.stack]);
        return [
          `#${index + 1} [${issue.severity}] ${issue.category ?? 'runtime'}`,
          `Issue ID: ${issue.id}`,
          issue.runtimeInstanceId ? `Runtime Instance: ${issue.runtimeInstanceId}` : '',
          issue.componentId ? `Component: ${issue.componentId}` : '',
          `Message: ${issue.message}`,
          detail,
        ]
          .filter(Boolean)
          .join('\n');
      });
      const logLines = filteredLogs.slice(-40).map((entry, index) => {
        const detail = stringifyDiagnostic([
          entry.source,
          entry.details != null ? entry.details : undefined,
          entry.stack,
        ]);
        return [`#${index + 1} [${entry.level}] ${entry.category}`, `Message: ${entry.message}`, detail]
          .filter(Boolean)
          .join('\n');
      });
      return [
        `Fix the current ${subjectKind} based on its Studio diagnostics. Subject: ${subjectLabel}`,
        packageRoot ? `Bound package root: ${packageRoot}` : '',
        runtimeContext?.runtimeInstanceId ? `Runtime instance: ${runtimeContext.runtimeInstanceId}` : '',
        '',
        'Recent issues:',
        issueLines.length > 0 ? issueLines.join('\n\n---\n\n') : 'No fatal/warning issues.',
        '',
        'Recent logs:',
        logLines.length > 0 ? logLines.join('\n\n---\n\n') : 'No runtime logs.',
      ].filter(Boolean).join('\n');
    },
    [appId, componentSubject, filteredLogs, issues, productApp, productAppFacts?.packagePath, runtimeContext?.runtimeInstanceId, studioWorkId],
  );

  const handleSendIssuesToAi = useCallback(
    async (singleIssue?: AppStudioIssue) => {
      if (!sessionId || sendingIssues) return;
      if (!singleIssue && issues.length === 0 && filteredLogs.length === 0) return;
      setSendingIssues(true);
      try {
        await flowChatManager.sendMessage(
          buildIssuePrompt(singleIssue),
          sessionId,
          t('diagnostics.sendDisplay'),
          undefined,
          undefined,
          singleIssue
            ? {
                metadata: {
                  appStudioIssueContext: {
                    workId: studioWorkId,
                    issueId: singleIssue.id,
                    productAppId: singleIssue.productAppId ?? productApp?.id ?? appId,
                    subjectKind: productApp ? 'Product App' : componentSubject ? 'Component package' : 'App Studio subject',
                    componentKind: componentSubject?.componentKind,
                    runtimeInstanceId: singleIssue.runtimeInstanceId ?? runtimeContext?.runtimeInstanceId,
                    componentId: singleIssue.componentId ?? componentSubject?.componentId,
                    previewResultId: singleIssue.previewResultId,
                    packageRoot: productAppFacts?.packagePath ||
                      productApp?.catalogSource?.packageUri ||
                      componentSubject?.packageRoot ||
                      (productApp
                        ? `product-app://${productApp.id}@${productApp.version}`
                        : componentSubject
                          ? `component://${componentSubject.componentKind}/${componentSubject.componentId}@${componentSubject.version ?? '1.0.0'}`
                          : undefined),
                    severity: singleIssue.severity,
                    category: singleIssue.category,
                    source: singleIssue.source,
                    message: singleIssue.message,
                  },
                },
              }
            : undefined,
        );
        if (singleIssue) {
          pendingFixRerunRef.current = {
            issueId: singleIssue.id,
            requestedAt: Date.now(),
          };
        }
        notificationService.success(t('diagnostics.sent'), { duration: 2000 });
      } catch (err) {
        notificationService.error(err instanceof Error ? err.message : String(err), { duration: 4000 });
      } finally {
        setSendingIssues(false);
      }
    },
    [appId, buildIssuePrompt, componentSubject, filteredLogs.length, issues.length, productApp, productAppFacts?.packagePath, runtimeContext?.runtimeInstanceId, sendingIssues, sessionId, studioWorkId, t],
  );

  // 鈹€鈹€ Permissions submenu entries 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  const buildRestoreReleasePrompt = useCallback((release: AppStudioLatestRelease): string => {
    const packageRoot = productAppFacts?.packagePath || productApp?.catalogSource?.packageUri;
    return [
      `Restore Product App release ${release.releaseId}.`,
      productApp ? `Product App: ${productApp.id}@${productApp.version}` : '',
      packageRoot ? `Bound package root: ${packageRoot}` : '',
      release.manifestPath ? `Release manifest path: ${release.manifestPath}` : '',
      release.packageDigest ? `Release package digest: ${release.packageDigest}` : '',
      release.componentLockDigest ? `Release component lock: ${release.componentLockDigest}` : '',
      '',
      'Use RestoreProductAppRelease with confirm=true and the release_id above.',
      'This rollback is package source only. Do not roll back installed user data, Work history, runtime storage, or private memory.',
      'After restore, report restored_files, removed_files, package_digest, and component_lock_digest, then refresh App Studio facts.',
    ].filter(Boolean).join('\n');
  }, [productApp, productAppFacts?.packagePath]);

  const releasePackageRoot = useCallback(() => (
    productAppFacts?.packagePath || productApp?.catalogSource?.packageUri
  ), [productApp?.catalogSource?.packageUri, productAppFacts?.packagePath]);

  const releaseSummaryText = useCallback((release: AppStudioLatestRelease): string => {
    return [
      productApp ? `Product App: ${productApp.id}@${productApp.version}` : '',
      `Release ID: ${release.releaseId}`,
      release.label ? `Label: ${release.label}` : '',
      release.manifestPath ? `Manifest: ${release.manifestPath}` : '',
      release.packageDigest ? `Package digest: ${release.packageDigest}` : '',
      release.componentLockDigest ? `Component lock: ${release.componentLockDigest}` : '',
      release.createdAt ? `Created: ${new Date(release.createdAt).toISOString()}` : '',
      release.notes ? `Notes:\n${release.notes}` : '',
    ].filter(Boolean).join('\n');
  }, [productApp]);

  const handleCopyRelease = useCallback(async (release: AppStudioLatestRelease) => {
    try {
      await navigator.clipboard.writeText(releaseSummaryText(release));
      notificationService.success(t('workbench.versions.releaseCopied'), { duration: 1800 });
    } catch (err) {
      notificationService.error(err instanceof Error ? err.message : String(err), { duration: 4000 });
    }
  }, [releaseSummaryText, t]);

  const buildCompareReleasePrompt = useCallback((release: AppStudioLatestRelease): string => {
    const packageRoot = releasePackageRoot();
    return [
      `Compare Product App release ${release.releaseId} with the current draft package.`,
      productApp ? `Product App: ${productApp.id}@${productApp.version}` : '',
      packageRoot ? `Bound package root: ${packageRoot}` : '',
      '',
      'Use CompareProductAppRevisions with base_kind="release", base_id set to the release id above, and target_kind="current".',
      'Report changed_count, unchanged_count, and group changed files by added, removed, and modified. Do not restore or edit files.',
    ].filter(Boolean).join('\n');
  }, [productApp, releasePackageRoot]);

  const handleCompareRelease = useCallback(async (release: AppStudioLatestRelease) => {
    if (!sessionId || requestingReleaseCompare) return;
    setRequestingReleaseCompare(true);
    try {
      await flowChatManager.sendMessage(
        buildCompareReleasePrompt(release),
        sessionId,
        t('workbench.versions.compareDisplay', { releaseId: release.releaseId }),
        undefined,
        undefined,
        {
          triggerSource: 'desktop_ui',
          metadata: {
            appStudioReleaseCompareContext: {
              releaseId: release.releaseId,
              productAppId: productApp?.id ?? appId,
              productAppVersion: productApp?.version,
              packageRoot: releasePackageRoot(),
              baseKind: 'release',
              targetKind: 'current',
            },
          },
        },
      );
      notificationService.success(t('workbench.versions.compareSent'), { duration: 2200 });
    } catch (err) {
      notificationService.error(err instanceof Error ? err.message : String(err), { duration: 4000 });
    } finally {
      setRequestingReleaseCompare(false);
    }
  }, [
    appId,
    buildCompareReleasePrompt,
    productApp?.id,
    productApp?.version,
    releasePackageRoot,
    requestingReleaseCompare,
    sessionId,
    t,
  ]);

  const buildTemplateReleasePrompt = useCallback((release: AppStudioLatestRelease): string => {
    const packageRoot = releasePackageRoot();
    const suggestedNewAppId = buildReleaseTemplateAppId(productApp?.id || appId, release.releaseId);
    const suggestedName = productApp?.name ? `${productApp.name} Template` : `${release.releaseId} Template`;
    return [
      `Create a new Product App from release ${release.releaseId} as a template.`,
      productApp ? `Source Product App: ${productApp.id}@${productApp.version}` : '',
      packageRoot ? `Source package root: ${packageRoot}` : '',
      release.manifestPath ? `Release manifest path: ${release.manifestPath}` : '',
      `Suggested new app id: ${suggestedNewAppId}`,
      `Suggested name: ${suggestedName}`,
      'Suggested version: 1.0.0',
      '',
      'Use CreateProductAppFromReleaseTemplate with release_id set to the release id above, new_app_id/name/new_version set to the suggested values unless the user goal requires different values.',
      'Use only the immutable release package source snapshot as the template source; do not manually copy package files with Write or Edit.',
      'Create a distinct Product App package and do not copy Work history, runtime storage, user private data, checkpoints, releases, or catalog provenance.',
      'After creating it, bind the new Product App to this App Studio session and report the new app id, package root, component lock, and validation status.',
    ].filter(Boolean).join('\n');
  }, [appId, productApp, releasePackageRoot]);

  const handleUseReleaseAsTemplate = useCallback(async (release: AppStudioLatestRelease) => {
    if (!sessionId || requestingReleaseTemplate) return;
    setRequestingReleaseTemplate(true);
    try {
      await flowChatManager.sendMessage(
        buildTemplateReleasePrompt(release),
        sessionId,
        t('workbench.versions.templateDisplay', { releaseId: release.releaseId }),
        undefined,
        undefined,
        {
          triggerSource: 'desktop_ui',
          metadata: {
            appStudioReleaseTemplateContext: {
              releaseId: release.releaseId,
              productAppId: productApp?.id ?? appId,
              productAppVersion: productApp?.version,
              packageRoot: releasePackageRoot(),
              suggestedNewAppId: buildReleaseTemplateAppId(productApp?.id || appId, release.releaseId),
              suggestedName: productApp?.name ? `${productApp.name} Template` : `${release.releaseId} Template`,
              suggestedVersion: '1.0.0',
              toolName: 'CreateProductAppFromReleaseTemplate',
              templateSource: 'releaseSnapshot',
              excludePrivateData: true,
            },
          },
        },
      );
      notificationService.success(t('workbench.versions.templateSent'), { duration: 2200 });
    } catch (err) {
      notificationService.error(err instanceof Error ? err.message : String(err), { duration: 4000 });
    } finally {
      setRequestingReleaseTemplate(false);
    }
  }, [
    appId,
    buildTemplateReleasePrompt,
    productApp?.id,
    productApp?.name,
    productApp?.version,
    releasePackageRoot,
    requestingReleaseTemplate,
    sessionId,
    t,
  ]);

  const handleConfirmRestoreRelease = useCallback(async () => {
    if (!sessionId || !restoreReleaseTarget || requestingReleaseRestore) return;
    const packageRoot = releasePackageRoot();
    setRequestingReleaseRestore(true);
    try {
      await flowChatManager.sendMessage(
        buildRestoreReleasePrompt(restoreReleaseTarget),
        sessionId,
        t('workbench.versions.restoreDisplay', { releaseId: restoreReleaseTarget.releaseId }),
        undefined,
        undefined,
        {
          triggerSource: 'desktop_ui',
          metadata: {
            appStudioReleaseRestoreContext: {
              releaseId: restoreReleaseTarget.releaseId,
              productAppId: productApp?.id ?? appId,
              productAppVersion: productApp?.version,
              packageRoot,
              scope: 'packageSourceOnly',
              confirm: true,
            },
          },
        },
      );
      notificationService.success(t('workbench.versions.restoreSent'), { duration: 2400 });
      setRestoreReleaseTarget(null);
    } catch (err) {
      notificationService.error(err instanceof Error ? err.message : String(err), { duration: 4000 });
    } finally {
      setRequestingReleaseRestore(false);
    }
  }, [
    appId,
    buildRestoreReleasePrompt,
    productApp?.id,
    productApp?.version,
    productAppFacts?.packagePath,
    releasePackageRoot,
    requestingReleaseRestore,
    restoreReleaseTarget,
    sessionId,
    t,
  ]);

  const permissionSubmenu = useMemo((): DropdownMenuEntry[] => {
    if (!permissionSummary) return [];
    const row = (id: string, label: string): DropdownMenuEntry => ({
      type: 'item', id, label, disabled: true,
    });
    return [
      row('read',  permissionSummary.readsWorkspace  ? t('permissions.readWorkspace')  : t('permissions.noWorkspaceRead')),
      row('write', permissionSummary.writesWorkspace ? t('permissions.writeWorkspace') : t('permissions.noWorkspaceWrite')),
      row('shell', permissionSummary.shellEnabled    ? t('permissions.shellEnabled')   : t('permissions.shellDisabled')),
      row('net',   permissionSummary.netEnabled      ? t('permissions.netEnabled')     : t('permissions.netDisabled')),
      row('ai',    permissionSummary.aiEnabled       ? t('permissions.aiEnabled')      : t('permissions.aiDisabled')),
      row('node',  permissionSummary.nodeEnabled     ? t('permissions.nodeEnabled')    : t('permissions.nodeDisabled')),
    ];
  }, [permissionSummary, t]);

  // 鈹€鈹€ Action menu items 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  const menuItems = useMemo((): DropdownMenuEntry[] => [
    {
      type: 'item',
      id: 'recompile',
      label: t('panel.menu.recompile'),
      onClick: () => void actions.recompile(),
      disabled: !hostSurfaceId || actions.state.recompiling,
    },
    ...(!isBuiltinBundledProductAppHost(hostSurfaceId)
      ? [{
          type: 'item' as const,
          id: 'install',
          label: t('panel.menu.installDeps'),
          onClick: () => void actions.installDeps(() => void load()),
          disabled: !hostSurfaceId || actions.state.installingDeps,
        }]
      : []),
    { type: 'separator', id: 'sep1' },
    {
      type: 'item',
      id: 'open-in-apps',
      label: t('panel.menu.openInApps'),
      onClick: handleOpenInApps,
      disabled: !previewTarget,
    },
    {
      type: 'item',
      id: 'reload',
      label: t('panel.menu.reload'),
      onClick: handleReloadUi,
      disabled: !appId || loading,
    },
    ...(permissionSummary
      ? [{
          type: 'item' as const,
          id: 'permissions',
          label: t('panel.menu.viewPermissions'),
          submenu: permissionSubmenu,
        }]
      : []),
    { type: 'separator', id: 'sep2' },
    {
      type: 'item',
      id: 'copy-id',
      label: t('panel.menu.copyAppId'),
      onClick: () => void (async () => {
        if (!appId) return;
        try {
          await navigator.clipboard.writeText(appId);
          notificationService.success(t('diagnostics.copyAppId'), { duration: 1800 });
        } catch { /* noop */ }
      })(),
      disabled: !appId,
    },
    {
      type: 'label',
      id: 'meta',
      content: [
        t('panel.menu.theme', { theme: themeType ?? 'dark' }),
        t('panel.menu.language', { lang: currentLanguage }),
      ],
    },
  ], [actions, appId, currentLanguage, handleOpenInApps, handleReloadUi, hostSurfaceId, load, loading, permissionSubmenu, permissionSummary, previewTarget, t, themeType]);

  // 鈹€鈹€ Dock status 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  const dockStatusLabel = useMemo(() => {
    if (issueCounts.fatal > 0) return t('diagnostics.fatalCount', { count: issueCounts.fatal });
    if (issueCounts.warning > 0) return t('diagnostics.warningCount', { count: issueCounts.warning });
    return t('diagnostics.ok');
  }, [issueCounts, t]);
  const dockStatusClass = issueCounts.fatal > 0 ? 'is-fatal' : issueCounts.warning > 0 ? 'is-warning' : 'is-ok';

  // 鈹€鈹€ Runtime dot state 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  const runtimeDotClass = useMemo(() => {
    if (issueCounts.fatal > 0) return 'is-error';
    if (isRunning) return 'is-running';
    if (runtimeSummary?.depsDirty || runtimeSummary?.workerRestartRequired) return 'is-warning';
    // Apps without a node worker are "running" as soon as they are loaded with no issues
    if (app && runtimeSummary && !runtimeSummary.nodeEnabled) return 'is-running';
    return 'is-idle';
  }, [app, isRunning, issueCounts.fatal, runtimeSummary]);

  const workbenchTabs = useMemo(
    () =>
      WORKBENCH_TAB_IDS.map((id) => ({
        value: id,
        label: t(`workbench.tabs.${id}`),
      })),
    [t],
  );

  const sourceFileCount = useMemo(() => {
    if (!app) return 0;
    const sourceFiles = app.source.source_files?.length ?? 0;
    const legacySlots = [
      app.source.html,
      app.source.css,
      app.source.ui_js,
      app.source.worker_js,
    ].filter((value) => typeof value === 'string' && value.trim()).length;
    return Math.max(sourceFiles, legacySlots);
  }, [app]);

  const productAppAgentComponents = useMemo(
    () => productApp?.components?.filter(component => component.kind === 'agent') ?? [],
    [productApp?.components],
  );

  const appStudioFacts = useMemo<AppStudioFacts>(() => {
    const observedAt = validationSummary?.updatedAt
      ?? executionGraph?.updatedAt
      ?? previewTarget?.work.updatedAt
      ?? componentWork?.updatedAt
      ?? 0;
    return buildAppStudioFacts({
      productApp,
      componentSubject,
      hostSurface: app,
      previewTarget,
      runtimeContext,
      executionGraph,
      sourceFileCount,
      permissionSummary,
      runtimeHasAttention: Boolean(runtimeSummary?.hasAttention),
      issues,
      logs,
      validationSummary,
      persistedFacts: persistedAppStudioFacts,
      observedAt,
      packageRoot: productAppFacts?.packagePath ?? componentSubject?.packageRoot,
    });
  }, [
    app,
    componentSubject,
    componentWork?.updatedAt,
    executionGraph,
    issues,
    logs,
    permissionSummary,
    persistedAppStudioFacts,
    previewTarget,
    productApp,
    runtimeContext,
    runtimeSummary?.hasAttention,
    sourceFileCount,
    validationSummary,
    productAppFacts?.packagePath,
  ]);

  useEffect(() => {
    if (!sessionId) return;
    const serializedFacts = JSON.stringify(appStudioFacts);
    let changed = false;
    flowChatStore.setState(prev => {
      const session = prev.sessions.get(sessionId);
      if (!session) return prev;
      if (JSON.stringify(session.customMetadata?.appStudioFacts ?? null) === serializedFacts) {
        return prev;
      }
      changed = true;
      const nextCustomMetadata = {
        ...(session.customMetadata || {}),
        appStudioFacts,
      };
      const nextConfigCustomMetadata = {
        ...(session.config.customMetadata || {}),
        appStudioFacts,
      };
      const nextSessions = new Map(prev.sessions);
      nextSessions.set(sessionId, {
        ...session,
        customMetadata: nextCustomMetadata,
        config: {
          ...session.config,
          customMetadata: nextConfigCustomMetadata,
        },
        updatedAt: Date.now(),
      });
      return {
        ...prev,
        sessions: nextSessions,
      };
    });
    if (!changed) return;
    const timer = window.setTimeout(() => {
      void flowChatManager.persistSessionMetadata(sessionId);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [appStudioFacts, sessionId]);

  const componentRows = useMemo<FactRow[]>(() => {
    if (componentSubject && !productApp) {
      return [
        {
          label: t('workbench.facts.componentId'),
          value: componentSubject.componentId,
          state: 'ok',
        },
        {
          label: t('workbench.facts.componentKind'),
          value: componentSubject.componentKind,
        },
        {
          label: t('workbench.facts.version'),
          value: componentSubject.version ?? t('workbench.values.unknown'),
        },
        {
          label: t('workbench.facts.packageRoot'),
          value: componentSubject.packageRoot ?? t('workbench.values.unknown'),
        },
      ];
    }
    if (!productApp) return [];
    const rows: FactRow[] = [
      {
        label: t('workbench.facts.primarySurface'),
        value: productApp.primarySurface?.componentId ?? t('workbench.values.notSpecified'),
        state: productApp.primarySurface ? 'ok' : 'neutral',
      },
      {
        label: t('workbench.facts.surfaceMode'),
        value: productApp.primarySurfaceMode ?? t('workbench.values.notSpecified'),
      },
      {
        label: t('workbench.facts.sourceFiles'),
        value: sourceFileCount,
      },
    ];
    rows.push({
      label: t('workbench.facts.launchKind'),
      value: productApp.launch?.kind ?? t('workbench.values.notSpecified'),
      state: 'neutral',
    });
    for (const backend of (productApp.components ?? []).map(component => ({ ...component, id: component.role }))) {
      rows.push({
        label: `${t('workbench.facts.backend')} - ${backend.id}`,
        value: `${backend.kind} / ${backend.componentId}`,
        state: 'neutral',
      });
    }
    return rows;
  }, [componentSubject, productApp, sourceFileCount, t]);

  const permissionRows = useMemo<FactRow[]>(() => {
    if (!permissionSummary) return [];
    return [
      {
        label: t('workbench.permissions.workspaceRead'),
        value: permissionSummary.readsWorkspace ? t('workbench.values.enabled') : t('workbench.values.disabled'),
        state: boolState(permissionSummary.readsWorkspace),
      },
      {
        label: t('workbench.permissions.workspaceWrite'),
        value: permissionSummary.writesWorkspace ? t('workbench.values.enabled') : t('workbench.values.disabled'),
        state: boolState(permissionSummary.writesWorkspace),
      },
      {
        label: t('workbench.permissions.shell'),
        value: permissionSummary.shellEnabled ? t('workbench.values.enabled') : t('workbench.values.disabled'),
        state: boolState(permissionSummary.shellEnabled),
      },
      {
        label: t('workbench.permissions.network'),
        value: permissionSummary.netEnabled ? t('workbench.values.enabled') : t('workbench.values.disabled'),
        state: boolState(permissionSummary.netEnabled),
      },
      {
        label: t('workbench.permissions.ai'),
        value: permissionSummary.aiEnabled ? t('workbench.values.enabled') : t('workbench.values.disabled'),
        state: boolState(permissionSummary.aiEnabled),
      },
      {
        label: t('workbench.permissions.worker'),
        value: permissionSummary.nodeEnabled ? t('workbench.values.enabled') : t('workbench.values.disabled'),
        state: boolState(permissionSummary.nodeEnabled),
      },
    ];
  }, [permissionSummary, t]);

  const labelForCheck = useCallback((id: string) => {
    if (id === 'package') return t('workbench.validation.package');
    if (id === 'criticalPath') return t('workbench.validation.criticalPath');
    if (id === 'validation') return t('workbench.validation.validation');
    if (id === 'preview') return t('workbench.validation.preview');
    if (id === 'runtime') return t('workbench.validation.runtime');
    if (id === 'runtimeReady') return t('workbench.validation.runtimeReady');
    if (id === 'runtimeStorage') return t('workbench.validation.runtimeStorage');
    if (id === 'runtimeDependencies') return t('workbench.validation.runtimeDependencies');
    if (id === 'surfaceMode') return t('workbench.validation.surfaceMode');
    if (id === 'hostFrame') return t('workbench.validation.hostFrame');
    if (id === 'visualRoot') return t('workbench.validation.visualRoot');
    if (id === 'viewport') return t('workbench.validation.viewport');
    if (id === 'interactionSurface') return t('workbench.validation.interactionSurface');
    if (id === 'issues') return t('workbench.validation.issues');
    if (id === 'permissions') return t('workbench.validation.permissions');
    if (id === 'permissionReview') return t('workbench.validation.permissionReview');
    if (id === 'data') return t('workbench.validation.data');
    if (id === 'dataLifecycle') return t('workbench.validation.dataLifecycle');
    if (id === 'dataSummary') return t('workbench.validation.dataSummary');
    if (id === 'userPath') return t('workbench.validation.userPath');
    if (id === 'userPathContract') return t('workbench.validation.userPathContract');
    if (id === 'componentSchema') return t('workbench.validation.componentSchema');
    if (id === 'componentContract') return t('workbench.validation.componentContract');
    if (id === 'capabilities') return t('workbench.validation.capabilities');
    if (id === 'capabilitySchema') return t('workbench.validation.capabilitySchema');
    if (id === 'capabilityCall') return t('workbench.validation.capabilityCall');
    if (id === 'capabilityLogs') return t('workbench.validation.capabilityLogs');
    if (id === 'capabilityTrace') return t('workbench.validation.capabilityTrace');
    if (id === 'dependencies') return t('workbench.validation.dependencies');
    if (id === 'implementation') return t('workbench.validation.implementation');
    if (id === 'consumerCompatibility') return t('workbench.validation.consumerCompatibility');
    if (id === 'agentEval') return t('workbench.validation.agentEval');
    if (id === 'evalLogs') return t('workbench.validation.evalLogs');
    if (id === 'evalTrace') return t('workbench.validation.evalTrace');
    if (id === 'releaseGate') return t('workbench.validation.releaseGate');
    return id;
  }, [t]);

  const readinessRows = useMemo<FactRow[]>(() => {
    const checks = appStudioFacts.validationSummary?.checks ?? [];
    return checks.map((check) => ({
      label: labelForCheck(check.id),
      value: check.detail ? `${check.status}: ${check.detail}` : check.status,
      state: statusState(String(check.status)),
    }));
  }, [appStudioFacts.validationSummary, labelForCheck]);

  const evalRows = useMemo<FactRow[]>(() => {
    const summary = appStudioFacts.evalSummary;
    if (!summary) return [];
    return [
      {
        label: t('workbench.facts.evalStatus'),
        value: String(summary.status),
        state: statusState(String(summary.status)),
      },
      {
        label: t('workbench.facts.evalCases'),
        value: summary.caseCount,
        state: summary.caseCount > 0 ? 'ok' : 'neutral',
      },
      {
        label: t('workbench.facts.evalDetail'),
        value: textOrFallback(summary.detail, t('workbench.values.notVerified')),
        state: statusState(String(summary.status)),
      },
    ];
  }, [appStudioFacts.evalSummary, t]);

  const releaseRehearsal = useMemo(
    () => appStudioFacts.previewResults
      .filter((preview) => preview.kind === 'release-rehearsal')
      .sort((left, right) => right.observedAt - left.observedAt)[0],
    [appStudioFacts.previewResults],
  );
  const releaseChecklistRows = useMemo<FactRow[]>(() => {
    const checks = releaseRehearsal?.checks ?? [];
    return checks.map((check) => ({
      label: labelForCheck(check.id),
      value: check.detail ? `${check.status}: ${check.detail}` : check.status,
      state: statusState(String(check.status)),
    }));
  }, [labelForCheck, releaseRehearsal]);

  const releaseArtifactRows = useMemo<FactRow[]>(() => {
    const latestRelease = appStudioFacts.versionSummary?.latestRelease;
    const latestPublished = appStudioFacts.versionSummary?.latestPublishedRelease;
    const rows: FactRow[] = [];
    if (latestRelease) {
      rows.push({
        label: t('workbench.facts.latestRelease'),
        value: latestRelease.label
          ? `${latestRelease.label} - ${latestRelease.releaseId}`
          : latestRelease.releaseId,
        state: 'ok',
      });
      if (latestRelease.createdAt) {
        rows.push({
          label: t('workbench.facts.releaseCreated'),
          value: formatRuntimeTimestamp(latestRelease.createdAt, currentLanguage),
        });
      }
      if (latestRelease.packageDigest) {
        rows.push({
          label: t('workbench.facts.releasePackage'),
          value: compactDigest(latestRelease.packageDigest),
        });
      }
      if (latestRelease.notes) {
        rows.push({
          label: t('workbench.facts.releaseNotes'),
          value: latestRelease.notes,
        });
      }
    }
    if (latestPublished) {
      rows.push({
        label: t('workbench.facts.latestPublishedRelease'),
        value: latestPublished.releaseId,
        state: 'ok',
      });
      if (latestPublished.publishedAt) {
        rows.push({
          label: t('workbench.facts.releasePublished'),
          value: formatRuntimeTimestamp(latestPublished.publishedAt, currentLanguage),
        });
      }
    }
    return rows;
  }, [appStudioFacts.versionSummary, currentLanguage, t]);

  const renderFactTab = () => {
    const fallback = t('workbench.empty.noApp');
    const hasSubject = Boolean(productApp || componentSubject);
    if (activeTab === 'blueprint') {
      return (
        <div className="studio-workbench-facts">
          <FactSection
            title={t('workbench.sections.userBlueprint')}
            description={t('workbench.sections.userBlueprintDesc')}
            empty={fallback}
            rows={productApp ? [
              { label: t('workbench.facts.whatItDoes'), value: appStudioFacts.blueprint?.whatItDoes || displayDescription || productApp.goal || t('workbench.values.notSpecified') },
              { label: t('workbench.facts.howIUseIt'), value: appStudioFacts.blueprint?.howIUseIt || (productApp.launch?.kind === 'agentSession' ? t('workbench.values.agentPreview') : productApp.primarySurfaceMode === 'sidecarLinked' ? t('workbench.values.sidecarPreview') : t('workbench.values.fullPreview')) },
              { label: t('workbench.facts.whatAiDoes'), value: appStudioFacts.blueprint?.whatAiDoes || (productAppAgentComponents.length > 0 ? joinList(productAppAgentComponents.map(component => component.componentId), '') : t('workbench.values.noBackendActions')), state: productAppAgentComponents.length > 0 ? 'ok' : 'neutral' },
              { label: t('workbench.facts.whatData'), value: appStudioFacts.blueprint?.whatData || t('workbench.values.packageAndRuntimeState') },
              { label: t('workbench.facts.howReady'), value: appStudioFacts.blueprint?.howReady || (issueCounts.fatal > 0 ? t('workbench.values.runtimeIssues') : t('workbench.values.previewLoaded')), state: statusState(String(appStudioFacts.validationSummary?.status ?? 'notVerified')) },
            ] : componentSubject ? [
              { label: t('workbench.facts.whatItDoes'), value: appStudioFacts.blueprint?.whatItDoes || componentSubject.description || t('workbench.values.notSpecified') },
              { label: t('workbench.facts.howIUseIt'), value: appStudioFacts.blueprint?.howIUseIt || t('workbench.values.componentConsumerUse') },
              { label: t('workbench.facts.whatAiDoes'), value: appStudioFacts.blueprint?.whatAiDoes || t('workbench.values.componentCapability') },
              { label: t('workbench.facts.whatData'), value: appStudioFacts.blueprint?.whatData || t('workbench.values.componentPackageState') },
              { label: t('workbench.facts.howReady'), value: appStudioFacts.blueprint?.howReady || t('workbench.values.componentReadiness'), state: statusState(String(appStudioFacts.validationSummary?.status ?? 'notVerified')) },
            ] : []}
          />
          <FactSection
            title={t('workbench.sections.technicalBlueprint')}
            description={t('workbench.sections.technicalBlueprintDesc')}
            empty={fallback}
            rows={productApp ? [
              { label: t('workbench.facts.appId'), value: String(appStudioFacts.technicalBlueprint?.appId ?? productApp.id) },
              { label: t('workbench.facts.version'), value: String(appStudioFacts.technicalBlueprint?.version ?? productApp.version) },
              { label: t('workbench.facts.category'), value: textOrFallback(productApp.category, t('workbench.values.uncategorized')) },
              { label: t('workbench.facts.tags'), value: joinList(productApp.tags, t('workbench.values.none')) },
              { label: t('workbench.facts.launchKind'), value: String(appStudioFacts.technicalBlueprint?.launchKind ?? productApp.launch?.kind ?? t('workbench.values.notSpecified')) },
              { label: t('workbench.facts.runtimeRevision'), value: textOrFallback(appStudioFacts.technicalBlueprint?.runtimeInstanceId, t('workbench.values.unknown')) },
            ] : componentSubject ? [
              { label: t('workbench.facts.componentId'), value: String(appStudioFacts.technicalBlueprint?.componentId ?? componentSubject.componentId) },
              { label: t('workbench.facts.componentKind'), value: String(appStudioFacts.technicalBlueprint?.componentKind ?? componentSubject.componentKind) },
              { label: t('workbench.facts.version'), value: String(appStudioFacts.technicalBlueprint?.version ?? componentSubject.version ?? t('workbench.values.unknown')) },
              { label: t('workbench.facts.packageRoot'), value: String(appStudioFacts.technicalBlueprint?.packageRoot ?? componentSubject.packageRoot ?? t('workbench.values.unknown')) },
            ] : []}
          />
        </div>
      );
    }

    if (activeTab === 'issues') {
      return (
        <div className="studio-workbench-facts">
          <FactSection
            title={t('workbench.sections.issueSummary')}
            description={t('workbench.sections.issueSummaryDesc')}
            empty={t('diagnostics.empty')}
            rows={[
              { label: t('workbench.facts.fatalIssues'), value: issueCounts.fatal, state: issueCounts.fatal > 0 ? 'error' : 'ok' },
              { label: t('workbench.facts.warnings'), value: issueCounts.warning, state: issueCounts.warning > 0 ? 'warning' : 'ok' },
              { label: t('workbench.facts.runtimeLogs'), value: logs.length, state: logs.length > 0 ? 'neutral' : 'ok' },
            ]}
          />
          <div className="studio-workbench-issue-list">
            {issues.length > 0 ? issues.map((issue, index) => (
              <IssueRow
                key={`${issue.severity}-${issue.timestampMs}-${index}`}
                issue={issue}
                t={t}
                onCopy={(text) => void copyDiagnostic(text)}
                onRecompile={() => void actions.recompile()}
                onRestart={() => void actions.stopWorker(() => void load())}
                onFixWithAi={(text) => void handleSendIssuesToAi(text)}
                currentLanguage={currentLanguage}
                restartLabel={t('panel.actions.restartWorker')}
              />
            )) : (
              <div className="studio-fact-section__empty">{t('diagnostics.empty')}</div>
            )}
          </div>
        </div>
      );
    }

    if (activeTab === 'components') {
      return (
        <div className="studio-workbench-facts">
          <FactSection
            title={t('workbench.sections.components')}
            description={t('workbench.sections.componentsDesc')}
            empty={fallback}
            rows={componentRows}
          />
        </div>
      );
    }

    if (activeTab === 'agent') {
      return (
        <div className="studio-workbench-facts">
          <FactSection
            title={t('workbench.sections.agent')}
            description={t('workbench.sections.agentDesc')}
            empty={t('workbench.empty.noAgent')}
            rows={hasSubject ? [
              { label: t('workbench.facts.backendActions'), value: appStudioFacts.agentSummary?.backendActionCount ?? productAppAgentComponents.length, state: (appStudioFacts.agentSummary?.backendActionCount ?? 0) > 0 ? 'ok' : 'neutral' },
              { label: t('workbench.facts.memoryScope'), value: joinList(appStudioFacts.agentSummary?.memoryScopes, t('workbench.values.none')) },
              { label: t('workbench.facts.sessionPolicy'), value: joinList(appStudioFacts.agentSummary?.sessionPolicies, t('workbench.values.none')) },
            ] : []}
          />
        </div>
      );
    }

    if (activeTab === 'data') {
      return (
        <div className="studio-workbench-facts">
          <FactSection
            title={t('workbench.sections.data')}
            description={t('workbench.sections.dataDesc')}
            empty={fallback}
            rows={hasSubject && appStudioFacts.dataSummary ? [
              { label: t('workbench.facts.inputData'), value: appStudioFacts.dataSummary.readsWorkspace ? t('workbench.values.workspaceReadable') : t('workbench.values.userProvidedOnly') },
              { label: t('workbench.facts.workingState'), value: `${t('workbench.values.runtimeScoped')} - ${appStudioFacts.dataSummary.runtimeRunCount}` },
              { label: t('workbench.facts.externalFacts'), value: appStudioFacts.dataSummary.externalAccess ? t('workbench.values.externalAccess') : t('workbench.values.noExternalAccess'), state: appStudioFacts.dataSummary.externalAccess ? 'warning' : 'ok' },
              { label: t('workbench.facts.retention'), value: `${t(lifecyclePolicyLabelKey(appStudioFacts.dataSummary.retentionPolicy))} - ${appStudioFacts.dataSummary.artifactCount}` },
              { label: t('workbench.facts.deletion'), value: t(lifecyclePolicyLabelKey(appStudioFacts.dataSummary.deletionPolicy)) },
              { label: t('workbench.facts.migration'), value: t(lifecyclePolicyLabelKey(appStudioFacts.dataSummary.migrationPolicy)) },
              { label: t('workbench.facts.sharePolicy'), value: t(lifecyclePolicyLabelKey(appStudioFacts.dataSummary.sharePolicy)) },
            ] : []}
          />
        </div>
      );
    }

    if (activeTab === 'eval' || activeTab === 'validation') {
      return (
        <div className="studio-workbench-facts">
          <FactSection
            title={activeTab === 'eval' ? t('workbench.sections.eval') : t('workbench.sections.validation')}
            description={activeTab === 'eval' ? t('workbench.sections.evalDesc') : t('workbench.sections.validationDesc')}
            rows={activeTab === 'eval' ? evalRows : readinessRows}
          />
        </div>
      );
    }

    if (activeTab === 'versions') {
      const latestRelease = appStudioFacts.versionSummary?.latestRelease;
      return (
        <div className="studio-workbench-facts">
          <FactSection
            title={t('workbench.sections.versions')}
            description={t('workbench.sections.versionsDesc')}
            empty={fallback}
            rows={hasSubject ? [
              { label: t('workbench.facts.currentDraft'), value: appStudioFacts.versionSummary?.currentVersion ?? productApp?.version ?? componentSubject?.version ?? t('workbench.values.unknown') },
              { label: t('workbench.facts.sourceRevision'), value: textOrFallback(appStudioFacts.versionSummary?.sourceRevision, t('workbench.values.unknown')) },
              { label: t('workbench.facts.lockDigest'), value: appStudioFacts.versionSummary?.componentLockDigest ?? productApp?.componentLockDigest ?? productApp?.componentLockId ?? t('workbench.values.notSpecified'), state: 'ok' },
              { label: t('workbench.facts.releaseStatus'), value: appStudioFacts.versionSummary?.releaseStatus ?? releaseRehearsal?.status ?? t('workbench.values.notVerified'), state: statusState(String(appStudioFacts.versionSummary?.releaseStatus ?? releaseRehearsal?.status ?? 'notVerified')) },
              ...releaseArtifactRows,
              ...releaseChecklistRows,
            ] : []}
          />
          {productApp && latestRelease ? (
            <div className="studio-workbench-facts__actions">
              <Button
                variant="secondary"
                size="small"
                onClick={handleOpenInApps}
                disabled={!previewTarget}
              >
                <ExternalLink size={12} />
                {t('workbench.versions.openRelease')}
              </Button>
              <Button
                variant="secondary"
                size="small"
                onClick={() => void handleCopyRelease(latestRelease)}
              >
                <Copy size={12} />
                {t('workbench.versions.copyRelease')}
              </Button>
              <Button
                variant="secondary"
                size="small"
                onClick={() => void handleCompareRelease(latestRelease)}
                disabled={!sessionId || requestingReleaseCompare}
              >
                {requestingReleaseCompare ? <DotMatrixLoader size="tiny" className="studio-spin" /> : <GitCompareArrows size={12} />}
                {t('workbench.versions.compareRelease')}
              </Button>
              <Button
                variant="secondary"
                size="small"
                onClick={() => void handleUseReleaseAsTemplate(latestRelease)}
                disabled={!sessionId || requestingReleaseTemplate}
              >
                {requestingReleaseTemplate ? <DotMatrixLoader size="tiny" className="studio-spin" /> : <Send size={12} />}
                {t('workbench.versions.useAsTemplate')}
              </Button>
              <Button
                variant="secondary"
                size="small"
                onClick={() => setRestoreReleaseTarget(latestRelease)}
                disabled={requestingReleaseRestore}
              >
                {requestingReleaseRestore ? <DotMatrixLoader size="tiny" className="studio-spin" /> : null}
                {t('workbench.versions.restoreRelease')}
              </Button>
            </div>
          ) : null}
        </div>
      );
    }

    if (activeTab === 'permissions') {
      return (
        <div className="studio-workbench-facts">
          <FactSection
            title={t('workbench.sections.permissions')}
            description={t('workbench.sections.permissionsDesc')}
            empty={fallback}
            rows={permissionRows}
          />
          <div className="studio-workbench-facts__actions">
            <Button
              variant={elevatedPermissionNames.length > 0 ? 'accent' : 'secondary'}
              size="small"
              onClick={() => void handleRecordPermissionReview()}
              disabled={!previewTarget || !permissionSummary || recordingPermissionReview}
            >
              {recordingPermissionReview ? <DotMatrixLoader size="tiny" className="studio-spin" /> : null}
              {t(elevatedPermissionNames.length > 0
                ? 'workbench.permissions.reviewElevated'
                : 'workbench.permissions.recordReview')}
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="studio-workbench-facts">
        <FactSection
          title={t('workbench.sections.share')}
          description={t('workbench.sections.shareDesc')}
          empty={fallback}
          rows={hasSubject && appStudioFacts.shareSummary ? [
            {
              label: t('workbench.facts.visibility'),
              value: visibilityLabel(appStudioFacts.shareSummary.visibility, t),
            },
            { label: t('workbench.facts.installLocation'), value: appStudioFacts.shareSummary.installLocation === 'workspace' ? t('workbench.values.workspaceInstall') : t('workbench.values.systemInstall') },
            { label: t('workbench.facts.privateData'), value: appStudioFacts.shareSummary.privateDataExcluded ? t('workbench.values.privateDataExcluded') : t('workbench.values.notVerified'), state: appStudioFacts.shareSummary.privateDataExcluded ? 'ok' : 'warning' },
          ] : []}
        />
      </div>
    );
  };

  return (
    <>
      <ConfirmDialog
        open={restoreReleaseTarget !== null}
        onOpenChange={(open) => { if (!open) setRestoreReleaseTarget(null); }}
        onConfirm={handleConfirmRestoreRelease}
        onCancel={() => setRestoreReleaseTarget(null)}
        type="warning"
        title={t('workbench.versions.restoreTitle')}
        message={restoreReleaseTarget ? t('workbench.versions.restoreMessage', {
          releaseId: restoreReleaseTarget.releaseId,
        }) : ''}
        preview={restoreReleaseTarget ? [
          restoreReleaseTarget.label ? `${t('workbench.facts.latestRelease')}: ${restoreReleaseTarget.label}` : null,
          `${t('workbench.facts.releaseId')}: ${restoreReleaseTarget.releaseId}`,
          restoreReleaseTarget.packageDigest ? `${t('workbench.facts.releasePackage')}: ${compactDigest(restoreReleaseTarget.packageDigest)}` : null,
          restoreReleaseTarget.componentLockDigest ? `${t('workbench.facts.lockDigest')}: ${compactDigest(restoreReleaseTarget.componentLockDigest)}` : null,
          restoreReleaseTarget.notes ? `${t('workbench.facts.releaseNotes')}:\n${restoreReleaseTarget.notes}` : null,
        ].filter((line): line is string => Boolean(line)).join('\n\n') : undefined}
        previewMaxHeight={260}
        confirmText={t('workbench.versions.restoreConfirm')}
        cancelText={t('workbench.versions.restoreCancel')}
      />
      <div className={`app-studio-panel${dockState === 'collapsed' ? ' is-dock-collapsed' : ''}`}>
      {/* 鈹€鈹€ Status Bar 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ */}
      <div className="studio-statusbar">
        <div className="studio-statusbar__identity">
          <span className={`studio-statusbar__dot ${runtimeDotClass}`} />
          <span className="studio-statusbar__name">{displayName}</span>
          {runtimeSummary?.runtimeLabel ? (
            <span className="studio-statusbar__runtime-label">{runtimeSummary.runtimeLabel}</span>
          ) : null}
        </div>

        <div className="studio-statusbar__ctas">
          {runtimeSummary?.depsDirty ? (
            <Button
              variant="secondary"
              size="small"
              className="studio-statusbar__cta is-warning"
              onClick={() => void actions.installDeps(() => void load())}
              disabled={actions.state.installingDeps}
            >
              {actions.state.installingDeps ? <DotMatrixLoader size="tiny" className="studio-spin" /> : null}
              {t('panel.menu.installDeps')}
            </Button>
          ) : null}
          {runtimeSummary?.workerRestartRequired && !isRunning ? (
            <Button
              variant="secondary"
              size="small"
              className="studio-statusbar__cta is-warning"
              onClick={() => void actions.stopWorker(() => void load())}
              disabled={actions.state.restartingWorker}
            >
              {actions.state.restartingWorker ? <DotMatrixLoader size="tiny" className="studio-spin" /> : null}
              {t('panel.actions.restartWorker')}
            </Button>
          ) : null}
          {isRunning ? (
            <Button
              variant="secondary"
              size="small"
              className="studio-statusbar__cta is-running"
              onClick={() => void actions.stopWorker()}
              disabled={actions.state.restartingWorker}
            >
              {t('panel.actions.stop')}
            </Button>
          ) : null}
        </div>

        <span className="studio-statusbar__sep" aria-hidden="true" />

        <div className="studio-statusbar__actions">
          <IconButton
            variant={previewInspectorEnabled ? 'accent' : 'ghost'}
            size="xs"
            onClick={handleTogglePreviewSelection}
            disabled={!app || !runtimeContext}
            tooltip={previewInspectorEnabled ? t('previewSelection.toggleOff') : t('previewSelection.toggleOn')}
            aria-label={previewInspectorEnabled ? t('previewSelection.toggleOff') : t('previewSelection.toggleOn')}
            aria-pressed={previewInspectorEnabled}
          >
            <MousePointer2 size={13} />
          </IconButton>
          <IconButton
            variant="ghost"
            size="xs"
            onClick={handleReloadUi}
            disabled={!appId || loading}
            tooltip={t('panel.menu.reload')}
            aria-label={t('panel.menu.reload')}
          >
            {loading ? <DotMatrixLoader size="tiny" className="studio-spin" /> : <RefreshCw size={13} />}
          </IconButton>
          <IconButton
            variant="ghost"
            size="xs"
            onClick={handleOpenInApps}
            disabled={!previewTarget}
            tooltip={t('panel.menu.openInApps')}
            aria-label={t('panel.menu.openInApps')}
          >
            <ExternalLink size={13} />
          </IconButton>
          {/* 鈰?Action menu (permissions is a submenu inside) */}
          <IconButton
            ref={menuAnchorRef}
            variant="ghost"
            size="xs"
            onClick={() => setMenuOpen((v) => !v)}
            disabled={!appId}
            tooltip={t('panel.menu.moreActions')}
            aria-label={t('panel.menu.moreActions')}
            aria-haspopup="true"
            aria-expanded={menuOpen}
          >
            <MoreHorizontal size={13} />
          </IconButton>
          <DropdownMenu
            open={menuOpen}
            anchorRef={menuAnchorRef}
            items={menuItems}
            onClose={() => setMenuOpen(false)}
            align="right"
            minWidth={180}
          />
        </div>
      </div>

      <div className="studio-workbench-tabs">
        <SegmentedControl
          className="studio-workbench-tabs__control"
          size="small"
          options={workbenchTabs}
          value={activeTab}
          onChange={(value) => setActiveTab(value as WorkbenchTabId)}
          ariaLabel={t('workbench.tabsLabel')}
        />
        <div className="studio-workbench-tabs__status">
          <Badge
            variant={issueCounts.fatal > 0 ? 'error' : runtimeSummary?.hasAttention ? 'warning' : 'success'}
          >
            {issueCounts.fatal > 0
              ? t('workbench.values.failing')
              : runtimeSummary?.hasAttention
                ? t('workbench.values.needsAttention')
                : t('workbench.values.ready')}
          </Badge>
        </div>
      </div>

      {activeTab === 'preview' ? (
        <div className="studio-preview">
        {!appId ? (
          <div className="studio-preview__empty">
            <AppWindow size={34} strokeWidth={1.5} />
            <div>{t('panel.emptyTitle')}</div>
            <p>{t('panel.emptyDescription')}</p>
          </div>
        ) : null}
        {appId && loading && !app ? (
          <div className="studio-preview__empty">
            <DotMatrixLoader size="medium" className="studio-spin" />
            <div>{t('panel.loading')}</div>
          </div>
        ) : null}
        {error && !app ? (
          <div className="studio-preview__empty is-error">
            <AlertTriangle size={28} strokeWidth={1.5} />
            <div>{t('panel.loadFailed')}</div>
            <p>{error}</p>
            <Button variant="secondary" size="small" onClick={() => void load()}>
              {t('panel.retry')}
            </Button>
          </div>
        ) : null}
        {app ? (
          <React.Suspense fallback={null}>
            <ProductAppRuntimeIframeHost
              key={runnerKey}
              app={app}
              scope={effectiveScope}
              workspacePath={workspacePath}
              runtimeContext={runtimeContext}
              elementInspectorEnabled={previewInspectorEnabled}
              onPreviewLoad={handlePreviewLoad}
              onPreviewInteractionProbe={handlePreviewInteractionProbe}
              onPreviewUserPathRehearsal={handlePreviewUserPathRehearsal}
              onPreviewBootTimeout={handlePreviewBootTimeout}
              userPathRehearsalPlan={productApp?.rehearsalPlan ?? null}
              onElementInspectorHover={handleElementInspectorHover}
              onElementInspectorSelect={handleElementInspectorSelect}
              onElementInspectorExit={handleElementInspectorExit}
            />
          </React.Suspense>
        ) : null}
        {loading && app ? (
          <div className="studio-preview__updating" role="status" aria-live="polite">
            <DotMatrixLoader size="tiny" className="studio-spin" />
            <span>{t('panel.updating')}</span>
          </div>
        ) : null}
        {app && previewInspectorEnabled ? (
          <div className="studio-preview-inspector-status" role="status" aria-live="polite">
            <MousePointer2 size={12} />
            <span>
              {previewInspectorHoverLabel
                ? t('previewSelection.hovering', { target: previewInspectorHoverLabel })
                : t('previewSelection.inspecting')}
            </span>
          </div>
        ) : null}
        {previewSelection ? (
          <div className="studio-preview-selection-tray">
            <span className="studio-preview-selection-tray__label">
              {t('previewSelection.contextLabel')}
            </span>
            <span className="studio-preview-selection-tray__summary" title={previewSelectionSummary || undefined}>
              {previewSelectionSummary}
            </span>
            <Button
              variant="accent"
              size="small"
              onClick={() => void handleAddPreviewSelectionContext()}
              disabled={addingPreviewSelection}
            >
              {addingPreviewSelection ? <DotMatrixLoader size="tiny" className="studio-spin" /> : null}
              {t('previewSelection.addContext')}
            </Button>
            <IconButton
              variant="ghost"
              size="xs"
              onClick={handleClearPreviewSelection}
              tooltip={t('previewSelection.clear')}
              aria-label={t('previewSelection.clear')}
            >
              <X size={12} />
            </IconButton>
          </div>
        ) : null}
        </div>
      ) : renderFactTab()}

      {/* 鈹€鈹€ Diagnostics Dock 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ */}
      <div className="studio-dock">
        {/* Header - always visible */}
        <div className="studio-dock__header">
          <Button
            variant="ghost"
            size="small"
            className="studio-dock__toggle"
            onClick={() => setDockState((s) => (s === 'collapsed' ? 'open' : 'collapsed'))}
            aria-expanded={dockState === 'open'}
          >
            <span className="studio-dock__title">{t('diagnostics.title')}</span>
            <span className={`studio-dock__status ${dockStatusClass}`}>{dockStatusLabel}</span>
            <span className="studio-dock__chevron">
              {dockState === 'open' ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
            </span>
          </Button>

          <div className="studio-dock__header-actions">
            <IconButton
              variant="ghost"
              size="xs"
              onClick={() => void handleSendIssuesToAi()}
              disabled={!sessionId || (issues.length === 0 && filteredLogs.length === 0) || sendingIssues}
              tooltip={t('diagnostics.sendToAi')}
              aria-label={t('diagnostics.sendToAi')}
            >
              {sendingIssues ? <DotMatrixLoader size="tiny" className="studio-spin" /> : <Send size={12} />}
            </IconButton>
            <IconButton
              variant="ghost"
              size="xs"
              onClick={() => void handleClearIssues()}
              disabled={!hostSurfaceId || (issues.length === 0 && logs.length === 0) || clearingIssues}
              tooltip={t('diagnostics.clear')}
              aria-label={t('diagnostics.clear')}
            >
              {clearingIssues ? <DotMatrixLoader size="tiny" className="studio-spin" /> : <Trash2 size={12} />}
            </IconButton>
          </div>
        </div>

        {/* Body - only when open */}
        {dockState === 'open' ? (
          <div className="studio-dock__body">
            {/* Tab bar: Issues | Logs */}
            <div className="studio-dock__tabs">
              <Button
                variant="ghost"
                size="small"
                className={`studio-dock__tab${runtimeView === 'issues' ? ' is-active' : ''}`}
                onClick={() => setRuntimeView('issues')}
              >
                {t('diagnostics.issuesTab')}
                {issueCounts.total > 0 ? (
                  <span className={`studio-dock__tab-badge ${issueCounts.fatal > 0 ? 'is-fatal' : 'is-warning'}`}>
                    {issueCounts.total > 99 ? '99+' : issueCounts.total}
                  </span>
                ) : null}
              </Button>
              <Button
                variant="ghost"
                size="small"
                className={`studio-dock__tab${runtimeView === 'logs' ? ' is-active' : ''}`}
                onClick={() => setRuntimeView('logs')}
              >
                {t('diagnostics.logsTab')}
                {filteredLogs.length > 0 ? (
                  <span className="studio-dock__tab-badge is-neutral">
                    {filteredLogs.length > 99 ? '99+' : filteredLogs.length}
                  </span>
                ) : null}
              </Button>
            </div>

            {/* Log filter controls - only shown in Logs view, as a distinct toolbar row */}
            {runtimeView === 'logs' ? (
              <div className="studio-dock__log-controls">
                <FilterPillGroup className="studio-dock__log-filter-group">
                  {(['all', 'error', 'warn', 'info'] as LogLevel[]).map((level) => (
                    <FilterPill
                      key={level}
                      label={t(`diagnostics.filter${level.charAt(0).toUpperCase()}${level.slice(1)}`)}
                      active={logFilter === level}
                      onClick={() => setLogFilter(level)}
                    />
                  ))}
                </FilterPillGroup>
                <Search
                  className="studio-dock__log-search-field"
                  value={logSearch}
                  onChange={setLogSearch}
                  placeholder={t('diagnostics.searchPlaceholder')}
                  size="small"
                  enterToSearch={false}
                />
              </div>
            ) : null}

            {/* List */}
            <div
              className="studio-dock__list"
              ref={logsScrollRef}
              onScroll={runtimeView === 'logs' ? handleLogsScroll : undefined}
            >
              {runtimeView === 'issues' ? (
                issues.length === 0 ? (
                  <div className="studio-dock__empty">{t('diagnostics.empty')}</div>
                ) : (
                  issues.map((issue, index) => (
                    <IssueRow
                      key={`${issue.severity}-${issue.timestampMs}-${index}`}
                      issue={issue}
                      t={t}
                      onCopy={(text) => void copyDiagnostic(text)}
                      onRecompile={() => void actions.recompile()}
                      onRestart={() => void actions.stopWorker(() => void load())}
                      onFixWithAi={(text) => void handleSendIssuesToAi(text)}
                      currentLanguage={currentLanguage}
                      restartLabel={t('panel.actions.restartWorker')}
                    />
                  ))
                )
              ) : filteredLogs.length === 0 ? (
                <EmptyState
                  className="studio-dock__logs-empty"
                  image={<ScrollText size={28} strokeWidth={1.5} aria-hidden />}
                  imageSize={28}
                  description={t('diagnostics.logsEmpty')}
                />
              ) : (
                <>
                  {logs.length >= MAX_VISIBLE_LOGS ? (
                    <Alert
                      type="info"
                      className="studio-dock__truncated-alert"
                      message={t('diagnostics.truncatedHint', {
                        max: MAX_VISIBLE_LOGS,
                        path: `${workspacePath ?? ''}/.sparo_os/debug.log`,
                      })}
                    />
                  ) : null}
                  {filteredLogs.map((entry, index) => (
                    <LogRow
                      key={`${entry.timestampMs}-${index}`}
                      entry={entry}
                      onCopy={(text) => void copyDiagnostic(text)}
                      currentLanguage={currentLanguage}
                      copyAriaLabel={t('diagnostics.copy')}
                    />
                  ))}
                  <div ref={logsEndRef} />
                </>
              )}
            </div>

            {/* New-logs banner */}
            {runtimeView === 'logs' && !followTail && newLogCount > 0 ? (
              <Button
                type="button"
                variant="accent"
                size="small"
                className="studio-dock__new-logs-banner"
                onClick={handleResumeFollow}
              >
                {t('diagnostics.newMessages', { count: newLogCount })}
                <ChevronDown size={12} />
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
    </>
  );
};

export default AppStudioWorkbench;
