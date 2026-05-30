import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { RelayHttpClient } from '../services/RelayHttpClient';
import { RemoteSessionManager } from '../services/RemoteSessionManager';
import { useTheme } from '../theme';
import PairingPage from '../pages/PairingPage';
import DispatcherHomeScene from '../pages/DispatcherHomeScene';
import TasksScene from '../pages/TasksScene';
import AppsScene from '../pages/AppsScene';
import SkillsAppPage from '../pages/apps/SkillsAppPage';
import SettingsAppPage from '../pages/apps/SettingsAppPage';
import MePage from '../pages/MePage';
import SearchDialog from '../pages/SearchDialog';
import ChatPage from '../pages/ChatPage';
import TopBar from './TopBar';
import BottomSheet from '../components/BottomSheet';
import { useShellStore, type SceneId } from './shellStore';
import type { SessionContext } from './shellStore';
import './AppShell.scss';

const NAV_DURATION = 240;

function LogoMenuItem({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={`logo-menu-item${danger ? ' logo-menu-item--danger' : ''}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function LogoMenuDivider() {
  return <div className="logo-menu-divider" aria-hidden="true" />;
}

const AppShell: React.FC = () => {
  const { t, language, setLanguage } = useI18n();
  const { isDark, toggleTheme } = useTheme();

  const clientRef = useRef<RelayHttpClient | null>(null);
  const sessionMgrRef = useRef<RemoteSessionManager | null>(null);
  const [paired, setPaired] = useState(false);

  const { activeScene, pageStack, push, closeOverlay, openDispatcher, openChat, setSessionContext } = useShellStore();

  const [logoMenuOpen, setLogoMenuOpen] = useState(false);

  // Animate scene transitions
  const [displayScene, setDisplayScene] = useState<SceneId>(activeScene);
  const [animating, setAnimating] = useState(false);
  const [prevScene, setPrevScene] = useState<SceneId | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (activeScene === displayScene) return;
    setPrevScene(displayScene);
    setAnimating(true);
    setDisplayScene(activeScene);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setPrevScene(null);
      setAnimating(false);
    }, NAV_DURATION);
  }, [activeScene, displayScene]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  // Popstate back handling
  useEffect(() => {
    const onPop = () => {
      const { activeScene: cur, pageStack: stack } = useShellStore.getState();
      if (stack.length <= 1) {
        history.pushState({ scene: cur }, '');
        return;
      }
      const overlays = ['app:skills', 'app:memory', 'app:shell', 'app:settings', 'me', 'search'];
      if (overlays.includes(cur)) {
        useShellStore.getState().closeOverlay();
      } else {
        const prev = stack[stack.length - 2];
        useShellStore.setState((s) => ({
          activeScene: prev as SceneId,
          pageStack: s.pageStack.slice(0, -1),
        }));
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const handlePaired = useCallback(
    (client: RelayHttpClient, sessionMgr: RemoteSessionManager) => {
      clientRef.current = client;
      sessionMgrRef.current = sessionMgr;
      setPaired(true);
      history.pushState({ scene: 'home' }, '');
    },
    [],
  );

  const handleSelectSession = useCallback((sessionId: string, sessionName?: string, sessionMode?: string) => {
    const ctx: SessionContext = {
      // sessionMode carries the raw agent_type string (e.g. 'agentic', 'Design', 'Dispatcher')
      mode: sessionMode ?? 'Session',
      agentType: sessionMode,
      sessionId,
      sessionName: sessionName ?? '',
    };
    openChat(ctx);
  }, [openChat]);

  const handleBackFromChat = useCallback(() => {
    const { pageStack: stack } = useShellStore.getState();
    const prev = stack.length > 1 ? stack[stack.length - 2] : 'home';
    useShellStore.setState((s) => ({
      activeScene: prev as SceneId,
      pageStack: s.pageStack.slice(0, -1),
      sessionContext: null,
    }));
    history.back();
  }, []);

    const handleLogoMenu = useCallback((action: string) => {
    setLogoMenuOpen(false);
    if (action === 'home') openDispatcher();
    else if (action === 'tasks') push('tasks');
    else if (action === 'search') push('search');
    else if (action === 'me') push('me');
    else if (action === 'theme') toggleTheme();
    else if (action === 'lang-en') setLanguage('en-US' as const);
    else if (action === 'lang-zh') setLanguage('zh-CN' as const);
    else if (action === 'signout') {
      localStorage.removeItem('sparo.mobile.user_id');
      localStorage.removeItem('sparo.mobile.install_id');
      localStorage.removeItem('sparo.mobile.user_id_lock_until');
      localStorage.removeItem('sparo.mobile.user_id_failure_count');
      clientRef.current = null;
      sessionMgrRef.current = null;
      setPaired(false);
      openDispatcher();
    }
  }, [openDispatcher, push, toggleTheme, setLanguage]);

  if (!paired) {
    return <PairingPage onPaired={handlePaired} />;
  }

  const mgr = sessionMgrRef.current!;

  const renderScene = (scene: SceneId) => {
    switch (scene) {
      case 'home':
        return (
          <DispatcherHomeScene
            sessionMgr={mgr}
            onSelectSession={handleSelectSession}
          />
        );
      case 'tasks':
        return (
          <TasksScene
            sessionMgr={mgr}
            onSelectSession={handleSelectSession}
          />
        );
      case 'apps':
        return <AppsScene />;
      case 'app:skills':
        return <SkillsAppPage sessionMgr={mgr} />;
      case 'app:memory':
      case 'app:shell':
        return null;
      case 'app:settings':
        return <SettingsAppPage />;
      case 'me':
        return <MePage sessionMgr={mgr} onSignOut={() => handleLogoMenu('signout')} />;
      case 'search':
        return <SearchDialog sessionMgr={mgr} onSelectSession={handleSelectSession} />;
      case 'chat': {
        const { sessionContext } = useShellStore.getState();
        if (!sessionContext?.sessionId) return null;
        return (
          <ChatPage
            sessionMgr={mgr}
            sessionId={sessionContext.sessionId}
            sessionName={sessionContext.sessionName ?? ''}
            agentType={sessionContext.agentType}
            onBack={handleBackFromChat}
            embedded
          />
        );
      }
      default:
        return null;
    }
  };

  return (
    <div className="sparo-shell">
      <TopBar
        onLogoClick={() => setLogoMenuOpen(true)}
        onTasksClick={() => {
          if (activeScene === 'tasks') return;
          push('tasks');
        }}
        onAppsClick={() => {
          if (activeScene === 'apps') return;
          push('apps');
        }}
      />

      <div className="sparo-shell__body">
        {animating && prevScene && prevScene !== displayScene && (
          <div className="nav-page nav-push-exit" key={`prev-${prevScene}`}>
            {renderScene(prevScene)}
          </div>
        )}
        <div className={`nav-page${animating ? ' nav-push-enter' : ''}`} key={displayScene}>
          {renderScene(displayScene)}
        </div>
      </div>

      <BottomSheet open={logoMenuOpen} onClose={() => setLogoMenuOpen(false)}>
        <LogoMenuItem label={t('topbar.openMenu')} onClick={() => setLogoMenuOpen(false)} />
        <LogoMenuDivider />
        <LogoMenuItem label={language === 'zh-CN' ? 'English' : '中文'} onClick={() => handleLogoMenu(language === 'zh-CN' ? 'lang-en' : 'lang-zh')} />
        <LogoMenuItem label={isDark ? t('me.light') : t('me.dark')} onClick={() => handleLogoMenu('theme')} />
        <LogoMenuDivider />
        <LogoMenuItem label={t('me.signOut')} onClick={() => handleLogoMenu('signout')} danger />
      </BottomSheet>
    </div>
  );
};

export default AppShell;
