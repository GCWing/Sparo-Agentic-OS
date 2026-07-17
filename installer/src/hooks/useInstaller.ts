import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import i18n from '../i18n';
import type {
  InstallStep,
  InstallOptions,
  InstallProgress,
  DiskSpaceInfo,
  LaunchContext,
  InstallPathValidation,
} from '../types/installer';
import { DEFAULT_OPTIONS } from '../types/installer';

export interface UseInstallerReturn {
  step: InstallStep;
  next: () => void;
  back: () => void;
  options: InstallOptions;
  setOptions: React.Dispatch<React.SetStateAction<InstallOptions>>;
  progress: InstallProgress;
  isInstalling: boolean;
  error: string | null;
  diskSpace: DiskSpaceInfo | null;
  install: () => Promise<void>;
  exitAndLaunch: () => Promise<void>;
  retryInstall: () => Promise<void>;
  backToOptions: () => void;
  closeInstaller: () => void;
  refreshDiskSpace: (path: string) => Promise<void>;
  clearInstallError: () => void;
  isUninstalling: boolean;
  uninstallCompleted: boolean;
  uninstallError: string | null;
  uninstallProgress: number;
  startUninstall: () => Promise<void>;
}

const STEPS: InstallStep[] = ['lang', 'options', 'progress'];

function resolveUiLanguage(): 'zh' | 'en' {
  if (typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh')) {
    return 'zh';
  }
  return 'en';
}

export function useInstaller(): UseInstallerReturn {
  const [step, setStep] = useState<InstallStep>('lang');
  const [options, setOptions] = useState<InstallOptions>(DEFAULT_OPTIONS);
  const [progress, setProgress] = useState<InstallProgress>({
    step: '',
    percent: 0,
    message: '',
  });
  const [isInstalling, setIsInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diskSpace, setDiskSpace] = useState<DiskSpaceInfo | null>(null);
  const [isUninstalling, setIsUninstalling] = useState(false);
  const [uninstallCompleted, setUninstallCompleted] = useState(false);
  const [uninstallError, setUninstallError] = useState<string | null>(null);
  const [uninstallProgress, setUninstallProgress] = useState(0);

  useEffect(() => {
    let mounted = true;
    (async () => {
      await i18n.changeLanguage(resolveUiLanguage());
      if (!mounted) return;

      try {
        const context = await invoke<LaunchContext>('get_launch_context');
        if (!mounted) return;
        if (context.mode === 'uninstall') {
          setStep('uninstall');
          const uninstallPath = context.uninstallPath;
          if (uninstallPath) {
            setOptions((prev) => ({ ...prev, installPath: uninstallPath }));
          }
          return;
        }
      } catch (err) {
        console.warn('Failed to detect launch context:', err);
      }

      try {
        const path = await invoke<string>('get_initial_install_path');
        if (mounted) {
          setOptions((prev) => ({ ...prev, installPath: path }));
        }
      } catch (err) {
        console.warn('Failed to get default install path:', err);
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const unlisten = listen<InstallProgress>('install-progress', (event) => {
      setProgress(event.payload);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const clearInstallError = useCallback(() => {
    setError(null);
  }, []);

  const next = useCallback(() => {
    const idx = STEPS.indexOf(step);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1]);
  }, [step]);

  const back = useCallback(() => {
    const idx = STEPS.indexOf(step);
    if (idx <= 0) return;
    let targetIdx = idx - 1;
    // 'progress' is a transient phase (install in flight); skip past it when
    // navigating backwards so the user never lands on a dead screen.
    while (targetIdx > 0 && STEPS[targetIdx] === 'progress') {
      targetIdx -= 1;
    }
    setStep(STEPS[targetIdx]);
  }, [step]);

  const refreshDiskSpace = useCallback(async (path: string) => {
    try {
      const info = await invoke<DiskSpaceInfo>('get_disk_space', { path });
      setDiskSpace(info);
    } catch (err) {
      console.warn('Failed to get disk space:', err);
    }
  }, []);

  const install = useCallback(async () => {
    setError(null);
    setIsInstalling(true);
    try {
      const validated = await invoke<InstallPathValidation>('validate_install_path', {
        path: options.installPath,
      });
      const effectiveOptions = {
        ...options,
        installPath: validated.installPath,
      };
      if (validated.installPath !== options.installPath) {
        setOptions((prev) => ({ ...prev, installPath: validated.installPath }));
      }
      setStep('progress');
      setProgress({ step: 'prepare', percent: 0, message: '' });
      await invoke('start_installation', { options: effectiveOptions });
      setStep('progress');
    } catch (err: any) {
      const raw = typeof err === 'string' ? err : err?.message;
      setError((raw && String(raw).trim()) ? String(raw) : i18n.t('errors.install.failed'));
    } finally {
      setIsInstalling(false);
    }
  }, [options]);

  const exitAndLaunch = useCallback(async () => {
    try {
      await invoke('launch_application', { installPath: options.installPath });
      await invoke('close_installer');
    } catch (err: unknown) {
      const raw = typeof err === 'string' ? err : (err as Error)?.message;
      const msg = raw && String(raw).trim()
        ? String(raw)
        : i18n.t('progress.launchFailed');
      throw new Error(msg);
    }
  }, [options.installPath]);

  const retryInstall = useCallback(async () => {
    if (isInstalling) return;
    await install();
  }, [install, isInstalling]);

  const backToOptions = useCallback(() => {
    if (isInstalling) return;
    setError(null);
    setStep('options');
  }, [isInstalling]);

  const closeInstaller = useCallback(() => {
    invoke('close_installer');
  }, []);

  const startUninstall = useCallback(async () => {
    if (isUninstalling) return;
    setUninstallError(null);
    setUninstallCompleted(false);
    setIsUninstalling(true);
    setUninstallProgress(0);
    try {
      await invoke('uninstall', { installPath: options.installPath });
      setUninstallProgress(100);
      setUninstallCompleted(true);
      window.setTimeout(() => {
        closeInstaller();
      }, 600);
    } catch (err: any) {
      setUninstallError(typeof err === 'string' ? err : err.message || 'Uninstall failed');
      setUninstallProgress(0);
    } finally {
      setIsUninstalling(false);
    }
  }, [closeInstaller, isUninstalling, options.installPath]);

  return {
    step, next, back,
    options, setOptions,
    progress, isInstalling, error, diskSpace,
    install, exitAndLaunch, retryInstall, backToOptions,
    closeInstaller, refreshDiskSpace, clearInstallError,
    isUninstalling, uninstallCompleted, uninstallError, uninstallProgress, startUninstall,
  };
}
