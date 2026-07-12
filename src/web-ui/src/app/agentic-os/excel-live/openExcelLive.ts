import { openProductAppRuntime } from '@/app/scenes/apps/product-app-runtime/productAppRuntimeService';
import {
  beginNavigationIntent,
  cancelPendingSessionNavigation,
  commitPendingSessionNavigation,
  getNavigationEpoch,
} from '@/app/navigation/navigationController';
import {
  intelligentAppAPI,
  type ActiveAppRef,
} from '@/infrastructure/api/service-api/IntelligentAppAPI';
import { useThemeStore } from '@/infrastructure/theme';
import { appScopeFromWorkspacePath, systemAppScope } from '@/shared/types/app-scope';
import { createLogger } from '@/shared/utils/logger';
import { useExcelLiveLaunchStore } from './excelLiveLaunchStore';

const log = createLogger('ExcelLive');

const EXCEL_LIVE_APP_ID = 'builtin-excel-live';

function normalizeLaunchPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  return /^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//')
    ? normalized.toLowerCase()
    : normalized;
}

async function launchKeyForPath(filePath: string): Promise<string> {
  const identity = normalizeLaunchPath(filePath);
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(identity),
    );
    const hex = [...new Uint8Array(digest)]
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');
    return `excel-file:${hex}`;
  }
  return `excel-file:${encodeURIComponent(identity)}`;
}

async function resolveExcelLiveApp(): Promise<ActiveAppRef> {
  const catalog = await intelligentAppAPI.listCatalog();
  const slot = catalog.slots.find((candidate) => (
    candidate.variants.some(({ app }) => app.appId === EXCEL_LIVE_APP_ID)
  ));
  const active = slot ? intelligentAppAPI.activeRef(slot) : null;
  if (!active) {
    throw new Error('Excel Live has no active compatible Release.');
  }
  return active;
}

export async function openExcelLive(options: {
  workspacePath?: string | null;
  filePath?: string | null;
} = {}): Promise<void> {
  const navigationEpoch = beginNavigationIntent();
  const launchOwnerToken = `excel-live-navigation:${navigationEpoch}`;
  const isNavigationCurrent = () => navigationEpoch === getNavigationEpoch();
  const committed = commitPendingSessionNavigation(
    `pending-excel-live:${navigationEpoch}`,
    { navigationEpoch },
  );
  if (!committed) return;

  let launchKey: string | null = null;
  try {
    launchKey = options.filePath ? await launchKeyForPath(options.filePath) : null;
    if (!isNavigationCurrent()) return;

    if (options.filePath && launchKey) {
      useExcelLiveLaunchStore.getState().setPendingPath(
        launchKey,
        options.filePath,
        launchOwnerToken,
      );
    }

    const scope = options.workspacePath
      ? appScopeFromWorkspacePath(options.workspacePath) || systemAppScope()
      : systemAppScope();
    const entry = await resolveExcelLiveApp();
    if (!isNavigationCurrent()) return;

    log.info('Opening Excel Live', {
      workspacePath: options.workspacePath || null,
      filePath: options.filePath || null,
    });

    await openProductAppRuntime(entry, {
      entityId: launchKey,
      workspacePath: options.workspacePath || undefined,
      scope,
      title: 'Excel Live',
      objective: options.filePath ? `Edit ${options.filePath}` : 'Open a workbook',
      theme: useThemeStore.getState().currentTheme?.type ?? 'dark',
      navigationEpoch,
      isNavigationCurrent,
    });
  } catch (error) {
    if (launchKey) {
      useExcelLiveLaunchStore.getState().clearPendingPath(launchKey, launchOwnerToken);
    }
    throw error;
  } finally {
    if (!isNavigationCurrent() && launchKey) {
      useExcelLiveLaunchStore.getState().clearPendingPath(launchKey, launchOwnerToken);
    }
    cancelPendingSessionNavigation(navigationEpoch);
  }
}

export function isSpreadsheetFilePath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith('.xlsx')
    || lower.endsWith('.xlsm')
    || lower.endsWith('.csv');
}
