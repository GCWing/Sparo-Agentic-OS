/**
 * WelcomeScene — landing page shown on app start inside SceneViewport.
 *
 * Two modes:
 *  - Has workspace: welcome header + new-session shortcuts + workspace switching.
 *  - No workspace: branding + open/create project.
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  FolderOpen, Clock, FolderPlus, Trash2,
} from 'lucide-react';
import { useWorkspaceContext } from '@/infrastructure/contexts/WorkspaceContext';
import { openWorkspaceHome } from '@/app/navigation/workspaceNavigation';
import { useI18n } from '@/infrastructure/i18n';
import { Button, Tooltip } from '@/design-system';
import { useMovingHoverHighlight } from '@/shared/hooks/useMovingHoverHighlight';
import { createLogger } from '@/shared/utils/logger';
import type { WorkspaceInfo } from '@/shared/types';
import { getRecentWorkspaceLineParts } from '@/shared/utils/recentWorkspaceDisplay';
import './WelcomeScene.scss';

const log = createLogger('WelcomeScene');

const WelcomeScene: React.FC = () => {
  const { t } = useI18n('common');
  const { t: tWelcome } = useI18n('scenes/welcome');
  const {
    hasWorkspace, lastUsedWorkspace, recentWorkspaces,
    openWorkspace, switchWorkspace, removeWorkspaceFromRecent,
  } = useWorkspaceContext();
  const [isSelecting, setIsSelecting] = useState(false);
  const recentHover = useMovingHoverHighlight<HTMLDivElement>();
  const [welcomeMessageIndex] = useState(
    () => Math.floor(Math.random() * 4),
  );
  const welcomeMessages = useMemo(
    () => [
      tWelcome('messages.message1'),
      tWelcome('messages.message2'),
      tWelcome('messages.message3'),
      tWelcome('messages.message4'),
    ],
    [tWelcome],
  );
  const welcomeMessage = welcomeMessages[welcomeMessageIndex % welcomeMessages.length];

  const displayRecentWorkspaces = useMemo(
    () => (hasWorkspace
      ? recentWorkspaces.filter(ws => ws.id !== lastUsedWorkspace?.id)
      : recentWorkspaces
    ).slice(0, 5),
    [hasWorkspace, recentWorkspaces, lastUsedWorkspace?.id],
  );

  const handleOpenFolder = useCallback(async () => {
    try {
      setIsSelecting(true);
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        multiple: false,
        title: t('startup.selectWorkspaceDirectory'),
      });
      if (selected && typeof selected === 'string') {
        await openWorkspace(selected);
        void openWorkspaceHome();
      }
    } catch (e) {
      log.error('Failed to open folder', e);
    } finally {
      setIsSelecting(false);
    }
  }, [openWorkspace, t]);

  const handleNewProject = useCallback(() => {
    window.dispatchEvent(new Event('nav:new-project'));
  }, []);

  const handleSwitchWorkspace = useCallback(async (workspace: WorkspaceInfo) => {
    try {
      await switchWorkspace(workspace);
      void openWorkspaceHome();
    } catch (e) {
      log.error('Failed to switch workspace', e);
    }
  }, [switchWorkspace]);

  const handleRemoveFromRecent = useCallback(async (workspaceId: string) => {
    try {
      await removeWorkspaceFromRecent(workspaceId);
    } catch (e) {
      log.error('Failed to remove workspace from recent', e);
    }
  }, [removeWorkspaceFromRecent]);

  const formatDate = useCallback((dateString: string) => {
    try {
      const date = new Date(dateString);
      const now = new Date();
      const diffMs = Math.abs(now.getTime() - date.getTime());
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays <= 1) return t('time.yesterday');
      if (diffDays < 7) return t('startup.daysAgo', { count: diffDays });
      if (diffDays < 30) return t('startup.weeksAgo', { count: Math.ceil(diffDays / 7) });
      return date.toLocaleDateString();
    } catch {
      return '';
    }
  }, [t]);

  return (
    <div className="welcome-scene">
      <div className="welcome-scene__content">
        <div className="welcome-scene__greeting">
          <h1 className="welcome-scene__title">{tWelcome('firstTime.title')}</h1>
          <p className="welcome-scene__greeting-label">{welcomeMessage}</p>
        </div>

        <div className="welcome-scene__divider" />

        <section className="welcome-scene__switch">
          <div className="welcome-scene__switch-header">
            <span className="welcome-scene__section-label">
              <Clock size={12} />
              {tWelcome('recentWorkspaces')}
            </span>
            <div className="welcome-scene__switch-actions">
              <Button
                className="welcome-scene__action"
                variant="ghost"
                size="small"
                onClick={() => void handleOpenFolder()}
                disabled={isSelecting}
              >
                <FolderOpen size={12} />
                {tWelcome('openOtherProject')}
              </Button>
              <Button
                className="welcome-scene__action"
                variant="ghost"
                size="small"
                onClick={handleNewProject}
              >
                <FolderPlus size={12} />
                {tWelcome('newProject')}
              </Button>
            </div>
          </div>

          {displayRecentWorkspaces.length > 0 ? (
            <div
              ref={recentHover.surfaceRef}
              className="welcome-scene__recent-list welcome-scene__recent-list--motion"
              {...recentHover.getSurfaceHandlers('.welcome-scene__recent-row')}
            >
              <div
                className="welcome-scene__recent-hover-highlight"
                style={{
                  transform: `translate3d(${recentHover.highlight.left}px, ${recentHover.highlight.top}px, 0) scale(${recentHover.highlight.stretchX}, ${recentHover.highlight.stretchY})`,
                  width: `${recentHover.highlight.width}px`,
                  height: `${recentHover.highlight.height}px`,
                  opacity: recentHover.highlight.visible ? 1 : 0,
                }}
              />
              {displayRecentWorkspaces.map(ws => {
                const { hostPrefix, folderLabel, tooltip } = getRecentWorkspaceLineParts(ws);
                return (
                <div key={ws.id} className="welcome-scene__recent-row">
                  <Tooltip content={tooltip} placement="right" followCursor>
                    <Button
                      className="welcome-scene__recent-item"
                      variant="ghost"
                      size="small"
                      onClick={() => { void handleSwitchWorkspace(ws); }}
                    >
                      <FolderOpen size={13} />
                      <span className="welcome-scene__recent-name">
                        {hostPrefix ? (
                          <>
                            <span className="welcome-scene__recent-host">{hostPrefix}</span>
                            <span className="welcome-scene__recent-host-sep" aria-hidden>
                              {' · '}
                            </span>
                          </>
                        ) : null}
                        {folderLabel}
                      </span>
                    </Button>
                  </Tooltip>
                  <Button
                    className="welcome-scene__recent-remove"
                    variant="ghost"
                    size="small"
                    title={tWelcome('removeFromRecent')}
                    aria-label={tWelcome('removeFromRecent')}
                    onClick={() => { void handleRemoveFromRecent(ws.id); }}
                  >
                    <span className="welcome-scene__recent-remove-label">
                      {formatDate(ws.lastAccessed)}
                    </span>
                    <span className="welcome-scene__recent-remove-icon" aria-hidden>
                      <Trash2 size={15} strokeWidth={2} />
                    </span>
                  </Button>
                </div>
                );
              })}
            </div>
          ) : (
            <p className="welcome-scene__no-recent">{tWelcome('noRecentWorkspaces')}</p>
          )}
        </section>

      </div>
    </div>
  );
};

export default WelcomeScene;
