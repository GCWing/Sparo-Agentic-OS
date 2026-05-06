/**
 * useLiveAppActions — shared action handlers for Live App operations.
 * Used by both LiveAppStudioPanel and LiveAppScene to avoid duplication.
 */
import { useCallback, useState } from 'react';
import { liveAppAPI } from '@/infrastructure/api/service-api/LiveAppAPI';
import type { LiveApp } from '@/infrastructure/api/service-api/LiveAppAPI';
import { useTheme } from '@/infrastructure/theme/hooks/useTheme';
import { useLastUsedWorkspace } from '@/infrastructure/contexts/WorkspaceContext';
import { notificationService } from '@/shared/notification-system';
import { useI18n } from '@/infrastructure/i18n';
import { useLiveAppStore } from '../liveAppStore';

export interface LiveAppActionsState {
  recompiling: boolean;
  syncing: boolean;
  installingDeps: boolean;
  restartingWorker: boolean;
}

export function useLiveAppActions(appId: string | undefined) {
  const { themeType } = useTheme();
  const { workspacePath } = useLastUsedWorkspace();
  const { t } = useI18n('scenes/apps');
  const markStopped = useLiveAppStore((state) => state.markWorkerStopped);

  const [recompiling, setRecompiling] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [installingDeps, setInstallingDeps] = useState(false);
  const [restartingWorker, setRestartingWorker] = useState(false);

  const recompile = useCallback(async () => {
    if (!appId || recompiling) return;
    setRecompiling(true);
    try {
      await liveAppAPI.recompile(appId, themeType ?? 'dark', workspacePath || undefined);
      notificationService.success(t('liveApp.messages.recompiled'), { duration: 2200 });
    } catch (err) {
      notificationService.error(
        t('liveApp.messages.recompileFailed', { error: err instanceof Error ? err.message : String(err) }),
      );
    } finally {
      setRecompiling(false);
    }
  }, [appId, recompiling, t, themeType, workspacePath]);

  const syncFromFs = useCallback(async (onSuccess?: (app: LiveApp) => void) => {
    if (!appId || syncing) return;
    setSyncing(true);
    try {
      const synced = await liveAppAPI.syncFromFs(appId, themeType ?? 'dark', workspacePath || undefined);
      onSuccess?.(synced);
      notificationService.success(t('liveApp.messages.syncedFromFs'), { duration: 2200 });
    } catch (err) {
      notificationService.error(
        t('liveApp.messages.syncFromFsFailed', { error: err instanceof Error ? err.message : String(err) }),
      );
    } finally {
      setSyncing(false);
    }
  }, [appId, syncing, t, themeType, workspacePath]);

  const installDeps = useCallback(async (onSuccess?: () => void) => {
    if (!appId || installingDeps) return;
    setInstallingDeps(true);
    try {
      const result = await liveAppAPI.installDeps(appId);
      if (!result.success) {
        notificationService.error(result.stderr || result.stdout || t('liveApp.messages.installDepsFailedGeneric'));
        return;
      }
      notificationService.success(t('liveApp.messages.installDepsOk'), { duration: 2200 });
      onSuccess?.();
    } catch (err) {
      notificationService.error(
        t('liveApp.messages.installDepsFailed', { error: err instanceof Error ? err.message : String(err) }),
      );
    } finally {
      setInstallingDeps(false);
    }
  }, [appId, installingDeps, t]);

  const stopWorker = useCallback(async (onSuccess?: () => void) => {
    if (!appId || restartingWorker) return;
    setRestartingWorker(true);
    try {
      await liveAppAPI.workerStop(appId);
      markStopped(appId);
      notificationService.success(t('liveApp.messages.workerStopped'), { duration: 2200 });
      onSuccess?.();
    } catch (err) {
      notificationService.error(
        t('liveApp.messages.workerStopFailed', { error: err instanceof Error ? err.message : String(err) }),
      );
    } finally {
      setRestartingWorker(false);
    }
  }, [appId, markStopped, restartingWorker, t]);

  return {
    recompile,
    syncFromFs,
    installDeps,
    stopWorker,
    state: { recompiling, syncing, installingDeps, restartingWorker } satisfies LiveAppActionsState,
  };
}
