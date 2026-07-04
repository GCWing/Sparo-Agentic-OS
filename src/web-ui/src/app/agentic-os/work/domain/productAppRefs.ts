import type { ProductAppCatalogEntry } from '@/infrastructure/api/service-api/AppCatalogAPI';
import type { WorkAppRef } from './workTypes';

export function productAppWorkRef(app: ProductAppCatalogEntry): WorkAppRef {
  return {
    kind: 'product_app',
    appId: app.id,
    appVersion: app.version,
    componentLockDigest: app.componentLockDigest || app.componentLockId,
  };
}

export function nativeAppWorkRef(appId: string): WorkAppRef {
  return {
    kind: 'native_app',
    appId,
  };
}

export function sameProductAppRef(left: WorkAppRef, right: WorkAppRef): boolean {
  return left.kind === right.kind
    && left.appId === right.appId
    && left.appVersion === right.appVersion
    && left.componentLockDigest === right.componentLockDigest;
}

export function sameAppRef(left: WorkAppRef, right: WorkAppRef): boolean {
  if (left.kind !== right.kind || left.appId !== right.appId) return false;
  if (left.kind === 'native_app') return true;
  return left.appVersion === right.appVersion
    && left.componentLockDigest === right.componentLockDigest;
}
