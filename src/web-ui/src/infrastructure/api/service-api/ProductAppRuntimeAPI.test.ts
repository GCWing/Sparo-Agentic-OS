import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductAppRuntimeAPI, type ResolvedProductAppRuntimeInstance } from './ProductAppRuntimeAPI';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('./ApiClient', () => ({
  api: { invoke: invokeMock },
}));

const resolvedRuntime: ResolvedProductAppRuntimeInstance = {
  workLocator: 'work-1',
  runtimeInstanceId: 'runtime-1',
  slotId: 'excel-live',
  appId: 'builtin-excel-live',
  appName: 'Excel Live',
  workMultiplicity: 'multiple',
  releaseId: 'release-excel-1',
  configRevision: 'sha256:config',
  dataSchemaVersion: '1.0.0',
  productAppSurfaceId: 'excel-surface',
  surfaceId: 'primary',
  implementationRef: 'builtin',
  host: { kind: 'productAppRuntime', surfaceId: 'excel-host' },
  runtimeContext: {
    workId: 'work-1',
    runtimeInstanceId: 'runtime-1',
    slotId: 'excel-live',
    appId: 'builtin-excel-live',
    releaseId: 'release-excel-1',
    configRevision: 'sha256:config',
    dataSchemaVersion: '1.0.0',
    productAppSurfaceId: 'excel-surface',
    surfaceId: 'primary',
    hostSurfaceId: 'excel-host',
  },
};

describe('ProductAppRuntimeAPI', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('singleflights identical runtime resolutions without permanently caching them', async () => {
    let release!: (value: ResolvedProductAppRuntimeInstance) => void;
    invokeMock.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const api = new ProductAppRuntimeAPI();
    const request = {
      locator: 'work-1',
      slotId: 'excel-live',
      appId: 'builtin-excel-live',
      productAppSurfaceId: 'excel-surface',
      surfaceId: 'primary',
    };

    const first = api.resolveProductAppRuntimeInstance(request);
    const second = api.resolveProductAppRuntimeInstance(request);
    expect(invokeMock).toHaveBeenCalledTimes(1);

    release(resolvedRuntime);
    await expect(Promise.all([first, second])).resolves.toEqual([resolvedRuntime, resolvedRuntime]);

    invokeMock.mockResolvedValueOnce(resolvedRuntime);
    await api.resolveProductAppRuntimeInstance(request);
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it('inspects Work compatibility before a historical Work is opened', async () => {
    const compatibility = {
      status: 'versionIncompatible' as const,
      slotId: 'excel-live',
      appId: 'builtin-excel-live',
      createdWithReleaseId: 'release-excel-1',
      workDataSchemaVersion: '1.0.0',
      installedReleaseId: 'release-excel-2',
      installedDataSchemaVersion: '2.0.0',
    };
    invokeMock.mockResolvedValueOnce(compatibility);

    await expect(new ProductAppRuntimeAPI().prepareProductAppWork('work-1'))
      .resolves.toEqual(compatibility);
    expect(invokeMock).toHaveBeenCalledWith('prepare_product_app_work', {
      request: { locator: 'work-1' },
    });
  });
});
