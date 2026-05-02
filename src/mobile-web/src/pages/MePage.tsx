import React, { useState } from 'react';
import { useI18n } from '../i18n';
import { useTheme } from '../theme';
import { useMobileStore } from '../services/store';
import { RemoteSessionManager } from '../services/RemoteSessionManager';
import EyebrowLabel from '../components/EyebrowLabel';
import HairlineDivider from '../components/HairlineDivider';
import IgnitionDot from '../components/IgnitionDot';
import BottomSheet from '../components/BottomSheet';
import WorkspacePicker from './components/WorkspacePicker';
import './MePage.scss';

interface MePageProps {
  sessionMgr: RemoteSessionManager;
  onSignOut: () => void;
}

const ChevronIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m9 18 6-6-6-6" />
  </svg>
);

const CopyIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const GitBranchIcon: React.FC = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="6" x2="6" y1="3" y2="15" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </svg>
);

const MePage: React.FC<MePageProps> = ({ sessionMgr, onSignOut }) => {
  const { t, language, setLanguage } = useI18n();
  const { isDark, toggleTheme } = useTheme();
  const { currentWorkspace, authenticatedUserId } = useMobileStore();
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyPath = () => {
    if (!currentWorkspace?.path) return;
    navigator.clipboard?.writeText(currentWorkspace.path).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  const handleSignOut = () => {
    setSignOutOpen(false);
    onSignOut();
  };

  const workspaceName = currentWorkspace?.project_name ?? currentWorkspace?.path?.split(/[\\/]/).pop() ?? '';

  return (
    <div className="me-page">
      {/* Workspace section */}
      <div className="me-page__section-head">
        <EyebrowLabel>{t('me.workspace')}</EyebrowLabel>
      </div>
      <HairlineDivider />

      {currentWorkspace?.path ? (
        <>
          <div className="me-page__ws-card">
            <div className="me-page__ws-name">{workspaceName}</div>
            <div className="me-page__ws-path-row">
              <span className="me-page__ws-path">{currentWorkspace.path}</span>
              <button
                type="button"
                className="me-page__ws-copy"
                onClick={handleCopyPath}
                aria-label={t('me.copyPath')}
              >
                {copied ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                ) : (
                  <CopyIcon />
                )}
              </button>
            </div>
            {currentWorkspace.git_branch && (
              <div className="me-page__ws-branch">
                <GitBranchIcon />
                <span>{currentWorkspace.git_branch}</span>
                {/* Changes indicator — static for now, no remote API for git status */}
                <IgnitionDot size="sm" />
              </div>
            )}
          </div>
          <HairlineDivider />
          <button
            type="button"
            className="me-page__row me-page__row--btn"
            onClick={() => setWorkspacePickerOpen(true)}
          >
            <span className="me-page__row-label">{t('me.switchWorkspace')}</span>
            <ChevronIcon />
          </button>
          <HairlineDivider />
        </>
      ) : (
        <>
          <button
            type="button"
            className="me-page__row me-page__row--btn"
            onClick={() => setWorkspacePickerOpen(true)}
          >
            <span className="me-page__row-label">{t('workspace.selectWorkspace')}</span>
            <ChevronIcon />
          </button>
          <HairlineDivider />
        </>
      )}

      {/* Preferences */}
      <div className="me-page__section-head me-page__section-head--mt">
        <EyebrowLabel>{t('me.preferences')}</EyebrowLabel>
      </div>
      <HairlineDivider />

      <button type="button" className="me-page__row me-page__row--btn" onClick={toggleTheme}>
        <span className="me-page__row-label">{t('me.appearance')}</span>
        <span className="me-page__row-value">{isDark ? t('me.dark') : t('me.light')}</span>
        <ChevronIcon />
      </button>
      <HairlineDivider />

      <button
        type="button"
        className="me-page__row me-page__row--btn"
        onClick={() => setLanguage(language === 'zh-CN' ? 'en-US' : 'zh-CN')}
      >
        <span className="me-page__row-label">{t('me.language')}</span>
        <span className="me-page__row-value">{language === 'zh-CN' ? '中文' : 'English'}</span>
        <ChevronIcon />
      </button>
      <HairlineDivider />

      {/* Account */}
      <div className="me-page__section-head me-page__section-head--mt">
        <EyebrowLabel>{t('me.account')}</EyebrowLabel>
      </div>
      <HairlineDivider />

      <div className="me-page__row">
        <span className="me-page__row-label">{t('me.userId')}</span>
        <span className="me-page__row-value me-page__row-value--mono">{authenticatedUserId ?? '—'}</span>
      </div>
      <HairlineDivider />

      <button
        type="button"
        className="me-page__row me-page__row--btn me-page__row--danger"
        onClick={() => setSignOutOpen(true)}
      >
        <span className="me-page__row-label">{t('me.signOut')}</span>
      </button>
      <HairlineDivider />

      {/* Workspace Picker Sheet */}
      <BottomSheet
        open={workspacePickerOpen}
        onClose={() => setWorkspacePickerOpen(false)}
        title={t('workspace.selectWorkspace')}
      >
        <WorkspacePicker
          sessionMgr={sessionMgr}
          onDone={() => setWorkspacePickerOpen(false)}
        />
      </BottomSheet>

      {/* Sign Out Confirmation (dark CTA style, VI §12.10) */}
      <BottomSheet
        open={signOutOpen}
        onClose={() => setSignOutOpen(false)}
      >
        <div className="me-page__signout-panel">
          <div className="me-page__signout-title">{t('me.signOutConfirm')}</div>
          <div className="me-page__signout-desc">{t('me.signOutDesc')}</div>
          <button
            type="button"
            className="me-page__signout-btn me-page__signout-btn--confirm"
            onClick={handleSignOut}
          >
            <span className="me-page__signout-btn-dot" aria-hidden="true" />
            {t('me.signOut')}
          </button>
          <button
            type="button"
            className="me-page__signout-btn me-page__signout-btn--cancel"
            onClick={() => setSignOutOpen(false)}
          >
            {t('common.cancel')}
          </button>
        </div>
      </BottomSheet>
    </div>
  );
};

export default MePage;
