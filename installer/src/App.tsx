import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { WindowControls } from './components/WindowControls';
import { SparoMark } from './components/brand/SparoMark';
import { LanguageSelect } from './pages/LanguageSelect';
import { Options } from './pages/Options';
import { ModelSetup } from './pages/ModelSetup';
import { ProgressPage } from './pages/Progress';
import { ThemeSetup } from './pages/ThemeSetup';
import { UninstallPage } from './pages/Uninstall';
import { useInstaller } from './hooks/useInstaller';
import { useSyncInstallerRootTheme, resolveInstallerThemeForPreference } from './theme/installerThemeRuntime';
import { OrbitStage } from './components/brand/OrbitStage';
import type { OrbitPhase } from './components/brand/OrbitStage';
import type { InstallProgress } from './types/installer';
import './styles/global.css';

// Map install progress step to satellite index (0 = none, 1-4 = lit count)
function progressToSatellite(step: string, percent: number): number {
  if (!step || percent === 0) return 0;
  if (step === 'prepare') return 1;
  if (step === 'extract') return 2;
  if (['registry', 'shortcuts', 'context_menu', 'path'].includes(step)) return 3;
  if (['config', 'complete'].includes(step)) return 4;
  return 1;
}

function derivePhase(
  step: string,
  installationCompleted: boolean,
  _isInstalling: boolean,
  error: string | null,
  progress: InstallProgress,
): { phase: OrbitPhase; activeSatellite: number } {
  if (step === 'uninstall') {
    return { phase: 'farewell', activeSatellite: 4 };
  }
  if (step === 'lang') {
    return { phase: 'idle', activeSatellite: 0 };
  }
  if (step === 'options') {
    return { phase: 'place', activeSatellite: 0 };
  }
  if (step === 'progress') {
    if (error) {
      return { phase: 'place', activeSatellite: 0 };
    }
    if (installationCompleted || progress.percent >= 100) {
      return { phase: 'ignited', activeSatellite: 4 };
    }
    return {
      phase: 'igniting',
      activeSatellite: progressToSatellite(progress.step, progress.percent),
    };
  }
  if (step === 'model' || step === 'theme') {
    return { phase: 'ignited', activeSatellite: 4 };
  }
  return { phase: 'idle', activeSatellite: 0 };
}

function App() {
  const installer = useInstaller();
  useSyncInstallerRootTheme(installer.options.themePreference);

  const chromeDark = useMemo(
    () => resolveInstallerThemeForPreference(installer.options.themePreference).type === 'dark',
    [installer.options.themePreference],
  );
  const { i18n } = useTranslation();

  const { phase, activeSatellite } = useMemo(() => {
    if (installer.step === 'uninstall') {
      if (installer.uninstallCompleted) return { phase: 'farewell' as OrbitPhase, activeSatellite: 0 };
      if (installer.isUninstalling) {
        return {
          phase: 'farewell' as OrbitPhase,
          activeSatellite: Math.max(0, 4 - Math.round(installer.uninstallProgress / 25)),
        };
      }
      return { phase: 'ignited' as OrbitPhase, activeSatellite: 4 };
    }
    return derivePhase(
      installer.step,
      installer.installationCompleted,
      installer.isInstalling,
      installer.error,
      installer.progress,
    );
  }, [
    installer.step,
    installer.installationCompleted,
    installer.isInstalling,
    installer.error,
    installer.progress,
    installer.isUninstalling,
    installer.uninstallCompleted,
    installer.uninstallProgress,
  ]);

  const handleLanguageSelect = (lang: string) => {
    i18n.changeLanguage(lang);
    installer.setOptions((prev) => ({
      ...prev,
      appLanguage: lang === 'en' ? 'en-US' : 'zh-CN',
    }));
    installer.next();
  };

  const renderPage = () => {
    switch (installer.step) {
      case 'lang':
        return <LanguageSelect onSelect={handleLanguageSelect} />;
      case 'options':
        return (
          <Options
            options={installer.options}
            setOptions={installer.setOptions}
            diskSpace={installer.diskSpace}
            error={installer.error}
            refreshDiskSpace={installer.refreshDiskSpace}
            onBack={installer.back}
            onInstall={installer.install}
            isInstalling={installer.isInstalling}
            clearInstallError={installer.clearInstallError}
          />
        );
      case 'model':
        return (
          <ModelSetup
            options={installer.options}
            setOptions={installer.setOptions}
            onSkip={installer.next}
            onBack={installer.back}
            onTestConnection={installer.testModelConnection}
            onNext={async () => {
              await installer.saveModelConfig();
              installer.next();
            }}
          />
        );
      case 'progress':
        return (
          <ProgressPage
            progress={installer.progress}
            error={installer.error}
            canConfirmProgress={installer.canConfirmProgress}
            onConfirmProgress={installer.confirmProgress}
            onFinishAndLaunch={installer.exitAndLaunch}
            onRetry={installer.retryInstall}
            onBackToOptions={installer.backToOptions}
          />
        );
      case 'theme':
        return (
          <ThemeSetup
            options={installer.options}
            setOptions={installer.setOptions}
            onLaunch={installer.launchApp}
            onClose={installer.closeInstaller}
            onBack={installer.back}
          />
        );
      case 'uninstall':
        return (
          <UninstallPage
            installPath={installer.options.installPath}
            isUninstalling={installer.isUninstalling}
            uninstallCompleted={installer.uninstallCompleted}
            uninstallError={installer.uninstallError}
            uninstallProgress={installer.uninstallProgress}
            onUninstall={installer.startUninstall}
            onClose={installer.closeInstaller}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="installer-app">
      {/* Titlebar */}
      <div className="titlebar" data-tauri-drag-region>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, pointerEvents: 'none' }}>
          <SparoMark size={16} dark={chromeDark} />
        </div>
        <WindowControls dark={chromeDark} />
      </div>

      {/* Content — unified single-column layout with orbit stage as ambient background */}
      <div className="installer-content">
        <div className="installer-single">
          {installer.step === 'lang' && (
            <div className="installer-single__stage" aria-hidden>
              <OrbitStage phase={phase} activeSatellite={activeSatellite} dark={false} />
            </div>
          )}
          <div className="installer-single__content">
            {renderPage()}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
