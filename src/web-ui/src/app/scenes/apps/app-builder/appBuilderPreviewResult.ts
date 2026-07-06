import type { ProductAppRuntimeContext } from '@/shared/types/product-app-runtime';
import type {
  WorkId,
  WorkBuilderFactStatus,
  WorkBuilderPreviewResult,
} from '@/app/agentic-os/work/domain/workTypes';

export interface AppBuilderPreviewProjectionContext {
  workId: WorkId;
  turnId?: string | null;
  runtimeContext?: ProductAppRuntimeContext | null;
  productAppId?: string | null;
  componentId?: string | null;
  observedAt?: number;
}

export function buildWorkBuilderPreviewResultFromToolResult(
  result: Record<string, unknown>,
  context: AppBuilderPreviewProjectionContext,
): WorkBuilderPreviewResult {
  const resultSummary = recordFromUnknown(result.summary);
  const checks = Array.isArray(result.checks)
    ? result.checks
      .filter((check): check is Record<string, unknown> => isPlainRecord(check))
      .map((check) => ({
        id: stringFromRecord(check, ['id']) ?? 'check',
        status: normalizeBuilderFactStatus(String(check.status ?? 'notVerified')),
        detail: stringFromRecord(check, ['detail']) ?? null,
      }))
    : [];
  const failedCount = numberFromRecord(resultSummary, ['failed', 'fatal']) ??
    checks.filter((check) => check.status === 'failed' || check.status === 'blocked').length;
  const warningCount = numberFromRecord(resultSummary, ['warnings', 'warning']) ??
    checks.filter((check) => check.status === 'warning').length;
  const harnessMode = stringFromRecord(result, ['harnessMode', 'harness_mode']) ?? 'product-app-preview';
  const runtimeInstanceId = stringFromRecord(result, ['runtimeInstanceId', 'runtime_instance_id']) ??
    context.runtimeContext?.runtimeInstanceId ??
    null;
  const productAppId = stringFromRecord(result, ['appId', 'app_id']) ??
    context.productAppId ??
    context.runtimeContext?.productAppId ??
    null;
  const componentId = stringFromRecord(result, ['componentId', 'component_id']) ??
    context.componentId ??
    context.runtimeContext?.productAppSurfaceId ??
    null;

  return {
    id: stringFromRecord(result, ['previewResultId', 'preview_result_id', 'id']) ??
      (runtimeInstanceId
        ? `preview:${runtimeInstanceId}`
        : `preview:${compactFactId(harnessMode)}:${compactFactId(productAppId ?? componentId ?? context.workId)}`),
    kind: normalizeBuilderPreviewKind(result.kind),
    status: normalizeBuilderFactStatus(String(result.status ?? 'notVerified')),
    source: normalizeBuilderPreviewSource(result.source),
    harnessMode,
    triggerTurnId: context.turnId ?? null,
    detail: stringFromRecord(result, ['detail', 'target', 'intent']) ?? null,
    checks,
    workId: context.workId,
    runtimeInstanceId,
    productAppId,
    componentId,
    productAppSurfaceId: stringFromRecord(result, ['productAppSurfaceId', 'product_app_surface_id']) ??
      context.runtimeContext?.productAppSurfaceId ??
      null,
    surfaceId: stringFromRecord(result, ['surfaceId', 'surface_id']) ??
      context.runtimeContext?.surfaceId ??
      null,
    observedAt: context.observedAt ?? Date.now(),
    issueCount: failedCount + warningCount,
    fatalIssueCount: failedCount,
    warningIssueCount: warningCount,
  };
}

export function normalizeBuilderFactStatus(status: string): WorkBuilderFactStatus {
  if (
    status === 'passed' ||
    status === 'warning' ||
    status === 'failed' ||
    status === 'notRun' ||
    status === 'notVerified' ||
    status === 'blocked' ||
    status === 'running' ||
    status === 'ready' ||
    status === 'waiting'
  ) {
    return status;
  }
  return 'notVerified';
}

export function normalizeBuilderPreviewKind(kind: unknown): WorkBuilderPreviewResult['kind'] {
  if (
    kind === 'product-app-preview' ||
    kind === 'agent-chat' ||
    kind === 'sidecar' ||
    kind === 'full-app' ||
    kind === 'embedded' ||
    kind === 'capability' ||
    kind === 'agent-eval' ||
    kind === 'runtime-boundary' ||
    kind === 'runtime-dependencies' ||
    kind === 'permission-review' ||
    kind === 'user-path-rehearsal' ||
    kind === 'release-rehearsal'
  ) {
    return kind;
  }
  return 'product-app-preview';
}

export function normalizeBuilderPreviewSource(source: unknown): WorkBuilderPreviewResult['source'] {
  if (
    source === 'runtime-fact' ||
    source === 'runtime-observation' ||
    source === 'preview-harness' ||
    source === 'fix-rerun' ||
    source === 'release-rehearsal'
  ) {
    return source;
  }
  return 'preview-harness';
}

export function compactFactId(value: unknown): string {
  return String(value ?? 'unknown')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9_.:-]/g, '-')
    .slice(0, 96) || 'unknown';
}

export function stringFromRecord(
  record: Record<string, unknown> | undefined,
  keys: readonly string[],
): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function numberFromRecord(
  record: Record<string, unknown> | undefined,
  keys: readonly string[],
): number | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return undefined;
}

function recordFromUnknown(value: unknown): Record<string, unknown> | undefined {
  return isPlainRecord(value) ? value : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
