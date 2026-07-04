import type { ProductAppCatalogEntry } from '@/infrastructure/api/service-api/AppCatalogAPI';
import type { ProductAppRuntimeContext } from '@/shared/types/product-app-runtime';
import type {
  WorkId,
  WorkStudioFactStatus,
  WorkStudioPreviewResult,
} from '@/app/agentic-os/work/domain/workTypes';
import type { AppStudioPermissionSummary } from './appStudioFacts';

export interface RuntimeBoundaryStorageProbe {
  status: 'passed' | 'failed';
  scope?: string | null;
  error?: string | null;
}

export interface RuntimeBoundaryDataProbe {
  status: 'passed' | 'failed' | 'notVerified';
  scope?: string | null;
  probeKey?: string | null;
  writeVerified?: boolean;
  readVerified?: boolean;
  deleteVerified?: boolean;
  error?: string | null;
}

export interface RuntimeBoundaryEvidenceInput {
  workId: WorkId;
  productApp: ProductAppCatalogEntry;
  runtimeContext: ProductAppRuntimeContext;
  componentId?: string | null;
  productAppSurfaceId: string;
  surfaceId: string;
  permissionSummary: AppStudioPermissionSummary | null;
  storageProbe: RuntimeBoundaryStorageProbe;
  dataProbe?: RuntimeBoundaryDataProbe | null;
  observedAt: number;
}

export function buildRuntimeBoundaryPreviewResult(
  input: RuntimeBoundaryEvidenceInput,
): WorkStudioPreviewResult {
  const checks = buildRuntimeBoundaryChecks(input);
  const fatalIssueCount = checks.filter((check) => check.status === 'failed' || check.status === 'blocked').length;
  const warningIssueCount = checks.filter((check) => check.status === 'warning').length;
  const status = derivePreviewStatus(checks);

  return {
    id: `preview:runtime-boundary:${input.runtimeContext.runtimeInstanceId}`,
    kind: 'runtime-boundary',
    status,
    source: 'runtime-observation',
    harnessMode: 'runtime-boundary',
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

function buildRuntimeBoundaryChecks(
  input: RuntimeBoundaryEvidenceInput,
): NonNullable<WorkStudioPreviewResult['checks']> {
  const storageProbePassed = input.storageProbe.status === 'passed';
  const elevatedPermissions = elevatedPermissionNames(input.productApp, input.permissionSummary);
  const dataBoundaryDeclared = Boolean(input.productApp.workObjectKinds?.length);
  const dataLifecycle = input.productApp.dataLifecycle ?? null;
  const dataLifecycleDeclared = Boolean(
    dataLifecycle?.retention &&
    dataLifecycle?.deletion &&
    dataLifecycle?.migration &&
    dataLifecycle?.share,
  );
  const sharePolicyExcludesRuntimePrivateData = dataLifecycle?.share === 'excludeRuntimePrivateData' ||
    dataLifecycle?.share === 'declaredWorkObjectsOnly';
  const dataProbe = input.dataProbe ?? null;
  const dataProbePassed = dataProbe?.status === 'passed' &&
    dataProbe.writeVerified === true &&
    dataProbe.readVerified === true &&
    dataProbe.deleteVerified === true;
  const dataProbeFailed = dataProbe?.status === 'failed';
  const dataStatus: WorkStudioFactStatus = !storageProbePassed || dataProbeFailed
    ? 'failed'
    : dataProbePassed && dataBoundaryDeclared
      ? 'passed'
      : 'notVerified';
  const dataLifecycleStatus: WorkStudioFactStatus = !storageProbePassed || dataProbeFailed
    ? 'failed'
    : dataProbePassed && dataLifecycleDeclared
      ? 'passed'
      : 'notVerified';
  const dataSummaryStatus: WorkStudioFactStatus = !storageProbePassed || dataProbeFailed
    ? 'failed'
    : dataProbePassed && dataBoundaryDeclared && dataLifecycleDeclared && sharePolicyExcludesRuntimePrivateData
      ? 'passed'
      : 'notVerified';
  const externalAccessDeclared = elevatedPermissions.some((name) => (
    name === 'net' || name === 'workspace.read' || name === 'workspace.write' || name === 'secrets'
  ));

  return [
    {
      id: 'runtimeStorage',
      status: storageProbePassed ? 'passed' : 'failed',
      detail: storageProbePassed
        ? `Runtime storage scope resolved as ${input.storageProbe.scope || 'work-runtime'} without reading or writing app data.`
        : `Runtime storage scope probe failed: ${input.storageProbe.error || 'unknown error'}.`,
    },
    {
      id: 'permissions',
      status: storageProbePassed
        ? elevatedPermissions.length > 0 ? 'warning' : 'passed'
        : 'failed',
      detail: storageProbePassed
        ? elevatedPermissions.length > 0
          ? `Runtime host accepted the scoped context; elevated permission(s) still require review: ${elevatedPermissions.join(', ')}.`
          : 'Runtime host accepted the scoped context and no elevated permissions are declared.'
        : 'Runtime host permission boundary could not validate the scoped runtime context.',
    },
    {
      id: 'data',
      status: dataStatus,
      detail: dataStatus === 'passed'
        ? `${input.productApp.workObjectKinds?.length ?? 0} work object kind(s) declare the data boundary, and isolated runtime storage write/read/delete behavior passed in ${dataProbe?.scope || input.storageProbe.scope || 'work-runtime'} scope.`
        : !storageProbePassed
          ? 'Runtime data boundary could not be probed because storage scope resolution failed.'
          : dataProbeFailed
            ? `Runtime data behavior probe failed: ${dataProbe?.error || 'unknown error'}.`
            : dataBoundaryDeclared
              ? `${input.productApp.workObjectKinds?.length ?? 0} work object kind(s) declare the data boundary, but isolated runtime storage write/read/delete behavior has not been executed or recorded.`
              : 'Runtime storage scope resolved, but the Product App package has no declared work object data boundary.',
    },
    {
      id: 'dataLifecycle',
      status: dataLifecycleStatus,
      detail: dataLifecycleStatus === 'passed'
        ? `Runtime lifecycle probe wrote, read, and removed isolated data under declared retention=${dataLifecycle?.retention}, deletion=${dataLifecycle?.deletion}, migration=${dataLifecycle?.migration}, share=${dataLifecycle?.share}.`
        : !storageProbePassed
          ? 'Data lifecycle behavior could not be checked because storage scope resolution failed.'
          : dataProbeFailed
            ? `Runtime lifecycle probe failed: ${dataProbe?.error || 'unknown error'}.`
            : dataLifecycle
              ? `Package declares data lifecycle retention=${dataLifecycle.retention ?? 'unspecified'}, deletion=${dataLifecycle.deletion ?? 'unspecified'}, migration=${dataLifecycle.migration ?? 'unspecified'}, share=${dataLifecycle.share ?? 'unspecified'}, but isolated runtime write/read/delete behavior has not been executed or recorded.`
              : 'No data lifecycle policy is declared; runtime retention, deletion, migration, and share-impact behavior has not been executed or recorded.',
    },
    {
      id: 'dataSummary',
      status: dataSummaryStatus,
      detail: dataSummaryStatus === 'passed'
        ? `Data summary covers ${input.productApp.workObjectKinds?.length ?? 0} declared work object kind(s), verified runtime-private storage behavior, ${externalAccessDeclared ? 'declared external or workspace access' : 'no declared external or workspace access'}, and share policy ${dataLifecycle?.share}.`
        : !storageProbePassed
          ? 'Data summary could not be generated because storage scope resolution failed.'
          : dataProbeFailed
            ? `Data summary runtime probe failed: ${dataProbe?.error || 'unknown error'}.`
            : !dataBoundaryDeclared
              ? 'Data summary cannot pass until the Product App declares at least one work object data boundary.'
              : !dataLifecycleDeclared
                ? 'Data summary cannot pass until retention, deletion, migration, and share policies are all declared.'
                : !sharePolicyExcludesRuntimePrivateData
                  ? `Data summary cannot pass because share policy ${dataLifecycle?.share ?? 'unspecified'} does not explicitly exclude runtime-private data.`
                  : 'Data summary can describe declared data boundaries, but isolated runtime write/read/delete behavior has not been executed or recorded.',
    },
  ];
}

function elevatedPermissionNames(
  productApp: ProductAppCatalogEntry,
  permissionSummary: AppStudioPermissionSummary | null,
): string[] {
  const names = new Set<string>();
  if (permissionSummary?.readsWorkspace) names.add('workspace.read');
  if (permissionSummary?.writesWorkspace) names.add('workspace.write');
  if (permissionSummary?.shellEnabled) names.add('shell');
  if (permissionSummary?.netEnabled) names.add('net');
  if (permissionSummary?.aiEnabled) names.add('ai');
  if (permissionSummary?.nodeEnabled) names.add('node');
  if (productApp.permissions?.fs) names.add('fs');
  if (productApp.permissions?.net) names.add('net');
  if (productApp.permissions?.shell) names.add('shell');
  if (productApp.permissions?.gui) names.add('gui');
  if (productApp.permissions?.secrets) names.add('secrets');
  if (productApp.permissions?.ai) names.add('ai');
  return Array.from(names).sort();
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
  if (status === 'passed') return 'Runtime permission and data boundary evidence passed.';
  if (status === 'warning') return 'Runtime boundary evidence is recorded with permission warnings.';
  if (status === 'failed' || status === 'blocked') return 'Runtime boundary evidence failed.';
  return 'Runtime boundary evidence is incomplete.';
}
