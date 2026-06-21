/**
 * Welcome panel shown in the empty chat state.
 * Layout mirrors WelcomeScene: centered container, left-aligned content.
 */

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FolderOpen,
  ChevronDown,
  Check,
  Orbit,
  AppWindow,
  Palette,
  Bug,
  Gauge,
  BookOpen,
  Layers,
  type LucideIcon,
} from 'lucide-react';
import { LiveAppGlyph } from '@/app/scenes/apps/live-app/liveAppIcons';
import { createLogger } from '@/shared/utils/logger';
import { useWorkspaceContext } from '@/infrastructure/contexts/WorkspaceContext';
import type { WorkspaceInfo } from '@/shared/types';
import { resolveSessionTypeDefinition, useSessionProfile } from '@/app/session-profiles';
import { Button, SparoAgentIcon } from '@/design-system';
import CoworkExampleCards from './CoworkExampleCards';
import './WelcomePanel.css';

const log = createLogger('WelcomePanel');

type LiveAppPromptId = 'starter' | 'dashboard' | 'polish' | 'debug';

interface LiveAppPrompt {
  id: LiveAppPromptId;
  icon: LucideIcon;
}

const LIVE_APP_PROMPTS: LiveAppPrompt[] = [
  { id: 'starter', icon: AppWindow },
  { id: 'dashboard', icon: Gauge },
  { id: 'polish', icon: Palette },
  { id: 'debug', icon: Bug },
];

type AgentAppPromptId = 'starter' | 'tools' | 'examples' | 'iterate';

interface AgentAppPrompt {
  id: AgentAppPromptId;
  icon: LucideIcon;
}

const AGENT_APP_PROMPTS: AgentAppPrompt[] = [
  { id: 'starter', icon: AppWindow },
  { id: 'tools', icon: Layers },
  { id: 'examples', icon: BookOpen },
  { id: 'iterate', icon: Bug },
];

interface WelcomePanelProps {
  onQuickAction?: (command: string) => void;
  className?: string;
  workspacePath?: string;
}

export const WelcomePanel: React.FC<WelcomePanelProps> = ({
  onQuickAction,
  className = '',
}) => {
  const { t } = useTranslation('flow-chat');
  const [workspaceDropdownOpen, setWorkspaceDropdownOpen] = useState(false);
  const [isSelectingWorkspace, setIsSelectingWorkspace] = useState(false);
  const workspaceDropdownRef = useRef<HTMLDivElement>(null);
  const { profile } = useSessionProfile();

  const {
    hasWorkspace,
    lastUsedWorkspace,
    openedWorkspacesList,
    openWorkspace,
    switchWorkspace,
  } = useWorkspaceContext();

  const sessionType = useMemo(() => resolveSessionTypeDefinition(profile.id), [profile.id]);
  const welcome = sessionType.welcome;

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    const s = welcome.keySuffix;
    if (hour >= 5 && hour < 12) return { title: t('welcome.greetingMorning'), subtitle: t(`welcome.subtitleMorning${s}`) };
    if (hour >= 12 && hour < 18) return { title: t('welcome.greetingAfternoon'), subtitle: t(`welcome.subtitleAfternoon${s}`) };
    if (hour >= 18 && hour < 23) return { title: t('welcome.greetingEvening'), subtitle: t(`welcome.subtitleEvening${s}`) };
    return { title: t('welcome.greetingNight'), subtitle: t(`welcome.subtitleNight${s}`) };
  }, [t, welcome.keySuffix]);

  const tagline = greeting.subtitle;
  const aiPartnerKey = welcome.aiPartnerKey;

  const otherWorkspaces = useMemo(
    () => openedWorkspacesList.filter(ws => ws.id !== lastUsedWorkspace?.id),
    [openedWorkspacesList, lastUsedWorkspace?.id],
  );

  useEffect(() => {
    if (!workspaceDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (workspaceDropdownRef.current && !workspaceDropdownRef.current.contains(e.target as Node)) {
        setWorkspaceDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [workspaceDropdownOpen]);

  const handleSwitchWorkspace = useCallback(async (ws: WorkspaceInfo) => {
    try { setWorkspaceDropdownOpen(false); await switchWorkspace(ws); }
    catch (err) { log.warn('Failed to switch workspace', err); }
  }, [switchWorkspace]);

  const handleOpenOtherFolder = useCallback(async () => {
    try {
      setWorkspaceDropdownOpen(false);
      setIsSelectingWorkspace(true);
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ directory: true, multiple: false });
      if (selected && typeof selected === 'string') await openWorkspace(selected);
    } catch (err) {
      log.warn('Failed to open workspace folder', err);
    } finally {
      setIsSelectingWorkspace(false);
    }
  }, [openWorkspace]);

  const handleQuickActionClick = useCallback((cmd: string) => {
    onQuickAction?.(cmd);
  }, [onQuickAction]);

  return (
    <div className={`welcome-panel ${className}`}>
      <div className="welcome-panel__content">
        {/* Greeting */}
        <div className="welcome-panel__greeting">
          <div className="welcome-panel__greeting-text">
            <h1
              className={`welcome-panel__heading${welcome.headingIcon ? ' welcome-panel__heading--icon' : ''}`}
            >
              {welcome.headingIcon === 'agentic-os' ? (
                <>
                  <span className="welcome-panel__heading-icon" aria-hidden>
                    <Orbit size={30} strokeWidth={2} />
                  </span>
                  {greeting.title}
                </>
              ) : welcome.headingIcon === 'live-app-studio' ? (
                <>
                  <span className="welcome-panel__heading-icon welcome-panel__heading-icon--liveapp" aria-hidden>
                    <LiveAppGlyph size={28} strokeWidth={1.5} />
                  </span>
                  {greeting.title}，{t(aiPartnerKey)}
                </>
              ) : welcome.headingIcon === 'agent-app-studio' ? (
                <>
                  <span className="welcome-panel__heading-icon welcome-panel__heading-icon--liveapp" aria-hidden>
                    <SparoAgentIcon size={28} strokeWidth={1.5} />
                  </span>
                  {greeting.title}，{t(aiPartnerKey)}
                </>
              ) : (
                <>
                  {greeting.title}，{t(aiPartnerKey)}
                </>
              )}
            </h1>
            <p className="welcome-panel__tagline">{tagline}</p>
          </div>
        </div>

        <div className="welcome-panel__divider" />

        {/* Narrative: workspace */}
        <div className="welcome-panel__narrative">
          <p className="welcome-panel__narrative-text">
            {welcome.narrativeKey ? (
              t(welcome.narrativeKey)
            ) : !hasWorkspace ? (
              <>
                {t('welcome.noWorkspaceHint')}
                <Button
                  type="button"
                  variant="ghost"
                  size="small"
                  className="welcome-panel__inline-action welcome-panel__inline-action--interactive"
                  onClick={() => { void handleOpenOtherFolder(); }}
                  disabled={isSelectingWorkspace}
                >
                  {t('welcome.openOne')}
                </Button>
                {' '}{t('welcome.toStart')}
              </>
            ) : (
              <>
                <span className="welcome-panel__narrative-sentence">
                  <span className="welcome-panel__narrative-sentence__text">
                    {welcome.workspaceCopy === 'cowork' || welcome.workspaceCopy === 'design'
                      ? t(welcome.workspaceCopy === 'design' ? 'welcome.workingInDesign' : 'welcome.workingInCowork')
                      : t('welcome.workingIn')}
                  </span>
                  <span className="welcome-panel__context-row">
                    <span className="welcome-panel__workspace-anchor" ref={workspaceDropdownRef}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="small"
                        className={`welcome-panel__inline-action welcome-panel__inline-action--interactive${workspaceDropdownOpen ? ' welcome-panel__inline-action--active' : ''}`}
                        onClick={() => setWorkspaceDropdownOpen(v => !v)}
                        disabled={isSelectingWorkspace}
                        title={lastUsedWorkspace?.rootPath}
                      >
                        <FolderOpen size={13} className="welcome-panel__inline-icon" />
                        {lastUsedWorkspace?.name || t('welcome.workspace')}
                        <ChevronDown
                          size={11}
                          className={`welcome-panel__inline-chevron${workspaceDropdownOpen ? ' welcome-panel__inline-chevron--open' : ''}`}
                        />
                      </Button>
                      {workspaceDropdownOpen && (
                        <div className="welcome-panel__dropdown">
                          {hasWorkspace && lastUsedWorkspace && (
                            <div className="welcome-panel__dropdown-current">
                              <Check size={11} />
                              <FolderOpen size={12} />
                              <span className="welcome-panel__dropdown-name">{lastUsedWorkspace.name}</span>
                            </div>
                          )}
                          {otherWorkspaces.length > 0 && (
                            <>
                              {hasWorkspace && <div className="welcome-panel__dropdown-sep" />}
                              {otherWorkspaces.map(ws => (
                                <Button
                                  key={ws.id}
                                  type="button"
                                  variant="ghost"
                                  size="small"
                                  className="welcome-panel__dropdown-option"
                                  onClick={() => { void handleSwitchWorkspace(ws); }}
                                  title={ws.rootPath}
                                >
                                  <FolderOpen size={12} />
                                  <span className="welcome-panel__dropdown-name">{ws.name}</span>
                                </Button>
                              ))}
                            </>
                          )}
                        </div>
                      )}
                    </span>
                  </span>
                  <span className="welcome-panel__narrative-sentence__text">
                    {welcome.workspaceCopy === 'cowork' || welcome.workspaceCopy === 'design'
                      ? t(welcome.workspaceCopy === 'design' ? 'welcome.projectDesign' : 'welcome.projectCowork')
                      : t('welcome.project')}
                  </span>
                </span>
              </>
            )}
          </p>
        </div>

        {/* Cowork examples */}
        {welcome.promptPanel === 'cowork' && (
          <div className="welcome-panel__cowork">
            <CoworkExampleCards resetKey={0} onSelectPrompt={p => handleQuickActionClick(p)} />
          </div>
        )}

        {welcome.promptPanel === 'live-app-studio' && (
          <div className="welcome-panel__liveapp">
            <div className="welcome-panel__liveapp-title">{t('welcome.liveAppPrompts.title')}</div>
            <div className="welcome-panel__liveapp-grid">
              {LIVE_APP_PROMPTS.map((prompt) => {
                const Icon = prompt.icon;
                return (
                  <Button
                    key={prompt.id}
                    type="button"
                    variant="ghost"
                    size="small"
                    className="welcome-panel__liveapp-card"
                    onClick={() => handleQuickActionClick(t(`welcome.liveAppPrompts.items.${prompt.id}.prompt`))}
                  >
                    <span className="welcome-panel__liveapp-card-icon" aria-hidden>
                      <Icon size={17} />
                    </span>
                    <span className="welcome-panel__liveapp-card-copy">
                      <span className="welcome-panel__liveapp-card-title">
                        {t(`welcome.liveAppPrompts.items.${prompt.id}.title`)}
                      </span>
                      <span className="welcome-panel__liveapp-card-desc">
                        {t(`welcome.liveAppPrompts.items.${prompt.id}.description`)}
                      </span>
                    </span>
                  </Button>
                );
              })}
            </div>
          </div>
        )}

        {welcome.promptPanel === 'agent-app-studio' && (
          <div className="welcome-panel__liveapp">
            <div className="welcome-panel__liveapp-title">{t('welcome.agentAppPrompts.title')}</div>
            <div className="welcome-panel__liveapp-grid">
              {AGENT_APP_PROMPTS.map((prompt) => {
                const Icon = prompt.icon;
                return (
                  <Button
                    key={prompt.id}
                    type="button"
                    variant="ghost"
                    size="small"
                    className="welcome-panel__liveapp-card"
                    onClick={() => handleQuickActionClick(t(`welcome.agentAppPrompts.items.${prompt.id}.prompt`))}
                  >
                    <span className="welcome-panel__liveapp-card-icon" aria-hidden>
                      <Icon size={17} />
                    </span>
                    <span className="welcome-panel__liveapp-card-copy">
                      <span className="welcome-panel__liveapp-card-title">
                        {t(`welcome.agentAppPrompts.items.${prompt.id}.title`)}
                      </span>
                      <span className="welcome-panel__liveapp-card-desc">
                        {t(`welcome.agentAppPrompts.items.${prompt.id}.description`)}
                      </span>
                    </span>
                  </Button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WelcomePanel;
