import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  SquareTerminal,
  BookOpen,
  ChevronUp,
  ChevronRight,
  FolderTree,
  Orbit,
  RotateCcw,
  Brain,
  AppWindow,
  LayoutDashboard,
  Settings,
  Code2,
  Wrench,
} from 'lucide-react';
import { Button, IconButton, Panel, PanelBody, SparoAgentIcon, SparoSubagentIcon } from '@/design-system';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';
import { flowChatManager } from '@/flow_chat/services/FlowChatManager';
import { openDispatcherSession } from '@/flow_chat/services/openDispatcherSession';
import { openWorkspaceScene, openWorkspaceSession } from '../../navigation/workspaceNavigation';
import { useWorkspaceSurfaceStore } from '../../navigation/workspaceSurfaceStore';
import { openWorkCenterHome } from '@/app/agentic-os/work/navigation/openWork';
import { createLogger } from '@/shared/utils/logger';
import { getDispatcherSessionDescriptor } from '@/flow_chat/domain/sessionDescriptor';
import { useMovingHoverHighlight } from '@/shared/hooks/useMovingHoverHighlight';
import './WorkspaceFooterActions.scss';

const log = createLogger('WorkspaceFooterActions');

const GREETING_KEYS = ['greetingMorning', 'greetingAfternoon', 'greetingEvening', 'greetingNight'] as const;

interface FooterActionProps {
  active?: boolean;
  children: React.ReactNode;
  className?: string;
  icon: React.ReactNode;
  movingHoverHandlers?: React.HTMLAttributes<HTMLButtonElement>;
  onClick: () => void;
  testId?: string;
  title?: string;
}

const FooterAction: React.FC<FooterActionProps> = ({
  active = false,
  children,
  className = '',
  icon,
  movingHoverHandlers,
  onClick,
  testId,
  title,
}) => (
  <Button
    type="button"
    variant="ghost"
    size="small"
    className={[
      'sparo-workspace-footer__action',
      active && 'is-active',
      className,
    ].filter(Boolean).join(' ')}
    role="menuitem"
    title={title}
    data-testid={testId}
    onClick={onClick}
    {...movingHoverHandlers}
  >
    {icon}
    <span className="sparo-workspace-footer__action-label">{children}</span>
  </Button>
);

const WorkspaceFooterActions: React.FC = () => {
  const { t } = useI18n('common');
  const activeSurface = useWorkspaceSurfaceStore(s => s.activeSurface);
  const activeSceneId = activeSurface.kind === 'scene' ? activeSurface.sceneId : null;
  const isDispatcherActive = activeSurface.kind === 'dispatcher-home';

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    const key = hour >= 5 && hour < 12
      ? GREETING_KEYS[0]
      : hour >= 12 && hour < 18
        ? GREETING_KEYS[1]
        : hour >= 18 && hour < 22
          ? GREETING_KEYS[2]
          : GREETING_KEYS[3];
    return t(`welcome.${key}`);
  }, [t]);

  const isMemoryActive = activeSceneId === 'memory';
  const isWorkCenterActive = activeSceneId === 'work-center';
  const isAppsActive = activeSceneId === 'apps'
    || (typeof activeSceneId === 'string' && activeSceneId.startsWith('live-app:'));
  const isSkillsActive = activeSceneId === 'skills';
  const isToolsActive = activeSceneId === 'tools';
  const isSubagentsActive = activeSceneId === 'subagents';
  const isSettingsActive = activeSceneId === 'settings';
  const isShellActive = activeSceneId === 'shell';
  const isFileViewerActive = activeSceneId === 'file-viewer';
  const isDevKitChildActive = isSkillsActive || isToolsActive || isSubagentsActive;

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuClosing, setMenuClosing] = useState(false);
  const [isDevKitSubmenuOpen, setIsDevKitSubmenuOpen] = useState(isDevKitChildActive);
  const closeTimerRef = useRef<number | null>(null);
  const menuHover = useMovingHoverHighlight<HTMLDivElement>();

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const closeMenu = useCallback(() => {
    clearCloseTimer();
    setMenuClosing(true);
    setIsDevKitSubmenuOpen(false);
    setTimeout(() => {
      setMenuOpen(false);
      setMenuClosing(false);
    }, 150);
  }, [clearCloseTimer]);

  const openMenu = useCallback(() => {
    clearCloseTimer();
    setIsDevKitSubmenuOpen(isDevKitChildActive);
    setMenuOpen(true);
  }, [clearCloseTimer, isDevKitChildActive]);

  const scheduleCloseMenu = useCallback(() => {
    if (!menuOpen) return;
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      closeMenu();
    }, 320);
  }, [clearCloseTimer, closeMenu, menuOpen]);

  useEffect(() => clearCloseTimer, [clearCloseTimer]);

  const toggleMenu = useCallback(() => {
    if (menuOpen) {
      closeMenu();
      return;
    }
    openMenu();
  }, [closeMenu, menuOpen, openMenu]);

  const handleOpenShell = useCallback(() => {
    closeMenu();
    openWorkspaceScene('shell');
  }, [closeMenu]);

  const handleOpenFiles = useCallback(() => {
    closeMenu();
    openWorkspaceScene('file-viewer');
  }, [closeMenu]);

  const handleOpenDispatcher = useCallback(async () => {
    closeMenu();
    try {
      await openDispatcherSession();
    } catch (error) {
      log.error('Failed to open Dispatcher', error);
    }
  }, [closeMenu]);

  const handleCreateDispatcherSession = useCallback(async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    try {
      const sessionId = await flowChatManager.createChatSession(
        { storageScope: 'agentic_os' },
        getDispatcherSessionDescriptor()
      );
      await openWorkspaceSession(sessionId);
      closeMenu();
    } catch (error) {
      log.error('Failed to create new Dispatcher session', error);
    }
  }, [closeMenu]);

  const handleOpenMemory = useCallback(() => {
    closeMenu();
    openWorkspaceScene('memory');
  }, [closeMenu]);

  const handleOpenWorkCenter = useCallback(() => {
    closeMenu();
    openWorkCenterHome();
  }, [closeMenu]);

  const handleOpenApps = useCallback(() => {
    closeMenu();
    openWorkspaceScene('apps');
  }, [closeMenu]);

  const handleOpenSkills = useCallback(() => {
    closeMenu();
    openWorkspaceScene('skills');
  }, [closeMenu]);

  const handleOpenTools = useCallback(() => {
    closeMenu();
    openWorkspaceScene('tools');
  }, [closeMenu]);

  const handleOpenSubagents = useCallback(() => {
    closeMenu();
    openWorkspaceScene('subagents');
  }, [closeMenu]);

  const handleOpenSettings = useCallback(() => {
    closeMenu();
    openWorkspaceScene('settings');
  }, [closeMenu]);

  const agenticOsTitle = `${t('nav.sessions.dispatcherShort')} — ${t('nav.menuPanel.agenticOSDesc')}`;

  return (
    <div className="sparo-workspace-footer">
      <div className="sparo-workspace-footer__left">
        <div
          className="sparo-workspace-footer__more"
          onMouseEnter={clearCloseTimer}
          onMouseLeave={scheduleCloseMenu}
          onFocus={clearCloseTimer}
        >
          <IconButton
            className={`sparo-workspace-footer__trigger${menuOpen ? ' is-active' : ''}`}
            size="small"
            variant="ghost"
            tooltip={menuOpen ? undefined : t('nav.moreOptions')}
            tooltipPlacement="right"
            aria-label={t('nav.moreOptions')}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            data-testid="workspace-footer-more-button"
            onClick={toggleMenu}
          >
            {menuOpen ? (
              <ChevronUp size={15} aria-hidden="true" />
            ) : (
              <span className="sparo-workspace-footer__trigger-icon-swap" aria-hidden="true">
                <Orbit size={14} className="sparo-workspace-footer__trigger-icon-default" />
                <ChevronUp size={15} className="sparo-workspace-footer__trigger-icon-hover" />
              </span>
            )}
          </IconButton>

          {menuOpen && (
            <>
              <div
                className="sparo-workspace-footer__backdrop"
                onClick={closeMenu}
              />
              <Panel
                variant="elevated"
                className={`sparo-workspace-footer__panel${menuClosing ? ' is-closing' : ''}`}
                role="menu"
              >
                <PanelBody
                  className="sparo-workspace-footer__panel-body"
                  ref={menuHover.setSurfaceElement}
                  {...menuHover.getSurfaceHandlers('.sparo-workspace-footer__dispatcher, .sparo-workspace-footer__action')}
                >
                  <span
                    className={`sparo-workspace-footer__moving-hover ${menuHover.highlight.visible ? 'sparo-workspace-footer__moving-hover--visible' : ''}`}
                    style={{
                      '--sparo-footer-hover-top': `${menuHover.highlight.top}px`,
                      '--sparo-footer-hover-left': `${menuHover.highlight.left}px`,
                      '--sparo-footer-hover-width': `${menuHover.highlight.width}px`,
                      '--sparo-footer-hover-height': `${menuHover.highlight.height}px`,
                      '--sparo-footer-hover-stretch-x': menuHover.highlight.stretchX,
                      '--sparo-footer-hover-stretch-y': menuHover.highlight.stretchY,
                    } as React.CSSProperties}
                    aria-hidden="true"
                  />
                  <p className="sparo-workspace-footer__menu-greeting">{greeting}</p>

                  <nav className="sparo-workspace-footer__menu" aria-label={t('nav.aria.mainNav')}>
                    <div
                      className="sparo-workspace-footer__dispatcher"
                      {...menuHover.getItemHandlers()}
                    >
                      <FooterAction
                        active={isDispatcherActive}
                        className="sparo-workspace-footer__dispatcher-primary"
                        icon={<SparoAgentIcon size={14} />}
                        title={agenticOsTitle}
                        onClick={() => { void handleOpenDispatcher(); }}
                      >
                        {t('nav.sessions.dispatcherShort')}
                      </FooterAction>
                      <IconButton
                        className="sparo-workspace-footer__dispatcher-new"
                        size="xs"
                        variant="ghost"
                        tooltip={t('nav.tooltips.newDispatcherSession')}
                        tooltipPlacement="right"
                        onClick={handleCreateDispatcherSession}
                        aria-label={t('nav.tooltips.newDispatcherSession')}
                      >
                        <RotateCcw size={12} />
                      </IconButton>
                    </div>

                    <FooterAction
                      active={isWorkCenterActive}
                      icon={<LayoutDashboard size={14} />}
                      movingHoverHandlers={menuHover.getItemHandlers()}
                      onClick={handleOpenWorkCenter}
                    >
                      {t('scenes.workCenter')}
                    </FooterAction>

                    <div className="sparo-workspace-footer__separator" />

                    <FooterAction
                      active={isMemoryActive}
                      icon={<Brain size={14} />}
                      movingHoverHandlers={menuHover.getItemHandlers()}
                      onClick={handleOpenMemory}
                    >
                      {t('nav.items.memory')}
                    </FooterAction>

                    <FooterAction
                      active={isAppsActive}
                      icon={<AppWindow size={14} />}
                      movingHoverHandlers={menuHover.getItemHandlers()}
                      onClick={handleOpenApps}
                    >
                      {t('nav.sections.agentApp')}
                    </FooterAction>

                    <Button
                      type="button"
                      variant="ghost"
                      size="small"
                      className={`sparo-workspace-footer__action sparo-workspace-footer__action--expandable${isDevKitSubmenuOpen ? ' is-open' : ''}`}
                      role="menuitem"
                      aria-expanded={isDevKitSubmenuOpen}
                      onClick={() => setIsDevKitSubmenuOpen(value => !value)}
                      {...menuHover.getItemHandlers()}
                    >
                      <Code2 size={14} />
                      <span className="sparo-workspace-footer__action-label">{t('nav.sections.devKit')}</span>
                      <ChevronRight
                        size={13}
                        className="sparo-workspace-footer__action-chevron"
                        aria-hidden="true"
                      />
                    </Button>

                    <div className={`sparo-workspace-footer__subactions${isDevKitSubmenuOpen ? ' is-open' : ''}`}>
                      <div>
                        <FooterAction
                          active={isSkillsActive}
                          className="sparo-workspace-footer__action--sub"
                          icon={<BookOpen size={13} />}
                          movingHoverHandlers={menuHover.getItemHandlers()}
                          onClick={handleOpenSkills}
                        >
                          {t('nav.items.skills')}
                        </FooterAction>

                        <FooterAction
                          active={isToolsActive}
                          className="sparo-workspace-footer__action--sub"
                          icon={<Wrench size={13} />}
                          movingHoverHandlers={menuHover.getItemHandlers()}
                          onClick={handleOpenTools}
                        >
                          {t('nav.items.tools')}
                        </FooterAction>

                        <FooterAction
                          active={isSubagentsActive}
                          className="sparo-workspace-footer__action--sub"
                          icon={<SparoSubagentIcon size={13} />}
                          movingHoverHandlers={menuHover.getItemHandlers()}
                          onClick={handleOpenSubagents}
                        >
                          {t('nav.items.subAgent')}
                        </FooterAction>
                      </div>
                    </div>

                    <div className="sparo-workspace-footer__separator" />

                    <FooterAction
                      active={isFileViewerActive}
                      icon={<FolderTree size={14} />}
                      movingHoverHandlers={menuHover.getItemHandlers()}
                      testId="workspace-footer-files-button"
                      onClick={handleOpenFiles}
                    >
                      {t('scenes.fileViewer')}
                    </FooterAction>

                    <FooterAction
                      active={isShellActive}
                      icon={<SquareTerminal size={14} />}
                      movingHoverHandlers={menuHover.getItemHandlers()}
                      onClick={handleOpenShell}
                    >
                      {t('scenes.shell')}
                    </FooterAction>

                    <FooterAction
                      active={isSettingsActive}
                      icon={<Settings size={14} />}
                      movingHoverHandlers={menuHover.getItemHandlers()}
                      testId="workspace-footer-settings-button"
                      onClick={handleOpenSettings}
                    >
                      {t('tabs.settings')}
                    </FooterAction>
                  </nav>
                </PanelBody>
              </Panel>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default WorkspaceFooterActions;
