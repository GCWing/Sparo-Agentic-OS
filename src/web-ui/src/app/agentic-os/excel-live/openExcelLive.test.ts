import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelPendingSessionNavigation,
  commitPendingSessionNavigation,
} from '@/app/navigation/navigationController';
import { openProductAppRuntime } from '@/app/scenes/apps/product-app-runtime/productAppRuntimeService';
import {
  intelligentAppAPI,
  type ActiveAppRef,
  type IntelligentAppCatalog,
} from '@/infrastructure/api/service-api/IntelligentAppAPI';
import { useExcelLiveLaunchStore } from './excelLiveLaunchStore';
import { openExcelLive } from './openExcelLive';

const navigationMock = vi.hoisted(() => ({ epoch: 0 }));

vi.mock('@/app/navigation/navigationController', () => ({
  beginNavigationIntent: vi.fn(() => ++navigationMock.epoch),
  cancelPendingSessionNavigation: vi.fn(() => true),
  commitPendingSessionNavigation: vi.fn(() => true),
  getNavigationEpoch: vi.fn(() => navigationMock.epoch),
}));

vi.mock('@/app/scenes/apps/product-app-runtime/productAppRuntimeService', () => ({
  openProductAppRuntime: vi.fn(),
}));

vi.mock('@/infrastructure/api/service-api/IntelligentAppAPI', () => ({
  intelligentAppAPI: {
    listCatalog: vi.fn(),
    activeRef: vi.fn(),
  },
}));

vi.mock('@/infrastructure/theme', () => ({
  useThemeStore: {
    getState: () => ({ currentTheme: { type: 'light' } }),
  },
}));

const excelApp: ActiveAppRef = {
  slotId: 'builtin-excel-live',
  appId: 'builtin-excel-live',
  releaseId: 'release_excel_live',
  configRevision: 'sha256:config',
  dataSchemaVersion: '1.0.0',
  runtime: {
    launch: {
      kind: 'applicationSurface',
      targetId: 'builtin-excel-live',
      scopeRequirement: 'workspaceOptional',
    },
    primarySurface: {
      componentId: 'builtin-excel-live-surface',
      surfaceId: 'main',
    },
    primarySurfaceMode: 'immersivePrimary',
    workMultiplicity: 'singleton',
    icon: { kind: 'lucide', name: 'Sheet' },
    category: 'productivity',
    tags: ['excel'],
  },
};

const catalog = {
  slots: [{
    slotId: excelApp.slotId,
    displayName: 'Excel Live',
    variants: [{
      app: {
        appId: excelApp.appId,
        slotId: excelApp.slotId,
        displayName: 'Excel Live',
        owner: { kind: 'system' },
        createdAtMs: 1,
      },
      releases: [],
      upstreamUpdateAvailable: false,
      state: 'active',
    }],
  }],
  drafts: [],
} satisfies IntelligentAppCatalog;

describe('openExcelLive', () => {
  beforeEach(() => {
    navigationMock.epoch = 0;
    vi.mocked(intelligentAppAPI.listCatalog).mockReset().mockResolvedValue(catalog);
    vi.mocked(intelligentAppAPI.activeRef).mockReset().mockReturnValue(excelApp);
    vi.mocked(openProductAppRuntime).mockReset().mockResolvedValue(undefined);
    vi.mocked(commitPendingSessionNavigation).mockClear().mockReturnValue(true);
    vi.mocked(cancelPendingSessionNavigation).mockClear().mockReturnValue(true);
    useExcelLiveLaunchStore.setState({ pendingPaths: {} });
  });

  it('paints a pending conversation shell before activation lookup completes', async () => {
    let resolveCatalog!: (value: IntelligentAppCatalog) => void;
    vi.mocked(intelligentAppAPI.listCatalog).mockReturnValueOnce(
      new Promise(resolve => { resolveCatalog = resolve; }),
    );

    const opening = openExcelLive();

    expect(commitPendingSessionNavigation).toHaveBeenCalledWith(
      'pending-excel-live:1',
      { navigationEpoch: 1 },
    );
    expect(openProductAppRuntime).not.toHaveBeenCalled();

    resolveCatalog(catalog);
    await opening;

    expect(openProductAppRuntime).toHaveBeenCalledWith(
      excelApp,
      expect.objectContaining({ navigationEpoch: 1, theme: 'light' }),
    );
    expect(cancelPendingSessionNavigation).toHaveBeenCalledWith(1);
  });

  it('fails explicitly when the Excel Live slot has no active Release', async () => {
    vi.mocked(intelligentAppAPI.activeRef).mockReturnValueOnce(null);

    await expect(openExcelLive()).rejects.toThrow('no active compatible Release');
    expect(openProductAppRuntime).not.toHaveBeenCalled();
  });

  it('does not let an older activation lookup steal navigation from a newer open', async () => {
    let resolveFirst!: (value: IntelligentAppCatalog) => void;
    vi.mocked(intelligentAppAPI.listCatalog)
      .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(catalog);

    const first = openExcelLive();
    const second = openExcelLive();
    await second;
    resolveFirst(catalog);
    await first;

    expect(openProductAppRuntime).toHaveBeenCalledTimes(1);
    expect(openProductAppRuntime).toHaveBeenCalledWith(
      excelApp,
      expect.objectContaining({ navigationEpoch: 2 }),
    );
  });

  it('does not let an older same-file open clear the newer launch binding', async () => {
    let releaseFirstRuntime!: () => void;
    vi.mocked(openProductAppRuntime)
      .mockImplementationOnce(() => new Promise(resolve => { releaseFirstRuntime = resolve; }))
      .mockResolvedValueOnce(undefined);

    const first = openExcelLive({ filePath: 'C:\\files\\budget.xlsx' });
    await vi.waitFor(() => expect(openProductAppRuntime).toHaveBeenCalledTimes(1));
    const launchKey = vi.mocked(openProductAppRuntime).mock.calls[0][1]?.entityId;
    expect(launchKey).toEqual(expect.stringContaining('excel-file:'));

    const second = openExcelLive({ filePath: 'C:\\files\\budget.xlsx' });
    await second;
    expect(useExcelLiveLaunchStore.getState().peekPendingPath(launchKey!))
      .toBe('C:\\files\\budget.xlsx');

    releaseFirstRuntime();
    await first;

    expect(useExcelLiveLaunchStore.getState().peekPendingPath(launchKey!))
      .toBe('C:\\files\\budget.xlsx');
  });
});
