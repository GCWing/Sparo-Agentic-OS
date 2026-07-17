import { WindowControls } from './components/WindowControls';
import { OrbitStage, SparoMark } from './components/brand';
import { LanguageSelect } from './pages/LanguageSelect';
import { Options } from './pages/Options';
import { ProgressPage } from './pages/Progress';
import { UninstallPage } from './pages/Uninstall';
import { useInstaller } from './hooks/useInstaller';
import './styles/global.css';

function App() {
  const installer = useInstaller();

  const renderPage = () => {
    switch (installer.step) {
      case 'lang':
        return <LanguageSelect onContinue={installer.next} />;
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
      case 'progress':
        return (
          <ProgressPage
            progress={installer.progress}
            error={installer.error}
            onFinishAndLaunch={installer.exitAndLaunch}
            onRetry={installer.retryInstall}
            onBackToOptions={installer.backToOptions}
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
          <SparoMark size={16} />
        </div>
        <WindowControls />
      </div>

      {/* Content — unified single-column layout with orbit stage as ambient background */}
      <div className="installer-content">
        <div className="installer-single">
          {installer.step === 'lang' && (
            <div className="installer-single__stage" aria-hidden>
              <OrbitStage />
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
