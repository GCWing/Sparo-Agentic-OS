import { useCallback, useState } from 'react';
import { useTheme } from '@/infrastructure/theme/hooks/useTheme';
import { notificationService } from '@/shared/notification-system';
import { useI18n } from '@/infrastructure/i18n';
import { useProductAppRuntimeStore } from './productAppRuntimeStore';
import { productAppRuntimeHostAPI } from '@/infrastructure/api/service-api/ProductAppRuntimeHostAPI';
import {
  normalizeAppScope,
  systemAppScope,
  type AppScope,
  workspacePathFromAppScope,
} from '@/shared/types/app-scope';

export interface ProductAppRuntimeHostActionsState {
  recompiling: boolean;
  installingDeps: boolean;
  restartingWorker: boolean;
}

export function useProductAppRuntimeHostActions(
  appId: string | undefined,
  options: { scope?: AppScope | null } = {},
) {
  const { themeType } = useTheme();
  const { t } = useI18n('scenes/apps');
  const markStopped = useProductAppRuntimeStore((state) => state.markWorkerStopped);
  const workspacePath = workspacePathFromAppScope(normalizeAppScope(options.scope || systemAppScope()));

  const [recompiling, setRecompiling] = useState(false);
  const [installingDeps, setInstallingDeps] = useState(false);
  const [restartingWorker, setRestartingWorker] = useState(false);

  const recompile = useCallback(async (onSuccess?: () => void) => {
    if (!appId || recompiling) return;
    setRecompiling(true);
    try {
      await productAppRuntimeHostAPI.recompileHostSurface(appId, themeType ?? 'dark', workspacePath);
      notificationService.success(t('productAppRuntime.messages.recompiled'), { duration: 2200 });
      onSuccess?.();
    } catch (err) {
      notificationService.error(
        t('productAppRuntime.messages.recompileFailed', { error: err instanceof Error ? err.message : String(err) }),
      );
    } finally {
      setRecompiling(false);
    }
  }, [appId, recompiling, t, themeType, workspacePath]);

  const installDeps = useCallback(async (onSuccess?: () => void) => {
    if (!appId || installingDeps) return;
    setInstallingDeps(true);
    try {
      const result = await productAppRuntimeHostAPI.installDependencies(appId);
      if (!result.success) {
        notificationService.error(result.stderr || result.stdout || t('productAppRuntime.messages.installDepsFailedGeneric'));
        return;
      }
      notificationService.success(t('productAppRuntime.messages.installDepsOk'), { duration: 2200 });
      onSuccess?.();
    } catch (err) {
      notificationService.error(
        t('productAppRuntime.messages.installDepsFailed', { error: err instanceof Error ? err.message : String(err) }),
      );
    } finally {
      setInstallingDeps(false);
    }
  }, [appId, installingDeps, t]);

  const stopWorker = useCallback(async (onSuccess?: () => void) => {
    if (!appId || restartingWorker) return;
    setRestartingWorker(true);
    try {
      await productAppRuntimeHostAPI.stopWorker(appId);
      markStopped(appId);
      notificationService.success(t('productAppRuntime.messages.workerStopped'), { duration: 2200 });
      onSuccess?.();
    } catch (err) {
      notificationService.error(
        t('productAppRuntime.messages.workerStopFailed', { error: err instanceof Error ? err.message : String(err) }),
      );
    } finally {
      setRestartingWorker(false);
    }
  }, [appId, markStopped, restartingWorker, t]);

  return {
    recompile,
    installDeps,
    stopWorker,
    state: { recompiling, installingDeps, restartingWorker } satisfies ProductAppRuntimeHostActionsState,
  };
}
