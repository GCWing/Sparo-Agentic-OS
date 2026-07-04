import type {
  ProductAppHostSurfaceMeta,
  ProductAppHostSurfacePermissions,
  ProductAppHostSurfaceRuntimeStatus,
} from '@/infrastructure/api/service-api/ProductAppRuntimeHostAPI';

export interface ProductAppRuntimeHostSummary {
  isOpen: boolean;
  isRunning: boolean;
  depsDirty: boolean;
  workerRestartRequired: boolean;
  runtimeAvailable: boolean;
  nodeEnabled: boolean;
  runtimeLabel: string;
  hasAttention: boolean;
}

export interface ProductAppRuntimeHostPermissionSummary {
  readsWorkspace: boolean;
  writesWorkspace: boolean;
  shellEnabled: boolean;
  netEnabled: boolean;
  aiEnabled: boolean;
  nodeEnabled: boolean;
}

function includesWorkspace(paths?: string[]): boolean {
  return Boolean(paths?.includes('{workspace}'));
}

export function isBuiltinBundledProductAppHost(appId?: string | null): boolean {
  return Boolean(appId?.startsWith('builtin-'));
}

export function buildProductAppRuntimeHostSummary(
  app: Pick<ProductAppHostSurfaceMeta, 'id' | 'runtime' | 'permissions'>,
  options: {
    isOpen: boolean;
    isRunning: boolean;
    runtimeStatus: ProductAppHostSurfaceRuntimeStatus | null;
  },
): ProductAppRuntimeHostSummary {
  const depsDirty =
    !isBuiltinBundledProductAppHost(app.id) && Boolean(app.runtime?.deps_dirty);
  const nodeEnabled = Boolean(app.permissions?.node?.enabled);
  const workerRestartRequired = nodeEnabled && Boolean(app.runtime?.worker_restart_required);
  const runtimeAvailable = nodeEnabled ? (options.runtimeStatus?.available ?? false) : true;
  const runtimeLabel = !nodeEnabled
    ? ''
    : options.runtimeStatus?.available
    ? options.runtimeStatus.kind
      ? `${options.runtimeStatus.kind}${options.runtimeStatus.version ? ` ${options.runtimeStatus.version}` : ''}`
      : ''
    : '';

  return {
    isOpen: options.isOpen,
    isRunning: options.isRunning,
    depsDirty,
    workerRestartRequired,
    runtimeAvailable,
    nodeEnabled,
    runtimeLabel,
    hasAttention: depsDirty || workerRestartRequired || (nodeEnabled && !runtimeAvailable),
  };
}

export function summarizeProductAppRuntimeHostPermissions(
  permissions: ProductAppHostSurfacePermissions | undefined,
): ProductAppRuntimeHostPermissionSummary {
  return {
    readsWorkspace: includesWorkspace(permissions?.fs?.read),
    writesWorkspace: includesWorkspace(permissions?.fs?.write),
    shellEnabled: Boolean(permissions?.shell?.allow?.length),
    netEnabled: Boolean(permissions?.net?.allow?.length),
    aiEnabled: Boolean(permissions?.ai?.enabled),
    nodeEnabled: Boolean(permissions?.node?.enabled),
  };
}

export function formatRuntimeTimestamp(timestampMs: number, locale?: string): string {
  try {
    return new Intl.DateTimeFormat(locale || undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestampMs));
  } catch {
    return new Date(timestampMs).toLocaleString();
  }
}

export function inferRuntimeHint(message: string, category?: string): string | null {
  const haystack = `${category ?? ''} ${message}`.toLowerCase();
  if (haystack.includes('js worker pool not initialized') || haystack.includes('runtime unavailable')) {
    return 'runtime-unavailable';
  }
  if (haystack.includes('dependencies install failed') || haystack.includes('deps')) {
    return 'deps-install';
  }
  if (haystack.includes('permission') || haystack.includes('not allowed') || haystack.includes('forbidden')) {
    return 'permission';
  }
  if (haystack.includes('workspace')) {
    return 'workspace-access';
  }
  if (haystack.includes('unknown method')) {
    return 'unknown-method';
  }
  return null;
}
