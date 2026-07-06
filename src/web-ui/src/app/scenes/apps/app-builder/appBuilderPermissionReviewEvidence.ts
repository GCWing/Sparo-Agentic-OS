import type { ProductAppCatalogEntry } from '@/infrastructure/api/service-api/AppCatalogAPI';
import type { ProductAppRuntimeContext } from '@/shared/types/product-app-runtime';
import type {
  WorkId,
  WorkBuilderFactStatus,
  WorkBuilderPreviewResult,
} from '@/app/agentic-os/work/domain/workTypes';
import type { AppBuilderPermissionSummary } from './appBuilderFacts';

export interface PermissionReviewEvidenceInput {
  workId: WorkId;
  productApp: ProductAppCatalogEntry;
  runtimeContext: ProductAppRuntimeContext | null;
  componentId?: string | null;
  permissionSummary: AppBuilderPermissionSummary;
  observedAt: number;
}

export function buildPermissionReviewPreviewResult(
  input: PermissionReviewEvidenceInput,
): WorkBuilderPreviewResult {
  const review = buildPermissionReviewSnapshot(input.productApp, input.permissionSummary);
  const failed = review.unobservedPackagePermissions.length > 0 ||
    review.undeclaredRuntimePermissions.length > 0;
  const status: WorkBuilderFactStatus = failed ? 'failed' : 'passed';
  const mismatchDetail = permissionMismatchDetail(review);
  const reviewDetail = failed
    ? `Permission review found app.json and Runtime Host permission mismatch: ${mismatchDetail}.`
    : review.elevatedPermissions.length > 0
      ? `Permission review recorded ${review.elevatedPermissions.length} elevated claim(s): ${review.elevatedPermissions.join(', ')}.`
      : 'Permission review recorded no elevated permission claims.';

  return {
    id: `preview:permission-review:${input.runtimeContext?.runtimeInstanceId ?? input.productApp.id}`,
    kind: 'permission-review',
    status,
    source: 'runtime-observation',
    harnessMode: 'permission-review',
    triggerTurnId: null,
    detail: reviewDetail,
    checks: [
      {
        id: 'permissions',
        status,
        detail: failed
          ? `App Builder requires app.json package permissions and Runtime Host permission claims to agree before review can pass: ${mismatchDetail}.`
          : `Reviewed package permissions [${formatPermissionList(review.packagePermissions)}] against runtime claims [${formatPermissionList(review.runtimePermissionClaims)}].`,
      },
      {
        id: 'permissionManifest',
        status: 'passed',
        detail: review.packagePermissions.length > 0
          ? `app.json declares package permission(s): ${review.packagePermissions.join(', ')}.`
          : 'app.json declares no elevated package permissions.',
      },
      {
        id: 'permissionRuntimeSummary',
        status,
        detail: failed
          ? `Runtime permission summary mismatch: ${mismatchDetail}.`
          : `Runtime permission summary covered package claims; runtime-only claim(s): ${formatPermissionList(review.runtimeOnlyClaims)}.`,
      },
      {
        id: 'permissionRiskReview',
        status,
        detail: failed
          ? `Explicit risk review cannot pass until permission mismatch is fixed: ${mismatchDetail}.`
          : review.elevatedPermissions.length > 0
          ? `Explicit review covered elevated permission claim(s): ${review.elevatedPermissions.join(', ')}.`
          : 'Explicit review confirmed there are no elevated permission claims.',
      },
      {
        id: 'permissionReview',
        status,
        detail: failed
          ? `App Builder cannot record passing permission review while app.json and Runtime Host permission evidence disagree: ${mismatchDetail}.`
          : `App Builder recorded explicit permission review evidence at ${new Date(input.observedAt).toISOString()}.`,
      },
    ],
    workId: input.workId,
    runtimeInstanceId: input.runtimeContext?.runtimeInstanceId ?? null,
    productAppId: input.runtimeContext?.productAppId ?? input.productApp.id,
    componentId: input.componentId
      ?? input.runtimeContext?.productAppSurfaceId
      ?? input.productApp.primarySurface?.componentId
      ?? null,
    productAppSurfaceId: input.runtimeContext?.productAppSurfaceId
      ?? input.productApp.primarySurface?.componentId
      ?? null,
    surfaceId: input.runtimeContext?.surfaceId
      ?? input.productApp.primarySurface?.surfaceId
      ?? null,
    observedAt: input.observedAt,
    issueCount: failed ? 1 : 0,
    fatalIssueCount: failed ? 1 : 0,
    warningIssueCount: 0,
  };
}

export function permissionReviewElevatedPermissionNames(
  productApp: ProductAppCatalogEntry,
  permissionSummary: AppBuilderPermissionSummary,
): string[] {
  const names = new Set<string>();
  if (permissionSummary.readsWorkspace) names.add('workspace.read');
  if (permissionSummary.writesWorkspace) names.add('workspace.write');
  if (permissionSummary.shellEnabled) names.add('shell');
  if (permissionSummary.netEnabled) names.add('net');
  if (permissionSummary.aiEnabled) names.add('ai');
  if (permissionSummary.nodeEnabled) names.add('node');
  if (productApp.permissions?.fs) names.add('fs');
  if (productApp.permissions?.net) names.add('net');
  if (productApp.permissions?.shell) names.add('shell');
  if (productApp.permissions?.gui) names.add('gui');
  if (productApp.permissions?.secrets) names.add('secrets');
  if (productApp.permissions?.ai) names.add('ai');
  return Array.from(names).sort();
}

interface PermissionReviewSnapshot {
  packagePermissions: string[];
  runtimePermissionClaims: string[];
  runtimeOnlyClaims: string[];
  elevatedPermissions: string[];
  unobservedPackagePermissions: string[];
  undeclaredRuntimePermissions: string[];
}

function buildPermissionReviewSnapshot(
  productApp: ProductAppCatalogEntry,
  permissionSummary: AppBuilderPermissionSummary,
): PermissionReviewSnapshot {
  const packagePermissions = productAppPermissionNames(productApp);
  const runtimePermissionClaims = runtimePermissionClaimNames(permissionSummary);
  const elevatedPermissions = Array.from(new Set([
    ...packagePermissions,
    ...runtimePermissionClaims,
  ])).sort();
  const unobservedPackagePermissions = packagePermissions
    .filter((name) => !packagePermissionObservedByRuntime(name, permissionSummary));
  const runtimeOnlyClaims = runtimePermissionClaims
    .filter((name) => !runtimeClaimCoveredByPackagePermission(name, productApp));
  const undeclaredRuntimePermissions = runtimeOnlyClaims
    .filter(runtimeClaimRequiresPackagePermission);

  return {
    packagePermissions,
    runtimePermissionClaims,
    runtimeOnlyClaims,
    elevatedPermissions,
    unobservedPackagePermissions,
    undeclaredRuntimePermissions,
  };
}

function productAppPermissionNames(productApp: ProductAppCatalogEntry): string[] {
  const names = new Set<string>();
  if (productApp.permissions?.fs) names.add('fs');
  if (productApp.permissions?.net) names.add('net');
  if (productApp.permissions?.shell) names.add('shell');
  if (productApp.permissions?.gui) names.add('gui');
  if (productApp.permissions?.secrets) names.add('secrets');
  if (productApp.permissions?.ai) names.add('ai');
  return Array.from(names).sort();
}

function runtimePermissionClaimNames(permissionSummary: AppBuilderPermissionSummary): string[] {
  const names = new Set<string>();
  if (permissionSummary.readsWorkspace) names.add('workspace.read');
  if (permissionSummary.writesWorkspace) names.add('workspace.write');
  if (permissionSummary.shellEnabled) names.add('shell');
  if (permissionSummary.netEnabled) names.add('net');
  if (permissionSummary.aiEnabled) names.add('ai');
  if (permissionSummary.nodeEnabled) names.add('node');
  return Array.from(names).sort();
}

function packagePermissionObservedByRuntime(
  name: string,
  permissionSummary: AppBuilderPermissionSummary,
): boolean {
  if (name === 'fs') return permissionSummary.readsWorkspace && permissionSummary.writesWorkspace;
  if (name === 'net') return permissionSummary.netEnabled;
  if (name === 'shell') return permissionSummary.shellEnabled;
  if (name === 'ai') return permissionSummary.aiEnabled;
  return false;
}

function runtimeClaimCoveredByPackagePermission(
  name: string,
  productApp: ProductAppCatalogEntry,
): boolean {
  if (name === 'workspace.read' || name === 'workspace.write') return productApp.permissions?.fs === true;
  if (name === 'net') return productApp.permissions?.net === true;
  if (name === 'shell') return productApp.permissions?.shell === true;
  if (name === 'ai') return productApp.permissions?.ai === true;
  return false;
}

function runtimeClaimRequiresPackagePermission(name: string): boolean {
  return name === 'workspace.read' ||
    name === 'workspace.write' ||
    name === 'net' ||
    name === 'shell' ||
    name === 'ai';
}

function permissionMismatchDetail(review: PermissionReviewSnapshot): string {
  const details: string[] = [];
  if (review.unobservedPackagePermissions.length > 0) {
    details.push(`package permission(s) missing runtime evidence: ${review.unobservedPackagePermissions.join(', ')}`);
  }
  if (review.undeclaredRuntimePermissions.length > 0) {
    details.push(`Runtime Host permission claim(s) missing app.json declaration: ${review.undeclaredRuntimePermissions.join(', ')}`);
  }
  return details.join('; ');
}

function formatPermissionList(names: string[]): string {
  return names.length > 0 ? names.join(', ') : 'none';
}
