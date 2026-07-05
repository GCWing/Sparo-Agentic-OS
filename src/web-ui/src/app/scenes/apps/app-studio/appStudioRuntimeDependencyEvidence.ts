import type { ProductAppCatalogEntry } from '@/infrastructure/api/service-api/AppCatalogAPI';
import type { ProductAppHostSurface } from '@/infrastructure/api/service-api/ProductAppRuntimeHostAPI';
import type { ProductAppRuntimeContext } from '@/shared/types/product-app-runtime';
import type {
  WorkId,
  WorkStudioFactStatus,
  WorkStudioPreviewResult,
} from '@/app/agentic-os/work/domain/workTypes';
import type { ProductAppRuntimeHostSummary } from '../product-app-runtime/productAppRuntimeHostModel';

export interface RuntimeDependencyEvidenceInput {
  workId: WorkId;
  productApp: ProductAppCatalogEntry;
  runtimeContext: ProductAppRuntimeContext;
  componentId?: string | null;
  productAppSurfaceId: string;
  surfaceId: string;
  hostSurface: ProductAppHostSurface;
  runtimeSummary: ProductAppRuntimeHostSummary;
  runtimeReady?: RuntimeDependencyReadyEvidence | null;
  observedAt: number;
}

export interface RuntimeDependencyReadyEvidence {
  hostSurfaceId?: string;
  sourceRevision?: string;
  depsRevision?: string;
  depsDirty?: boolean;
  workerRestartRequired?: boolean;
  timestampMs?: number;
  metrics?: RuntimeDependencyReadyMetrics | null;
}

interface RuntimeDependencyReadyMetrics {
  bodyChildCount?: number;
  visibleElementCount?: number;
}

export function buildRuntimeDependencyPreviewResult(
  input: RuntimeDependencyEvidenceInput,
): WorkStudioPreviewResult {
  const checks = buildRuntimeDependencyChecks(input);
  const fatalIssueCount = checks.filter((check) => check.status === 'failed' || check.status === 'blocked').length;
  const warningIssueCount = checks.filter((check) => check.status === 'warning').length;
  const status = derivePreviewStatus(checks);

  return {
    id: `preview:runtime-dependencies:${input.runtimeContext.runtimeInstanceId}`,
    kind: 'runtime-dependencies',
    status,
    source: 'runtime-observation',
    harnessMode: 'runtime-dependencies',
    triggerTurnId: null,
    detail: detailForStatus(status),
    checks,
    workId: input.workId,
    runtimeInstanceId: input.runtimeContext.runtimeInstanceId,
    productAppId: input.runtimeContext.productAppId,
    componentId: input.componentId ?? input.productAppSurfaceId,
    productAppSurfaceId: input.productAppSurfaceId,
    surfaceId: input.surfaceId,
    observedAt: input.observedAt,
    issueCount: fatalIssueCount + warningIssueCount,
    fatalIssueCount,
    warningIssueCount,
  };
}

function buildRuntimeDependencyChecks(
  input: RuntimeDependencyEvidenceInput,
): NonNullable<WorkStudioPreviewResult['checks']> {
  const { hostSurface, runtimeSummary } = input;
  const npmDependencyCount = hostSurface.source?.npm_dependencies?.length ?? 0;
  const esmDependencyCount = hostSurface.source?.esm_dependencies?.length ?? 0;
  const hasRuntimeDependencies = npmDependencyCount > 0 || esmDependencyCount > 0;
  const runtimeLabel = runtimeSummary.runtimeLabel || 'unavailable';
  const sourceRevision = hostSurface.runtime?.source_revision || '';
  const depsRevision = hostSurface.runtime?.deps_revision ?? '';
  const readyHostSurfaceId = input.runtimeReady?.hostSurfaceId || '';
  const readySourceRevision = input.runtimeReady?.sourceRevision || '';
  const readyDepsRevision = input.runtimeReady?.depsRevision ?? '';
  const hasReadyHandshake = Boolean(input.runtimeReady);
  const hasReadyDomMetrics = hasPositiveReadyMetric(input.runtimeReady?.metrics?.bodyChildCount) ||
    hasPositiveReadyMetric(input.runtimeReady?.metrics?.visibleElementCount);
  const hostSurfaceMatches = Boolean(readyHostSurfaceId && readyHostSurfaceId === hostSurface.id);
  const sourceRevisionMatches = Boolean(sourceRevision && readySourceRevision === sourceRevision);
  const depsRevisionMatches = readyDepsRevision === depsRevision;
  const readyDepsClean = input.runtimeReady?.depsDirty === false;
  const readyWorkerFresh = input.runtimeReady?.workerRestartRequired === false;
  const nodeWorkerFresh = !runtimeSummary.nodeEnabled || runtimeSummary.isRunning;

  const dependencyStatus: WorkStudioFactStatus = runtimeSummary.nodeEnabled && !runtimeSummary.runtimeAvailable
    ? 'failed'
    : hasReadyHandshake &&
      hostSurfaceMatches &&
      sourceRevisionMatches &&
      depsRevisionMatches &&
      readyDepsClean &&
      readyWorkerFresh &&
      (esmDependencyCount === 0 || hasReadyDomMetrics) &&
      !runtimeSummary.depsDirty &&
      !runtimeSummary.workerRestartRequired &&
      nodeWorkerFresh
      ? 'passed'
      : 'notVerified';
  let detail: string;
  if (dependencyStatus === 'passed') {
    detail = `Product App Runtime host loaded source revision ${sourceRevision} with dependency revision ${depsRevision || 'none'}; npm dependencies=${npmDependencyCount}, ESM dependencies=${esmDependencyCount}${runtimeSummary.nodeEnabled ? `, worker runtime=${runtimeLabel}` : ''}.`;
  } else if (runtimeSummary.nodeEnabled && !runtimeSummary.runtimeAvailable) {
    detail = 'Node worker runtime is enabled, but no local JavaScript runtime is available to install or execute dependencies.';
  } else if (!hasReadyHandshake) {
    detail = 'No current iframe runtime-ready handshake is recorded for Product App Runtime host source loading and freshness evidence.';
  } else if (!hostSurfaceMatches) {
    detail = `Iframe runtime-ready handshake host surface ${readyHostSurfaceId || 'missing'} does not match current Product App Runtime host surface ${hostSurface.id}.`;
  } else if (!sourceRevisionMatches) {
    detail = `Iframe runtime-ready handshake source revision ${readySourceRevision || 'missing'} does not match current host source revision ${sourceRevision || 'missing'}; revision evidence must come from the compiled iframe runtime adapter.`;
  } else if (!depsRevisionMatches) {
    detail = `Iframe runtime-ready handshake dependency revision ${readyDepsRevision || 'none'} does not match current host dependency revision ${depsRevision || 'none'}.`;
  } else if (!readyDepsClean) {
    detail = `Iframe runtime-ready handshake reported dependency state ${input.runtimeReady?.depsDirty === true ? 'dirty' : 'missing'}; dependency health requires a clean compiled runtime adapter signal.`;
  } else if (!readyWorkerFresh) {
    detail = `Iframe runtime-ready handshake reported worker restart state ${input.runtimeReady?.workerRestartRequired === true ? 'required' : 'missing'}; dependency health requires a fresh compiled runtime adapter signal.`;
  } else if (esmDependencyCount > 0 && !hasReadyDomMetrics) {
    detail = `Browser ESM/CDN dependencies declared: ${esmDependencyCount}; runtime-ready handshake did not include positive DOM metrics after Product App Runtime host source loading.`;
  } else if (runtimeSummary.depsDirty) {
    detail = `Runtime dependencies changed or are not installed. npm dependencies declared: ${npmDependencyCount}; runtime=${runtimeLabel}.`;
  } else if (runtimeSummary.workerRestartRequired) {
    detail = `Worker restart is required before dependency health can be considered current. npm dependencies declared: ${npmDependencyCount}; runtime=${runtimeLabel}.`;
  } else if (runtimeSummary.nodeEnabled && !runtimeSummary.isRunning) {
    detail = `Node worker runtime is enabled, but no running worker was observed for the current Product App runtime instance. npm dependencies declared: ${npmDependencyCount}; runtime=${runtimeLabel}.`;
  } else if (!runtimeSummary.nodeEnabled && !hasRuntimeDependencies) {
    detail = 'No Node worker runtime, npm dependency, or browser ESM dependency is declared, but runtime dependency health still requires Product App Runtime host source loading and freshness evidence.';
  } else if (!runtimeSummary.nodeEnabled || esmDependencyCount > 0) {
    detail = `Browser ESM/CDN dependencies declared: ${esmDependencyCount}; npm dependencies declared: ${npmDependencyCount}. Product App Runtime host must record import-map/CDN resolution before dependency health can pass.`;
  } else if (npmDependencyCount > 0) {
    detail = `Runtime metadata is current for ${npmDependencyCount} npm dependency(ies); runtime=${runtimeLabel}. Product App Runtime host must still record install and worker freshness evidence before dependency health can pass.`;
  } else {
    detail = `Node worker runtime is enabled and no package dependencies are declared; runtime=${runtimeLabel}. Product App Runtime host must still record source loading and worker freshness evidence before dependency health can pass.`;
  }

  return [
    {
      id: 'runtimeDependencies',
      status: dependencyStatus,
      detail,
    },
  ];
}

function hasPositiveReadyMetric(value: number | undefined): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function derivePreviewStatus(
  checks: NonNullable<WorkStudioPreviewResult['checks']>,
): WorkStudioFactStatus {
  if (checks.some((check) => check.status === 'failed' || check.status === 'blocked')) return 'failed';
  if (checks.some((check) => check.status === 'warning')) return 'warning';
  if (checks.some((check) => check.status === 'running' || check.status === 'waiting')) return 'running';
  if (checks.some((check) => check.status === 'notRun' || check.status === 'notVerified')) return 'notVerified';
  return 'passed';
}

function detailForStatus(status: WorkStudioFactStatus): string {
  if (status === 'passed') return 'Runtime dependency health evidence passed.';
  if (status === 'failed' || status === 'blocked') return 'Runtime dependency health evidence failed.';
  if (status === 'warning') return 'Runtime dependency health evidence has warnings.';
  return 'Runtime dependency health evidence is incomplete.';
}
