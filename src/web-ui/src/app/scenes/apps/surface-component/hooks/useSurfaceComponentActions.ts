/**
 * useSurfaceComponentActions — shared action handlers for Product App operations.
 * Used by both AppStudioPanel and SurfaceComponentScene to avoid duplication.
 */
import { useCallback, useState } from 'react';
import { surfaceComponentAPI } from '@/infrastructure/api/service-api/SurfaceComponentAPI';
import { useTheme } from '@/infrastructure/theme/hooks/useTheme';
import { notificationService } from '@/shared/notification-system';
import { useI18n } from '@/infrastructure/i18n';
import { useSurfaceComponentStore } from '../surfaceComponentStore';
import {
  normalizeAppScope,
  systemAppScope,
  type AppScope,
  workspacePathFromAppScope,
} from '@/shared/types/app-scope';

export interface SurfaceComponentActionsState {
  recompiling: boolean;
  installingDeps: boolean;
  restartingWorker: boolean;
}

export function useSurfaceComponentActions(
  appId: string | undefined,
  options: { scope?: AppScope | null } = {},
) {
  const { themeType } = useTheme();
  const { t } = useI18n('scenes/apps');
  const markStopped = useSurfaceComponentStore((state) => state.markWorkerStopped);
  const workspacePath = workspacePathFromAppScope(normalizeAppScope(options.scope || systemAppScope()));

  const [recompiling, setRecompiling] = useState(false);
  const [installingDeps, setInstallingDeps] = useState(false);
  const [restartingWorker, setRestartingWorker] = useState(false);

  const recompile = useCallback(async (onSuccess?: () => void) => {
    if (!appId || recompiling) return;
    setRecompiling(true);
    try {
      await surfaceComponentAPI.recompile(appId, themeType ?? 'dark', workspacePath);
      notificationService.success(t('surfaceComponent.messages.recompiled'), { duration: 2200 });
      onSuccess?.();
    } catch (err) {
      notificationService.error(
        t('surfaceComponent.messages.recompileFailed', { error: err instanceof Error ? err.message : String(err) }),
      );
    } finally {
      setRecompiling(false);
    }
  }, [appId, recompiling, t, themeType, workspacePath]);

  const installDeps = useCallback(async (onSuccess?: () => void) => {
    if (!appId || installingDeps) return;
    setInstallingDeps(true);
    try {
      const result = await surfaceComponentAPI.installDeps(appId);
      if (!result.success) {
        notificationService.error(result.stderr || result.stdout || t('surfaceComponent.messages.installDepsFailedGeneric'));
        return;
      }
      notificationService.success(t('surfaceComponent.messages.installDepsOk'), { duration: 2200 });
      onSuccess?.();
    } catch (err) {
      notificationService.error(
        t('surfaceComponent.messages.installDepsFailed', { error: err instanceof Error ? err.message : String(err) }),
      );
    } finally {
      setInstallingDeps(false);
    }
  }, [appId, installingDeps, t]);

  const stopWorker = useCallback(async (onSuccess?: () => void) => {
    if (!appId || restartingWorker) return;
    setRestartingWorker(true);
    try {
      await surfaceComponentAPI.workerStop(appId);
      markStopped(appId);
      notificationService.success(t('surfaceComponent.messages.workerStopped'), { duration: 2200 });
      onSuccess?.();
    } catch (err) {
      notificationService.error(
        t('surfaceComponent.messages.workerStopFailed', { error: err instanceof Error ? err.message : String(err) }),
      );
    } finally {
      setRestartingWorker(false);
    }
  }, [appId, markStopped, restartingWorker, t]);

  return {
    recompile,
    installDeps,
    stopWorker,
    state: { recompiling, installingDeps, restartingWorker } satisfies SurfaceComponentActionsState,
  };
}
