import React, { useCallback, useMemo, useState } from 'react';
import {
  SquareTerminal,
  BookOpen,
  ChevronUp,
  ChevronRight,
  Orbit,
  RotateCcw,
  Brain,
  AppWindow,
  ChevronDown,
  Settings,
  Code2,
  Wrench,
  Bot,
} from 'lucide-react';
import { Badge, Button, IconButton, Panel, PanelBody } from '@/design-system';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';
import { flowChatManager } from '@/flow_chat/services/FlowChatManager';
import { openDispatcherSession } from '@/flow_chat/services/openDispatcherSession';
import { openWorkspaceScene, openWorkspaceSession } from '../../navigation/workspaceNavigation';
import { useWorkspaceSurfaceStore } from '../../navigation/workspaceSurfaceStore';
import { createLogger } from '@/shared/utils/logger';
import './WorkspaceFooterActions.scss';

const log = createLogger('WorkspaceFooterActions');

const GREETING_KEYS = ['greetingMorning', 'greetingAfternoon', 'greetingEvening', 'greetingNight'] as const;

interface FooterActionProps {
  active?: boolean;
  children: React.ReactNode;
  className?: string;
  icon: React.ReactNode;
  onClick: () => void;
  pressed?: boolean;
}

const FooterAction: React.FC<FooterActionProps> = ({
  active = false,
  children,
  className = '',
  icon,
  onClick,
  pressed,
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
    aria-pressed={pressed}
    onClick={onClick}
  >
    {icon}
    <span className="sparo-workspace-footer__action-label">{children}</span>
  </Button>
);

const WorkspaceFooterActions: React.FC = () => {
  const { t } = useI18n('common');
  const activeSurface = useWorkspaceSurfaceStore(s => s.activeSurface);
  const activeSceneId = activeSurface.kind === 'scene' ? activeSurface.sceneId : null;

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

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuClosing, setMenuClosing] = useState(false);
  const [isDevKitSubmenuOpen, setIsDevKitSubmenuOpen] = useState(false);

  const closeMenu = useCallback(() => {
    setMenuClosing(true);
    setIsDevKitSubmenuOpen(false);
    setTimeout(() => {
      setMenuOpen(false);
      setMenuClosing(false);
    }, 150);
  }, []);

  const toggleMenu = useCallback(() => {
    if (menuOpen) {
      closeMenu();
      return;
    }
    setMenuOpen(true);
  }, [closeMenu, menuOpen]);

  const handleOpenShell = useCallback(() => {
    closeMenu();
    openWorkspaceScene('shell');
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
      const sessionId = await flowChatManager.createChatSession({ storageScope: 'agentic_os' }, 'Dispatcher');
      await openWorkspaceSession(sessionId);
    } catch (error) {
      log.error('Failed to create new Dispatcher session', error);
    }
  }, []);

  const handleOpenMemory = useCallback(() => {
    closeMenu();
    openWorkspaceScene('memory');
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

  const isMemoryActive = activeSceneId === 'memory';
  const isAppsActive = activeSceneId === 'apps'
    || (typeof activeSceneId === 'string' && activeSceneId.startsWith('live-app:'));
  const isSkillsActive = activeSceneId === 'skills';
  const isToolsActive = activeSceneId === 'tools';
  const isSubagentsActive = activeSceneId === 'subagents';
  const isSettingsActive = activeSceneId === 'settings';
  const isShellActive = activeSceneId === 'shell';

  return (
    <div className="sparo-workspace-footer">
      <div className="sparo-workspace-footer__left">
        <div className="sparo-workspace-footer__more">
          <IconButton
            className={`sparo-workspace-footer__trigger${menuOpen ? ' is-active' : ''}`}
            size="small"
            variant="ghost"
            tooltip={menuOpen ? undefined : t('nav.moreOptions')}
            tooltipPlacement="right"
            aria-label={t('nav.moreOptions')}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
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
                <PanelBody className="sparo-workspace-footer__panel-body">
                  <div className="sparo-workspace-footer__actions">
                    <FooterAction active={isMemoryActive} icon={<Brain size={14} />} onClick={handleOpenMemory}>
                      {t('nav.items.memory')}
                    </FooterAction>

                    <FooterAction active={isAppsActive} icon={<AppWindow size={14} />} onClick={handleOpenApps}>
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
                    >
                      <Code2 size={14} />
                      <span className="sparo-workspace-footer__action-label">{t('nav.sections.devKit')}</span>
                      <ChevronDown
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
                          onClick={handleOpenSkills}
                        >
                          {t('nav.items.skills')}
                        </FooterAction>

                        <FooterAction
                          active={isToolsActive}
                          className="sparo-workspace-footer__action--sub"
                          icon={<Wrench size={13} />}
                          onClick={handleOpenTools}
                        >
                          {t('nav.items.tools')}
                        </FooterAction>

                        <FooterAction
                          active={isSubagentsActive}
                          className="sparo-workspace-footer__action--sub"
                          icon={<Bot size={13} />}
                          onClick={handleOpenSubagents}
                        >
                          {t('nav.items.subAgent')}
                        </FooterAction>
                      </div>
                    </div>

                    <div className="sparo-workspace-footer__separator" />

                    <FooterAction
                      active={isShellActive}
                      icon={<SquareTerminal size={14} />}
                      pressed={isShellActive}
                      onClick={handleOpenShell}
                    >
                      {t('scenes.shell')}
                    </FooterAction>

                    <div className="sparo-workspace-footer__separator" />

                    <FooterAction
                      active={isSettingsActive}
                      icon={<Settings size={14} />}
                      pressed={isSettingsActive}
                      onClick={handleOpenSettings}
                    >
                      {t('tabs.settings')}
                    </FooterAction>

                    <div className="sparo-workspace-footer__dispatcher">
                      <FooterAction
                        className="sparo-workspace-footer__dispatcher-primary"
                        icon={<Orbit size={14} />}
                        onClick={handleOpenDispatcher}
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
                  </div>

                  <div className="sparo-workspace-footer__splitter" aria-hidden="true" />

                  <aside className="sparo-workspace-footer__greeting">
                    <div className="sparo-workspace-footer__greeting-heading">
                      <p className="sparo-workspace-footer__greeting-title">{greeting}</p>
                      <Badge variant="neutral" className="sparo-workspace-footer__greeting-badge">
                        {t('nav.sessions.systemBadge')}
                      </Badge>
                    </div>
                    <p className="sparo-workspace-footer__greeting-subtitle">{t('nav.menuPanel.subtitle')}</p>

                    <Button
                      type="button"
                      variant="ghost"
                      size="small"
                      className="sparo-workspace-footer__greeting-action"
                      onClick={handleOpenDispatcher}
                    >
                      <span className="sparo-workspace-footer__greeting-action-icon">
                        <Orbit size={15} />
                      </span>
                      <span className="sparo-workspace-footer__greeting-action-body">
                        <span className="sparo-workspace-footer__greeting-action-title">
                          {t('nav.sessions.dispatcherShort')}
                        </span>
                        <span className="sparo-workspace-footer__greeting-action-desc">
                          {t('nav.menuPanel.agenticOSDesc')}
                        </span>
                      </span>
                      <ChevronRight size={12} className="sparo-workspace-footer__greeting-action-arrow" aria-hidden="true" />
                    </Button>
                  </aside>
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
