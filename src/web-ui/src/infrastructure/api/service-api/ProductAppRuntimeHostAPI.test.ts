import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductAppRuntimeHostAPI, type ProductAppHostSurface } from './ProductAppRuntimeHostAPI';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('./ApiClient', () => ({
  api: { invoke: invokeMock },
}));

const hostSurface = {
  id: 'excel-host',
  name: 'Excel Live',
  source: {},
  compiled_html: '<html></html>',
} as ProductAppHostSurface;

describe('ProductAppRuntimeHostAPI host surface cache', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('deduplicates in-flight loads and reuses a fresh rendered surface', async () => {
    let release!: (value: ProductAppHostSurface) => void;
    invokeMock.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const api = new ProductAppRuntimeHostAPI();

    const first = api.getHostSurface('excel-host', 'dark', 'D:/workspace');
    const second = api.getHostSurface('excel-host', 'dark', 'D:/workspace');
    expect(invokeMock).toHaveBeenCalledTimes(1);

    release(hostSurface);
    await expect(Promise.all([first, second])).resolves.toEqual([hostSurface, hostSurface]);
    await expect(api.getHostSurface('excel-host', 'dark', 'D:/workspace')).resolves.toBe(hostSurface);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it('separates workspace variants and invalidates app revisions', async () => {
    invokeMock.mockResolvedValue(hostSurface);
    const api = new ProductAppRuntimeHostAPI();

    await api.getHostSurface('excel-host', 'dark', 'D:/workspace-a');
    await api.getHostSurface('excel-host', 'dark', 'D:/workspace-b');
    expect(invokeMock).toHaveBeenCalledTimes(2);

    api.invalidateHostSurface('excel-host');
    await api.getHostSurface('excel-host', 'dark', 'D:/workspace-a');
    expect(invokeMock).toHaveBeenCalledTimes(3);
  });

  it('does not let a stale request repopulate the cache after global invalidation', async () => {
    let release!: (value: ProductAppHostSurface) => void;
    const staleSurface = { ...hostSurface, compiled_html: '<html>stale</html>' };
    const freshSurface = { ...hostSurface, compiled_html: '<html>fresh</html>' };
    invokeMock
      .mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }))
      .mockResolvedValueOnce(freshSurface);
    const api = new ProductAppRuntimeHostAPI();

    const stale = api.getHostSurface('excel-host', 'dark', 'D:/workspace');
    api.invalidateHostSurface();
    release(staleSurface);
    await expect(stale).resolves.toBe(freshSurface);

    await expect(api.getHostSurface('excel-host', 'dark', 'D:/workspace')).resolves.toBe(freshSurface);
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });
});
