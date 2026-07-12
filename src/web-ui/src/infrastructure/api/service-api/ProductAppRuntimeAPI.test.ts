import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductAppRuntimeAPI, type ResolvedProductAppRuntimeInstance } from './ProductAppRuntimeAPI';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('./ApiClient', () => ({
  api: { invoke: invokeMock },
}));

const resolvedRuntime: ResolvedProductAppRuntimeInstance = {
  workId: 'work-1',
  runtimeInstanceId: 'runtime-1',
  slotId: 'excel-live',
  appId: 'builtin-excel-live',
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
      workId: 'work-1',
      slotId: 'excel-live',
      appId: 'builtin-excel-live',
      releaseId: 'release-excel-1',
      configRevision: 'sha256:config',
      dataSchemaVersion: '1.0.0',
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
});
