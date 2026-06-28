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
import { SurfaceComponentGlyph } from '@/app/scenes/apps/surface-component/surfaceComponentIcons';
import { createLogger } from '@/shared/utils/logger';
import {
  getWorkspaceDisplayName,
  useWorkspaceContext,
} from '@/infrastructure/contexts/WorkspaceContext';
import type { WorkspaceInfo } from '@/shared/types';
import { isSamePath } from '@/shared/utils/pathUtils';
import { resolveSessionTypeDefinition, useSessionProfile } from '@/app/session-profiles';
import { Button, SparoAgentIcon } from '@/design-system';
import {
  fallbackWorkspaceFolderLabel,
  resolveWorkspaceForSession,
} from '../utils/sessionOrdering';
import CoworkExampleCards from './CoworkExampleCards';
import './WelcomePanel.css';

const log = createLogger('WelcomePanel');

type SurfaceComponentPromptId = 'starter' | 'dashboard' | 'polish' | 'debug';

interface SurfaceComponentPrompt {
  id: SurfaceComponentPromptId;
  icon: LucideIcon;
}

const SURFACE_COMPONENT_PROMPTS: SurfaceComponentPrompt[] = [
  { id: 'starter', icon: AppWindow },
  { id: 'dashboard', icon: Gauge },
  { id: 'polish', icon: Palette },
  { id: 'debug', icon: Bug },
];

type AgentComponentPromptId = 'starter' | 'tools' | 'examples' | 'iterate';

interface AgentComponentPrompt {
  id: AgentComponentPromptId;
  icon: LucideIcon;
}

const AGENT_COMPONENT_PROMPTS: AgentComponentPrompt[] = [
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

interface WelcomeWorkspaceTarget {
  id: string | null;
  name: string;
  rootPath: string | null;
}

export const WelcomePanel: React.FC<WelcomePanelProps> = ({
  onQuickAction,
  className = '',
  workspacePath,
}) => {
  const { t } = useTranslation('flow-chat');
  const [workspaceDropdownOpen, setWorkspaceDropdownOpen] = useState(false);
  const [isSelectingWorkspace, setIsSelectingWorkspace] = useState(false);
  const workspaceDropdownRef = useRef<HTMLDivElement>(null);
  const { profile } = useSessionProfile();

  const {
    lastUsedWorkspace,
    openedWorkspacesList,
    openWorkspace,
    switchWorkspace,
  } = useWorkspaceContext();

  const sessionType = useMemo(() => resolveSessionTypeDefinition(profile.id), [profile.id]);
  const welcome = sessionType.welcome;

  const sessionWorkspaceTarget = useMemo<WelcomeWorkspaceTarget | null>(() => {
    const scopedPath = workspacePath?.trim();
    if (!scopedPath) return null;

    const openedWorkspace = resolveWorkspaceForSession({ workspacePath: scopedPath }, openedWorkspacesList);
    if (openedWorkspace) {
      const displayName = getWorkspaceDisplayName(openedWorkspace).trim();
      return {
        id: openedWorkspace.id,
        name: displayName || fallbackWorkspaceFolderLabel(openedWorkspace.rootPath) || openedWorkspace.rootPath,
        rootPath: openedWorkspace.rootPath,
      };
    }

    return {
      id: null,
      name: fallbackWorkspaceFolderLabel(scopedPath) || scopedPath,
      rootPath: scopedPath,
    };
  }, [openedWorkspacesList, workspacePath]);

  const welcomeWorkspace = useMemo<WelcomeWorkspaceTarget | null>(() => {
    if (sessionWorkspaceTarget) return sessionWorkspaceTarget;
    if (!lastUsedWorkspace) return null;
    const displayName = getWorkspaceDisplayName(lastUsedWorkspace).trim();
    return {
      id: lastUsedWorkspace.id,
      name: displayName || fallbackWorkspaceFolderLabel(lastUsedWorkspace.rootPath) || lastUsedWorkspace.rootPath,
      rootPath: lastUsedWorkspace.rootPath,
    };
  }, [lastUsedWorkspace, sessionWorkspaceTarget]);

  const hasWelcomeWorkspace = Boolean(welcomeWorkspace);

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
    () => openedWorkspacesList.filter((ws) => {
      if (!welcomeWorkspace) return true;
      if (welcomeWorkspace.id && ws.id === welcomeWorkspace.id) return false;
      if (welcomeWorkspace.rootPath && isSamePath(ws.rootPath, welcomeWorkspace.rootPath)) return false;
      return true;
    }),
    [openedWorkspacesList, welcomeWorkspace],
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
              ) : welcome.headingIcon === 'app-studio' ? (
                <>
                  <span className="welcome-panel__heading-icon welcome-panel__heading-icon--studio" aria-hidden>
                    <SurfaceComponentGlyph size={28} strokeWidth={1.5} />
                  </span>
                  {greeting.title}，{t(aiPartnerKey)}
                </>
              ) : welcome.headingIcon === 'component-studio' ? (
                <>
                  <span className="welcome-panel__heading-icon welcome-panel__heading-icon--studio" aria-hidden>
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
            ) : !hasWelcomeWorkspace ? (
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
                        title={welcomeWorkspace?.rootPath ?? undefined}
                      >
                        <FolderOpen size={13} className="welcome-panel__inline-icon" />
                        {welcomeWorkspace?.name || t('welcome.workspace')}
                        <ChevronDown
                          size={11}
                          className={`welcome-panel__inline-chevron${workspaceDropdownOpen ? ' welcome-panel__inline-chevron--open' : ''}`}
                        />
                      </Button>
                      {workspaceDropdownOpen && (
                        <div className="welcome-panel__dropdown">
                          {welcomeWorkspace && (
                            <div className="welcome-panel__dropdown-current">
                              <Check size={11} />
                              <FolderOpen size={12} />
                              <span className="welcome-panel__dropdown-name">{welcomeWorkspace.name}</span>
                            </div>
                          )}
                          {otherWorkspaces.length > 0 && (
                            <>
                              {hasWelcomeWorkspace && <div className="welcome-panel__dropdown-sep" />}
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

        {welcome.promptPanel === 'app-studio' && (
          <div className="welcome-panel__studio-prompts">
            <div className="welcome-panel__studio-prompt-title">{t('welcome.surfaceComponentPrompts.title')}</div>
            <div className="welcome-panel__studio-prompt-grid">
              {SURFACE_COMPONENT_PROMPTS.map((prompt) => {
                const Icon = prompt.icon;
                return (
                  <Button
                    key={prompt.id}
                    type="button"
                    variant="ghost"
                    size="small"
                    className="welcome-panel__studio-prompt-card"
                    onClick={() => handleQuickActionClick(t(`welcome.surfaceComponentPrompts.items.${prompt.id}.prompt`))}
                  >
                    <span className="welcome-panel__studio-prompt-card-icon" aria-hidden>
                      <Icon size={17} />
                    </span>
                    <span className="welcome-panel__studio-prompt-card-copy">
                      <span className="welcome-panel__studio-prompt-card-title">
                        {t(`welcome.surfaceComponentPrompts.items.${prompt.id}.title`)}
                      </span>
                      <span className="welcome-panel__studio-prompt-card-desc">
                        {t(`welcome.surfaceComponentPrompts.items.${prompt.id}.description`)}
                      </span>
                    </span>
                  </Button>
                );
              })}
            </div>
          </div>
        )}

        {welcome.promptPanel === 'component-studio' && (
          <div className="welcome-panel__studio-prompts">
            <div className="welcome-panel__studio-prompt-title">{t('welcome.agentComponentPrompts.title')}</div>
            <div className="welcome-panel__studio-prompt-grid">
              {AGENT_COMPONENT_PROMPTS.map((prompt) => {
                const Icon = prompt.icon;
                return (
                  <Button
                    key={prompt.id}
                    type="button"
                    variant="ghost"
                    size="small"
                    className="welcome-panel__studio-prompt-card"
                    onClick={() => handleQuickActionClick(t(`welcome.agentComponentPrompts.items.${prompt.id}.prompt`))}
                  >
                    <span className="welcome-panel__studio-prompt-card-icon" aria-hidden>
                      <Icon size={17} />
                    </span>
                    <span className="welcome-panel__studio-prompt-card-copy">
                      <span className="welcome-panel__studio-prompt-card-title">
                        {t(`welcome.agentComponentPrompts.items.${prompt.id}.title`)}
                      </span>
                      <span className="welcome-panel__studio-prompt-card-desc">
                        {t(`welcome.agentComponentPrompts.items.${prompt.id}.description`)}
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
