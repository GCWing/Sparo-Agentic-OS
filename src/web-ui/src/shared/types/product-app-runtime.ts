export interface ProductAppRuntimeContext {
  workId: string;
  runtimeInstanceId: string;
  productAppId: string;
  productAppVersion: string;
  componentLockDigest: string;
  productAppSurfaceId: string;
  surfaceId: string;
  hostSurfaceId: string;
}

export const productAppRuntimeHostEvents = {
  created: 'product-app-runtime-host-created',
  updated: 'product-app-runtime-host-updated',
  recompiled: 'product-app-runtime-host-recompiled',
  rolledBack: 'product-app-runtime-host-rolled-back',
  deleted: 'product-app-runtime-host-deleted',
  workerRestarted: 'product-app-runtime-worker-restarted',
  workerStopped: 'product-app-runtime-worker-stopped',
  runtimeIssue: 'product-app-runtime-issue',
  runtimeLog: 'product-app-runtime-log',
  runtimeIssuesCleared: 'product-app-runtime-issues-cleared',
} as const;
