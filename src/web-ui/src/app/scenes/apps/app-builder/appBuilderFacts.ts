import type { ProductAppCatalogEntry } from '@/infrastructure/api/service-api/AppCatalogAPI';
import type { ProductAppHostSurface } from '@/infrastructure/api/service-api/ProductAppRuntimeHostAPI';
import type {
  AppBuilderDataSummary,
  AppBuilderFacts,
  AppBuilderFactStatus,
  AppBuilderIssue,
  AppBuilderRuntimeLog,
  AppBuilderValidationSummary,
} from '@/shared/types/session-history';
import type { ProductAppRuntimeContext } from '@/shared/types/product-app-runtime';
import type {
  WorkExecutionGraph,
  WorkRuntimeIssue,
  WorkRuntimeLog,
  WorkBuilderIssue,
  WorkBuilderPreviewResult,
  WorkBuilderValidationResult,
} from '@/app/agentic-os/work/domain/workTypes';
interface ProductAppBuilderPreviewTarget {
  kind: WorkBuilderPreviewResult['kind'];
  work: { id: string };
}

export interface AppBuilderPermissionSummary {
  readsWorkspace: boolean;
  writesWorkspace: boolean;
  shellEnabled: boolean;
  netEnabled: boolean;
  aiEnabled: boolean;
  nodeEnabled: boolean;
}

interface RuntimeIssueEvent {
  appId?: string;
  severity?: 'fatal' | 'warning' | 'noise';
  message?: string;
  source?: string | null;
  stack?: string | null;
  category?: string | null;
  timestampMs?: number;
  runtimeInstanceId?: string | null;
  productAppId?: string | null;
  componentId?: string | null;
}

interface RuntimeLogEvent {
  appId?: string;
  level?: 'debug' | 'info' | 'warn' | 'error';
  category?: string | null;
  message?: string;
  source?: string | null;
  stack?: string | null;
  details?: unknown;
  timestampMs?: number;
  runtimeInstanceId?: string | null;
  productAppId?: string | null;
  componentId?: string | null;
}

export interface BuildAppBuilderFactsInput {
  productApp: ProductAppCatalogEntry | null;
  componentSubject?: AppBuilderComponentSubjectFacts | null;
  hostSurface: ProductAppHostSurface | null;
  previewTarget: ProductAppBuilderPreviewTarget | null;
  runtimeContext: ProductAppRuntimeContext | null;
  executionGraph: WorkExecutionGraph | null;
  sourceFileCount: number;
  permissionSummary: AppBuilderPermissionSummary | null;
  runtimeHasAttention: boolean;
  issues: AppBuilderIssue[];
  logs: AppBuilderRuntimeLog[];
  validationSummary: AppBuilderValidationSummary | null;
  persistedFacts?: AppBuilderFacts | null;
  observedAt: number;
  packageRoot?: string | null;
}

export interface AppBuilderComponentSubjectFacts {
  componentId: string;
  componentKind: string;
  version?: string | null;
  packageRoot?: string | null;
  name?: string | null;
  description?: string | null;
}

function compactIdPart(value: unknown): string {
  return String(value ?? 'unknown')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9_.:-]/g, '-')
    .slice(0, 96) || 'unknown';
}

function issueId(parts: readonly unknown[]): string {
  return `builder-issue:${parts.map(compactIdPart).join(':')}`;
}

function logId(parts: readonly unknown[]): string {
  return `builder-log:${parts.map(compactIdPart).join(':')}`;
}

function normalizeIssueSeverity(value: unknown): AppBuilderIssue['severity'] {
  return value === 'warning' || value === 'noise' ? value : 'fatal';
}

function normalizeLogLevel(value: unknown): AppBuilderRuntimeLog['level'] {
  return value === 'debug' || value === 'warn' || value === 'error' ? value : 'info';
}

function issueMergeKey(issue: AppBuilderIssue): string {
  return [
    issue.runtimeInstanceId || issue.appId,
    issue.timestampMs,
    issue.severity,
    issue.category || '',
    issue.message,
  ].join('\u0001');
}

function logMergeKey(log: AppBuilderRuntimeLog): string {
  return [
    log.runtimeInstanceId || log.appId,
    log.timestampMs,
    log.level,
    log.category,
    log.message,
  ].join('\u0001');
}

export function normalizeRuntimeIssueEvent(
  payload: RuntimeIssueEvent,
  runtimeContext: ProductAppRuntimeContext | null,
): AppBuilderIssue | null {
  const message = typeof payload.message === 'string' && payload.message.trim()
    ? payload.message
    : null;
  if (!message) return null;

  const runtimeInstanceId = payload.runtimeInstanceId ?? runtimeContext?.runtimeInstanceId;
  const productAppId = payload.productAppId ?? runtimeContext?.productAppId;
  const componentId = payload.componentId ?? runtimeContext?.productAppSurfaceId;
  const appId = payload.appId ?? runtimeContext?.hostSurfaceId ?? componentId ?? productAppId ?? 'product-app-runtime';
  const timestampMs = typeof payload.timestampMs === 'number' ? payload.timestampMs : Date.now();
  const severity = normalizeIssueSeverity(payload.severity);

  return {
    id: issueId(['event', runtimeInstanceId || appId, timestampMs, severity, message]),
    appId,
    productAppId: productAppId ?? undefined,
    componentId: componentId ?? undefined,
    runtimeInstanceId: runtimeInstanceId ?? undefined,
    previewResultId: runtimeInstanceId ? `preview:${runtimeInstanceId}` : undefined,
    severity,
    message,
    source: payload.source ?? undefined,
    stack: payload.stack ?? undefined,
    category: payload.category ?? undefined,
    timestampMs,
    origin: 'runtime-event',
  };
}

export function normalizeRuntimeLogEvent(
  payload: RuntimeLogEvent,
  runtimeContext: ProductAppRuntimeContext | null,
): AppBuilderRuntimeLog | null {
  const message = typeof payload.message === 'string' && payload.message.trim()
    ? payload.message
    : null;
  if (!message) return null;

  const runtimeInstanceId = payload.runtimeInstanceId ?? runtimeContext?.runtimeInstanceId;
  const productAppId = payload.productAppId ?? runtimeContext?.productAppId;
  const componentId = payload.componentId ?? runtimeContext?.productAppSurfaceId;
  const appId = payload.appId ?? runtimeContext?.hostSurfaceId ?? componentId ?? productAppId ?? 'product-app-runtime';
  const timestampMs = typeof payload.timestampMs === 'number' ? payload.timestampMs : Date.now();
  const level = normalizeLogLevel(payload.level);
  const category = typeof payload.category === 'string' && payload.category.trim()
    ? payload.category
    : 'runtime';

  return {
    id: logId(['event', runtimeInstanceId || appId, timestampMs, level, category, message]),
    appId,
    productAppId: productAppId ?? undefined,
    componentId: componentId ?? undefined,
    runtimeInstanceId: runtimeInstanceId ?? undefined,
    level,
    category,
    message,
    source: payload.source ?? undefined,
    stack: payload.stack ?? undefined,
    details: payload.details,
    timestampMs,
    origin: 'runtime-event',
  };
}

function graphIssueToBuilderIssue(issue: WorkRuntimeIssue, hostAppId?: string): AppBuilderIssue {
  return {
    id: issueId(['graph', issue.runtimeInstanceId, issue.timestampMs, issue.severity, issue.message]),
    appId: hostAppId || issue.componentId,
    productAppId: issue.productAppId,
    componentId: issue.componentId,
    runtimeInstanceId: issue.runtimeInstanceId,
    previewResultId: `preview:${issue.runtimeInstanceId}`,
    severity: normalizeIssueSeverity(issue.severity),
    message: issue.message,
    source: issue.source ?? undefined,
    category: issue.category ?? undefined,
    timestampMs: issue.timestampMs,
    origin: 'work-execution-graph',
  };
}

function graphBuilderIssueToBuilderIssue(issue: WorkBuilderIssue): AppBuilderIssue {
  return {
    id: issue.id,
    appId: issue.appId,
    productAppId: issue.productAppId ?? undefined,
    componentId: issue.componentId ?? undefined,
    runtimeInstanceId: issue.runtimeInstanceId ?? undefined,
    previewResultId: issue.previewResultId ?? undefined,
    severity: normalizeIssueSeverity(issue.severity),
    status: issue.status,
    message: issue.message,
    source: issue.source ?? undefined,
    category: issue.category ?? undefined,
    timestampMs: issue.timestampMs,
    origin: issue.origin,
  };
}

function graphPreviewResultToBuilderPreviewResult(preview: WorkBuilderPreviewResult): AppBuilderFacts['previewResults'][number] {
  const result: AppBuilderFacts['previewResults'][number] = {
    id: preview.id,
    kind: preview.kind,
    status: preview.status,
    source: preview.source,
    workId: preview.workId,
    runtimeInstanceId: preview.runtimeInstanceId ?? undefined,
    productAppId: preview.productAppId ?? undefined,
    componentId: preview.componentId ?? undefined,
    productAppSurfaceId: preview.productAppSurfaceId ?? undefined,
    surfaceId: preview.surfaceId ?? undefined,
    observedAt: preview.observedAt,
    issueCount: preview.issueCount,
    fatalIssueCount: preview.fatalIssueCount,
    warningIssueCount: preview.warningIssueCount,
  };
  if (preview.harnessMode != null) result.harnessMode = preview.harnessMode;
  if (preview.triggerTurnId != null) result.triggerTurnId = preview.triggerTurnId;
  if (preview.detail != null) result.detail = preview.detail;
  if (preview.checks && preview.checks.length > 0) {
    result.checks = preview.checks.map((check) => ({
      id: check.id,
      status: check.status,
      detail: check.detail ?? undefined,
    }));
  }
  return result;
}

function graphValidationResultToValidationSummary(
  validation: WorkBuilderValidationResult,
): AppBuilderValidationSummary {
  return {
    status: validation.status,
    failed: validation.failedCount,
    warnings: validation.warningCount,
    checks: validation.checks.map((check) => ({
      id: check.id,
      status: check.status,
      detail: check.detail ?? undefined,
    })),
    updatedAt: validation.observedAt,
    source: 'work-graph',
  };
}

function graphLogToBuilderLog(log: WorkRuntimeLog, hostAppId?: string): AppBuilderRuntimeLog {
  return {
    id: logId(['graph', log.runtimeInstanceId, log.timestampMs, log.level, log.category, log.message]),
    appId: hostAppId || log.componentId,
    productAppId: log.productAppId,
    componentId: log.componentId,
    runtimeInstanceId: log.runtimeInstanceId,
    level: normalizeLogLevel(log.level),
    category: log.category || 'runtime',
    message: log.message,
    source: log.source ?? undefined,
    timestampMs: log.timestampMs,
    origin: 'work-execution-graph',
  };
}

export function issuesFromExecutionGraph(
  graph: WorkExecutionGraph | null,
  runtimeContext: ProductAppRuntimeContext | null,
): AppBuilderIssue[] {
  if (!graph) return [];
  const runtimeInstanceId = runtimeContext?.runtimeInstanceId;
  const productAppId = runtimeContext?.productAppId;
  if (graph.builderIssues.length > 0) {
    return graph.builderIssues
      .filter((issue) =>
        issue.status !== 'fixed' &&
        (!runtimeInstanceId || !issue.runtimeInstanceId || issue.runtimeInstanceId === runtimeInstanceId) &&
        (!productAppId || !issue.productAppId || issue.productAppId === productAppId)
      )
      .map(graphBuilderIssueToBuilderIssue);
  }
  return graph.issues
    .filter((issue) =>
      (!runtimeInstanceId || issue.runtimeInstanceId === runtimeInstanceId) &&
      (!productAppId || issue.productAppId === productAppId)
    )
    .map((issue) => graphIssueToBuilderIssue(issue, runtimeContext?.hostSurfaceId));
}

export function previewResultsFromExecutionGraph(
  graph: WorkExecutionGraph | null,
  runtimeContext: ProductAppRuntimeContext | null,
): AppBuilderFacts['previewResults'] {
  if (!graph) return [];
  const runtimeInstanceId = runtimeContext?.runtimeInstanceId;
  const productAppId = runtimeContext?.productAppId;
  return graph.builderPreviewResults
    .filter((preview) =>
      (!runtimeInstanceId || !preview.runtimeInstanceId || preview.runtimeInstanceId === runtimeInstanceId) &&
      (!productAppId || !preview.productAppId || preview.productAppId === productAppId)
    )
    .map(graphPreviewResultToBuilderPreviewResult);
}

export function validationSummaryFromExecutionGraph(
  graph: WorkExecutionGraph | null,
  productApp: ProductAppCatalogEntry | null,
  componentSubject: AppBuilderComponentSubjectFacts | null | undefined,
): AppBuilderValidationSummary | null {
  if (!graph) return null;
  const candidates = graph.builderValidationResults
    .filter((validation) => {
      if (productApp) {
        return validation.targetKind === 'product-app' && validation.appId === productApp.id;
      }
      if (componentSubject) {
        return validation.targetKind === 'component' && validation.componentId === componentSubject.componentId;
      }
      return false;
    })
    .sort((left, right) => right.observedAt - left.observedAt);
  return candidates[0] ? graphValidationResultToValidationSummary(candidates[0]) : null;
}

export function logsFromExecutionGraph(
  graph: WorkExecutionGraph | null,
  runtimeContext: ProductAppRuntimeContext | null,
): AppBuilderRuntimeLog[] {
  if (!graph) return [];
  const runtimeInstanceId = runtimeContext?.runtimeInstanceId;
  const productAppId = runtimeContext?.productAppId;
  return graph.logs
    .filter((log) =>
      (!runtimeInstanceId || log.runtimeInstanceId === runtimeInstanceId) &&
      (!productAppId || log.productAppId === productAppId)
    )
    .map((log) => graphLogToBuilderLog(log, runtimeContext?.hostSurfaceId));
}

export function mergeBuilderIssues(...groups: AppBuilderIssue[][]): AppBuilderIssue[] {
  const byKey = new Map<string, AppBuilderIssue>();
  for (const issue of groups.flat()) {
    if (issue.severity === 'noise') continue;
    const key = issueMergeKey(issue);
    const existing = byKey.get(key);
    byKey.set(key, {
      ...(existing ?? issue),
      ...issue,
      stack: existing?.stack ?? issue.stack,
      source: existing?.source ?? issue.source,
      origin: existing?.origin === 'runtime-event' ? existing.origin : issue.origin,
    });
  }
  return Array.from(byKey.values())
    .sort((a, b) => b.timestampMs - a.timestampMs);
}

export function mergeBuilderLogs(...groups: AppBuilderRuntimeLog[][]): AppBuilderRuntimeLog[] {
  const byKey = new Map<string, AppBuilderRuntimeLog>();
  for (const log of groups.flat()) {
    const key = logMergeKey(log);
    const existing = byKey.get(key);
    byKey.set(key, {
      ...(existing ?? log),
      ...log,
      stack: existing?.stack ?? log.stack,
      details: existing?.details ?? log.details,
      origin: existing?.origin === 'runtime-event' ? existing.origin : log.origin,
    });
  }
  return Array.from(byKey.values())
    .sort((a, b) => a.timestampMs - b.timestampMs);
}

export function normalizeProductAppValidationSummary(
  result: unknown,
): AppBuilderValidationSummary | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const data = result as Record<string, any>;
  const appId = typeof data.app_id === 'string' ? data.app_id : typeof data.appId === 'string' ? data.appId : undefined;
  if (!appId && !Array.isArray(data.checks)) return null;
  const checks = Array.isArray(data.checks)
    ? data.checks
        .filter((check): check is Record<string, unknown> => Boolean(check && typeof check === 'object' && !Array.isArray(check)))
        .map((check) => ({
          id: String(check.id ?? 'check'),
          status: String(check.status ?? 'notVerified') as AppBuilderValidationSummary['status'],
          detail: typeof check.detail === 'string' ? check.detail : undefined,
        }))
    : [];
  const failed = Number(data.summary?.failed ?? checks.filter(check => check.status === 'failed').length ?? 0);
  const warnings = Number(data.summary?.warnings ?? checks.filter(check => check.status === 'warning').length ?? 0);
  const status = String(data.status ?? deriveValidationStatusFromChecks(checks, failed, warnings)) as AppBuilderValidationSummary['status'];
  return {
    status,
    failed,
    warnings,
    checks,
    updatedAt: Date.now(),
    source: 'tool',
  };
}

function deriveValidationStatusFromChecks(
  checks: AppBuilderValidationSummary['checks'],
  failed: number,
  warnings: number,
): AppBuilderValidationSummary['status'] {
  if (failed > 0 || checks.some(check => check.status === 'failed' || check.status === 'blocked')) return 'failed';
  if (warnings > 0 || checks.some(check => check.status === 'warning')) return 'warning';
  if (checks.some(check => check.status === 'running' || check.status === 'waiting')) return 'running';
  if (checks.length > 0 && checks.every(check => check.status === 'passed')) return 'passed';
  return 'notVerified';
}

function buildDerivedValidationSummary(
  productApp: ProductAppCatalogEntry | null,
  issues: AppBuilderIssue[],
  runtimeHasAttention: boolean,
  updatedAt: number,
): AppBuilderValidationSummary {
  const fatalCount = issues.filter((issue) => issue.severity === 'fatal').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length + (runtimeHasAttention ? 1 : 0);
  return {
    status: !productApp
      ? 'waiting'
      : fatalCount > 0
        ? 'failed'
        : warningCount > 0
          ? 'warning'
          : 'notVerified',
    failed: fatalCount,
    warnings: warningCount,
    source: 'derived',
    updatedAt,
    checks: [
      {
        id: 'package',
        status: productApp ? 'notVerified' : 'waiting',
        detail: productApp ? 'Package loaded; dedicated validation has not run in this Workbench.' : 'No Product App subject is loaded.',
      },
      {
        id: 'preview',
        status: fatalCount > 0 ? 'failed' : productApp ? 'ready' : 'waiting',
        detail: fatalCount > 0 ? 'Runtime preview has fatal issues.' : 'Preview target resolved without fatal issues in current facts.',
      },
      {
        id: 'agentEval',
        status: 'notRun',
        detail: 'Agent Eval remains a separate gate.',
      },
      {
        id: 'releaseGate',
        status: fatalCount > 0 ? 'blocked' : 'notVerified',
        detail: 'Release requires package validation, preview, runtime, data/permission, and eval evidence.',
      },
    ],
  };
}

function buildDerivedComponentValidationSummary(
  componentSubject: AppBuilderComponentSubjectFacts,
  issues: AppBuilderIssue[],
  updatedAt: number,
): AppBuilderValidationSummary {
  const fatalCount = issues.filter((issue) => issue.severity === 'fatal').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  return {
    status: fatalCount > 0
      ? 'failed'
      : warningCount > 0
        ? 'warning'
        : 'notVerified',
    failed: fatalCount,
    warnings: warningCount,
    source: 'derived',
    updatedAt,
    checks: [
      {
        id: 'componentContract',
        status: 'notVerified',
        detail: `${componentSubject.componentKind}/${componentSubject.componentId} contract validation has not run.`,
      },
      {
        id: 'consumerCompatibility',
        status: 'notVerified',
        detail: 'No Product App consumer has validated this component yet.',
      },
      {
        id: 'releaseGate',
        status: fatalCount > 0 ? 'blocked' : 'notVerified',
        detail: 'Reusable component release requires contract, consumer, permission, and eval evidence.',
      },
    ],
  };
}

function buildDataSummary(
  productApp: ProductAppCatalogEntry | null,
  permissionSummary: AppBuilderPermissionSummary | null,
  graph: WorkExecutionGraph | null,
): AppBuilderDataSummary {
  return {
    readsWorkspace: Boolean(permissionSummary?.readsWorkspace),
    writesWorkspace: Boolean(permissionSummary?.writesWorkspace),
    usesRuntimeStorage: Boolean(graph && graph.summary.runtimeInstanceCount > 0),
    externalAccess: Boolean(permissionSummary?.netEnabled || permissionSummary?.shellEnabled),
    retentionPolicy: productApp?.dataLifecycle?.retention ?? null,
    deletionPolicy: productApp?.dataLifecycle?.deletion ?? null,
    migrationPolicy: productApp?.dataLifecycle?.migration ?? null,
    sharePolicy: productApp?.dataLifecycle?.share ?? null,
    runtimeRunCount: graph?.summary.runtimeRunCount ?? 0,
    artifactCount: graph?.summary.artifactCount ?? 0,
    lastActivityAt: graph?.summary.lastActivityAt,
  };
}

function deriveReleaseStatus(
  validationSummary: AppBuilderValidationSummary,
  issues: AppBuilderIssue[],
  previewResults: AppBuilderFacts['previewResults'],
): AppBuilderFactStatus {
  const releaseRehearsal = previewResults
    .filter((preview) => preview.kind === 'release-rehearsal')
    .sort((left, right) => right.observedAt - left.observedAt)[0];
  if (releaseRehearsal) {
    if (releaseRehearsal.status === 'failed' || releaseRehearsal.status === 'blocked') return 'blocked';
    if (releaseRehearsal.status === 'warning') return 'warning';
    if (releaseRehearsal.status === 'running' || releaseRehearsal.status === 'waiting') return 'running';
    if (releaseRehearsal.status === 'ready') return 'notVerified';
    if (releaseRehearsal.status === 'passed') {
      const checkStatuses = releaseRehearsal.checks?.map(check => check.status) ?? [];
      if (checkStatuses.length === 0) return 'notVerified';
      if (checkStatuses.some(status => status === 'failed' || status === 'blocked')) return 'blocked';
      if (checkStatuses.some(status => status === 'warning')) return 'warning';
      if (checkStatuses.some(status => status === 'running' || status === 'waiting')) return 'running';
      if (checkStatuses.some(status => status !== 'passed')) return 'notVerified';
      return issues.some((issue) => issue.severity === 'fatal') ? 'blocked' : 'passed';
    }
    if (releaseRehearsal.status === 'notRun' || releaseRehearsal.status === 'notVerified') return 'notVerified';
  }
  if (issues.some((issue) => issue.severity === 'fatal')) return 'blocked';
  if (validationSummary.status === 'failed' || validationSummary.status === 'blocked') return 'blocked';
  if (validationSummary.status === 'warning') return 'warning';
  if (validationSummary.status === 'running') return 'running';
  return 'notVerified';
}

function latestPreviewCheck(
  previewResults: AppBuilderFacts['previewResults'],
  checkId: string,
  kind?: AppBuilderFacts['previewResults'][number]['kind'],
): { status: AppBuilderFactStatus | (string & {}); detail?: string } | null {
  const preview = previewResults
    .filter(candidate =>
      (!kind || candidate.kind === kind) &&
      candidate.checks?.some(check => check.id === checkId)
    )
    .sort((left, right) => right.observedAt - left.observedAt)[0];
  const check = preview?.checks?.find(candidate => candidate.id === checkId);
  return check
    ? {
        status: check.status,
        detail: check.detail,
      }
    : null;
}

export function buildAppBuilderFacts(input: BuildAppBuilderFactsInput): AppBuilderFacts {
  const {
    productApp,
    componentSubject,
    hostSurface,
    previewTarget,
    runtimeContext,
    executionGraph,
    sourceFileCount,
    permissionSummary,
    runtimeHasAttention,
    issues,
    logs,
    validationSummary,
  } = input;
  const observedAt = input.observedAt;
  const fatalIssueCount = issues.filter((issue) => issue.severity === 'fatal').length;
  const warningIssueCount = issues.filter((issue) => issue.severity === 'warning').length;
  const graphValidationSummary = validationSummaryFromExecutionGraph(executionGraph, productApp, componentSubject);
  const effectiveValidationSummary = graphValidationSummary
    ?? validationSummary
    ?? (componentSubject
      ? buildDerivedComponentValidationSummary(componentSubject, issues, observedAt)
      : buildDerivedValidationSummary(productApp, issues, runtimeHasAttention, observedAt));
  const componentRows = productApp?.components ?? [];
  const agentComponents = componentRows.filter(component => component.kind === 'agent');
  const graphPreviewResults = previewResultsFromExecutionGraph(executionGraph, runtimeContext);
  const previewResults = graphPreviewResults.length > 0
    ? graphPreviewResults
    : previewTarget && runtimeContext
      ? [{
          id: `preview:${runtimeContext.runtimeInstanceId}`,
          kind: previewTarget.kind,
          status: fatalIssueCount > 0 ? 'failed' : hostSurface ? 'ready' : 'waiting',
          workId: previewTarget.work.id,
          runtimeInstanceId: runtimeContext.runtimeInstanceId,
          productAppId: runtimeContext.productAppId,
          componentId: runtimeContext.productAppSurfaceId,
          productAppSurfaceId: runtimeContext.productAppSurfaceId,
          surfaceId: runtimeContext.surfaceId,
          observedAt,
          issueCount: issues.length,
          fatalIssueCount,
          warningIssueCount,
        }]
      : [];
  const declaredEvalCaseCount = productApp?.evalPlan?.cases?.length ?? 0;
  const latestAgentEvalCheck = latestPreviewCheck(previewResults, 'agentEval', 'agent-eval');
  const persistedSubject = input.persistedFacts?.subject;
  const persistedFactsMatchSubject = persistedSubject?.kind === 'builder-draft';
  const persistedVersion = persistedFactsMatchSubject ? input.persistedFacts?.versionSummary : undefined;
  const persistedShare = persistedFactsMatchSubject ? input.persistedFacts?.shareSummary : undefined;
  const persistedPrivateDataExcluded =
    persistedShare?.privateDataExcluded ?? persistedVersion?.latestRelease?.privateDataExcluded;

  return {
    subject: persistedSubject?.kind === 'builder-draft'
      ? persistedSubject
      : productApp || componentSubject
        ? { kind: 'builder-draft', draftId: productApp?.id ?? componentSubject!.componentId }
        : null,
    blueprint: productApp
      ? {
          whatItDoes: productApp.description,
          howIUseIt: productApp.launch?.kind === 'agentSession'
            ? 'Use the Product App through its app-private agent in the normal session UI.'
            : productApp.primarySurfaceMode === 'sidecarLinked'
            ? 'Chat with the app while using the sidecar preview.'
            : 'Open and use the app in its runtime surface.',
          whatAiDoes: agentComponents.length > 0
            ? 'App-private Agent Components provide intelligent backend actions.'
            : 'No app-private Agent Component behavior is verified yet.',
          whatData: 'Product App package metadata, Work runtime state, and app runtime storage.',
          howReady: effectiveValidationSummary.status === 'passed'
            ? 'Package validation passed; preview and eval facts still determine final release readiness.'
            : 'Readiness is still gated by validation, preview, runtime issues, permissions, data, and eval facts.',
        }
      : componentSubject
        ? {
            whatItDoes: componentSubject.description || `${componentSubject.componentKind} component package`,
            howIUseIt: 'Reference this shared component from a Product App package and validate the consumer lock.',
            whatAiDoes: componentSubject.componentKind === 'agents'
              ? 'This Agent Component can provide reusable intelligent backend behavior.'
              : 'This component provides reusable capability for Product Apps.',
            whatData: 'Component package metadata and contract files. Consumer Product Apps define runtime data use.',
            howReady: 'Readiness is gated by component contract validation, consumer compatibility, permissions, and eval evidence.',
          }
      : undefined,
    technicalBlueprint: productApp
      ? {
          appId: productApp.id,
          version: productApp.version,
          launchKind: productApp.launch?.kind,
          primarySurfaceMode: productApp.primarySurfaceMode ?? undefined,
          runtimeInstanceId: runtimeContext?.runtimeInstanceId,
          hostSurfaceId: runtimeContext?.hostSurfaceId,
        }
      : componentSubject
        ? {
            componentId: componentSubject.componentId,
            componentKind: componentSubject.componentKind,
            version: componentSubject.version,
            packageRoot: componentSubject.packageRoot || input.packageRoot,
          }
      : undefined,
    previewResults,
    issues,
    logs,
    componentGraph: productApp
      ? {
          primarySurfaceId: productApp.primarySurface?.componentId,
          primarySurfaceMode: productApp.primarySurfaceMode ?? undefined,
          sourceFileCount,
          componentCount: componentRows.length,
          agentComponentCount: agentComponents.length,
          components: componentRows.map(component => ({
            componentId: component.componentId,
            kind: component.kind,
            source: component.source,
            role: component.role,
            version: component.version,
          })),
        }
      : componentSubject
        ? {
            componentCount: 1,
            agentComponentCount: componentSubject.componentKind === 'agents' ? 1 : 0,
            components: [{
              componentId: componentSubject.componentId,
              kind: componentSubject.componentKind,
              source: 'shared',
              role: 'subject',
              version: componentSubject.version,
            }],
          }
      : undefined,
    agentSummary: {
      backendActionCount: componentSubject?.componentKind === 'agents' ? 1 : agentComponents.length,
      memoryScopes: hostSurface?.backends?.map(backend => backend.memoryScope || 'none') ?? [],
      sessionPolicies: hostSurface?.backends?.map(backend => backend.sessionPolicy || 'ephemeral') ?? [],
    },
    dataSummary: buildDataSummary(productApp, permissionSummary, executionGraph),
    evalSummary: latestAgentEvalCheck
      ? {
          status: latestAgentEvalCheck.status,
          caseCount: declaredEvalCaseCount,
          detail: latestAgentEvalCheck.detail,
        }
      : {
          status: declaredEvalCaseCount > 0 ? 'notVerified' : 'notRun',
          caseCount: declaredEvalCaseCount,
          detail: declaredEvalCaseCount > 0
            ? `${declaredEvalCaseCount} Product App eval case(s) are declared; executable Agent Eval has not been recorded.`
            : 'Agent Eval has not been run for this Product App subject.',
        },
    validationSummary: effectiveValidationSummary,
    versionSummary: {
      currentVersion: productApp?.version ?? componentSubject?.version ?? persistedVersion?.currentVersion,
      sourceRevision: hostSurface?.runtime?.source_revision ?? persistedVersion?.sourceRevision,
      componentLockDigest: productApp?.componentLockDigest || productApp?.componentLockId || persistedVersion?.componentLockDigest,
      checkpointCount: persistedVersion?.checkpointCount,
      releaseCount: persistedVersion?.releaseCount,
      latestCheckpoint: persistedVersion?.latestCheckpoint,
      latestRelease: persistedVersion?.latestRelease,
      latestPublishedRelease: persistedVersion?.latestPublishedRelease,
      releaseStatus: deriveReleaseStatus(effectiveValidationSummary, issues, previewResults),
    },
    shareSummary: {
      visibility: persistedShare?.visibility ?? 'privateDraft',
      installLocation: persistedShare?.installLocation ?? productApp?.installScope ?? (componentSubject ? 'system' : undefined),
      privateDataExcluded: persistedPrivateDataExcluded === true,
      releaseArtifactId: persistedShare?.releaseArtifactId,
      latestReleaseId: persistedShare?.latestReleaseId,
      catalogStatus: persistedShare?.catalogStatus,
    },
  };
}
