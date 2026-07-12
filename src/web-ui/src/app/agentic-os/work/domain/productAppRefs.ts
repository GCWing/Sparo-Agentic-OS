import type { WorkAppRef } from './workTypes';

type ImmutableProductAppRef = Pick<
  WorkAppRef,
  'slotId' | 'appId' | 'releaseId' | 'configRevision' | 'dataSchemaVersion'
>;

export function productAppWorkRef(app: ImmutableProductAppRef): WorkAppRef {
  return {
    kind: 'product_app',
    slotId: app.slotId,
    appId: app.appId,
    releaseId: app.releaseId,
    configRevision: app.configRevision,
    dataSchemaVersion: app.dataSchemaVersion,
  };
}

/** Core-owned surfaces still receive an explicit, stable execution identity. */
export function nativeAppWorkRef(appId: string): WorkAppRef {
  return {
    kind: 'native_app',
    slotId: appId,
    appId,
    releaseId: `core-${appId}`,
    configRevision: 'core-default',
    dataSchemaVersion: '1',
  };
}

export function sameProductAppRef(left: WorkAppRef, right: WorkAppRef): boolean {
  return left.kind === 'product_app'
    && right.kind === 'product_app'
    && sameAppRef(left, right);
}

export function sameAppRef(left: WorkAppRef, right: WorkAppRef): boolean {
  return left.kind === right.kind
    && left.slotId === right.slotId
    && left.appId === right.appId
    && left.releaseId === right.releaseId
    && left.configRevision === right.configRevision
    && left.dataSchemaVersion === right.dataSchemaVersion;
}
