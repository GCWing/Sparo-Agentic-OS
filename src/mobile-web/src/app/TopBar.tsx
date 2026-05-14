import React from 'react';
import { useShellStore } from './shellStore';
import logoMark from '../assets/sparo-logo-mark.png';
import './TopBar.scss';

interface TopBarProps {
  onLogoClick: () => void;
  onTasksClick: () => void;
  onAppsClick: () => void;
}

const BackIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M19 12H5M12 5l-7 7 7 7" />
  </svg>
);

const TasksIcon: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 11l3 3L22 4" />
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </svg>
);

const AppsIcon: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

const FolderIcon: React.FC = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const TopBar: React.FC<TopBarProps> = ({ onLogoClick, onTasksClick, onAppsClick }) => {
  const { activeScene, sessionContext, closeOverlay, openDispatcher } = useShellStore();

  const isDispatcher = activeScene === 'home';
  const isOverlay = ['app:skills', 'app:memory', 'app:shell', 'app:settings', 'me', 'search'].includes(activeScene);
  const showBack = !isDispatcher;

  const handleBack = () => {
    if (isOverlay) {
      closeOverlay();
    } else {
      openDispatcher();
    }
  };

  const workspaceName = sessionContext?.workspaceDisplayName
    ?? (sessionContext?.workspacePath
      ? sessionContext.workspacePath.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? ''
      : '');

  return (
    <div className="sparo-topbar">
      {/* Left: Logo button */}
      <div className="sparo-topbar__left">
        <button
          type="button"
          className="sparo-topbar__logo-btn"
          onClick={onLogoClick}
          aria-label="Open menu"
        >
          <img
            src={logoMark}
            alt="Sparo OS"
            className="sparo-topbar__logo-img"
          />
        </button>
      </div>

      {/* Center: Context capsule */}
      <div className="sparo-topbar__center">
        {showBack && (
          <div className="sparo-topbar__context-capsule">
            <button
              type="button"
              className="sparo-topbar__back-btn"
              onClick={handleBack}
              aria-label="Back"
            >
              <BackIcon />
            </button>
            {sessionContext && (
              <>
                <span className="sparo-topbar__capsule-sep" aria-hidden="true" />
                <div className="sparo-topbar__capsule-title">
                  {sessionContext.mode && (
                    <span className="sparo-topbar__capsule-mode">{sessionContext.mode}</span>
                  )}
                  {sessionContext.mode && workspaceName && (
                    <span className="sparo-topbar__capsule-slash" aria-hidden="true">/</span>
                  )}
                  {workspaceName && (
                    <span className="sparo-topbar__capsule-ws">
                      <FolderIcon />
                      <span>{workspaceName}</span>
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Right: Tasks + Apps */}
      <div className="sparo-topbar__right">
        <button
          type="button"
          className={`sparo-topbar__icon-btn${activeScene === 'tasks' ? ' is-active' : ''}`}
          onClick={onTasksClick}
          aria-label="Tasks"
        >
          <TasksIcon />
        </button>
        <button
          type="button"
          className={`sparo-topbar__icon-btn${activeScene === 'apps' ? ' is-active' : ''}`}
          onClick={onAppsClick}
          aria-label="Apps"
        >
          <AppsIcon />
        </button>
      </div>
    </div>
  );
};

export default TopBar;
