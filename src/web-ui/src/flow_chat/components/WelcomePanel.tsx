/**
 * Welcome panel shown in the empty chat state.
 * Layout mirrors WelcomeScene: centered container, left-aligned content.
 */

import React, { useEffect, useState, useCallback, useRef, useMemo, useId } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FolderOpen,
  FolderPlus,
  ChevronDown,
  Check,
  Orbit,
  AppWindow,
  Palette,
  Bug,
  Gauge,
  type LucideIcon,
} from 'lucide-react';
import { AppBuilderGlyph } from '@/app/scenes/apps/app-builder/AppBuilderGlyph';
import { createLogger } from '@/shared/utils/logger';
import { FlowChatManager } from '@/flow_chat/services/FlowChatManager';
import {
  getWorkspaceDisplayName,
  useWorkspaceContext,
} from '@/infrastructure/contexts/WorkspaceContext';
import type { WorkspaceInfo } from '@/shared/types';
import type { SessionDescriptor } from '@/flow_chat/domain/sessionDescriptor';
import { isSamePath } from '@/shared/utils/pathUtils';
import { resolveSessionTypeDefinition, useSessionProfile } from '@/app/session-profiles';
import { Button, IconButton, Search } from '@/design-system';
import {
  fallbackWorkspaceFolderLabel,
  resolveWorkspaceForSession,
} from '../utils/sessionOrdering';
import CoworkExampleCards from './CoworkExampleCards';
import './WelcomePanel.css';

const log = createLogger('WelcomePanel');

type AppBuilderPromptId = 'starter' | 'dashboard' | 'polish' | 'debug';

interface AppBuilderPrompt {
  id: AppBuilderPromptId;
  icon: LucideIcon;
}

const APP_BUILDER_PROMPTS: AppBuilderPrompt[] = [
  { id: 'starter', icon: AppWindow },
  { id: 'dashboard', icon: Gauge },
  { id: 'polish', icon: Palette },
  { id: 'debug', icon: Bug },
];

interface WelcomePanelProps {
  onQuickAction?: (command: string) => void;
  className?: string;
  sessionId?: string;
  workspacePath?: string;
  preferredDescriptor?: SessionDescriptor;
}

interface WelcomeWorkspaceTarget {
  id: string | null;
  name: string;
  rootPath: string | null;
}

export const WelcomePanel: React.FC<WelcomePanelProps> = ({
  onQuickAction,
  className = '',
  sessionId,
  workspacePath,
  preferredDescriptor,
}) => {
  const { t } = useTranslation('flow-chat');
  const [workspaceDropdownOpen, setWorkspaceDropdownOpen] = useState(false);
  const [isSelectingWorkspace, setIsSelectingWorkspace] = useState(false);
  const [workspaceSearchQuery, setWorkspaceSearchQuery] = useState('');
  const [highlightedWorkspaceId, setHighlightedWorkspaceId] = useState<string | null>(null);
  const workspaceDropdownRef = useRef<HTMLDivElement>(null);
  const workspaceSearchRef = useRef<HTMLInputElement>(null);
  const workspaceListboxId = useId();
  const { profile } = useSessionProfile();

  const {
    lastUsedWorkspace,
    openedWorkspacesList,
    openWorkspace,
    switchWorkspace,
  } = useWorkspaceContext();

  const sessionType = useMemo(() => resolveSessionTypeDefinition(profile.id), [profile.id]);
  const welcome = sessionType.welcome;
  const workspaceSwitchDescriptor = useMemo(
    () => preferredDescriptor ?? sessionType.descriptorDefaults,
    [preferredDescriptor, sessionType.descriptorDefaults],
  );

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
    if (lastUsedWorkspace) {
      const displayName = getWorkspaceDisplayName(lastUsedWorkspace).trim();
      return {
        id: lastUsedWorkspace.id,
        name: displayName || fallbackWorkspaceFolderLabel(lastUsedWorkspace.rootPath) || lastUsedWorkspace.rootPath,
        rootPath: lastUsedWorkspace.rootPath,
      };
    }
    return null;
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

  const selectedWorkspaceTarget = useMemo<WelcomeWorkspaceTarget | null>(() => {
    return welcomeWorkspace;
  }, [welcomeWorkspace]);

  const filteredWorkspaces = useMemo(() => {
    const query = workspaceSearchQuery.trim().toLocaleLowerCase();
    if (!query) return openedWorkspacesList;
    return openedWorkspacesList.filter((ws) => {
      const name = getWorkspaceDisplayName(ws).toLocaleLowerCase();
      const rootPath = ws.rootPath.toLocaleLowerCase();
      return name.includes(query) || rootPath.includes(query);
    });
  }, [openedWorkspacesList, workspaceSearchQuery]);

  const isSelectedWorkspace = useCallback((ws: WorkspaceInfo) => {
    if (!selectedWorkspaceTarget) return false;
    if (selectedWorkspaceTarget.id && ws.id === selectedWorkspaceTarget.id) return true;
    if (selectedWorkspaceTarget.rootPath && isSamePath(ws.rootPath, selectedWorkspaceTarget.rootPath)) {
      return true;
    }
    return false;
  }, [selectedWorkspaceTarget]);

  useEffect(() => {
    if (!workspaceDropdownOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (workspaceDropdownRef.current && !workspaceDropdownRef.current.contains(e.target as Node)) {
        setWorkspaceDropdownOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setWorkspaceDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [workspaceDropdownOpen]);

  useEffect(() => {
    if (!workspaceDropdownOpen) {
      setWorkspaceSearchQuery('');
      setHighlightedWorkspaceId(null);
    }
  }, [workspaceDropdownOpen]);

  useEffect(() => {
    if (!workspaceDropdownOpen) return;
    const frame = window.requestAnimationFrame(() => {
      workspaceSearchRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [workspaceDropdownOpen]);

  useEffect(() => {
    if (!workspaceDropdownOpen) return;
    setHighlightedWorkspaceId((current) => {
      if (current && filteredWorkspaces.some((ws) => ws.id === current)) {
        return current;
      }
      const selectedWorkspace = filteredWorkspaces.find(isSelectedWorkspace);
      return selectedWorkspace?.id ?? filteredWorkspaces[0]?.id ?? null;
    });
  }, [filteredWorkspaces, isSelectedWorkspace, workspaceDropdownOpen]);

  const handleSwitchWorkspace = useCallback(async (ws: WorkspaceInfo) => {
    try {
      setWorkspaceDropdownOpen(false);
      const workspace = await switchWorkspace(ws);
      if (sessionId) {
        await FlowChatManager.getInstance().retargetEmptySessionWorkspace(sessionId, workspace, {
          preferredDescriptor: workspaceSwitchDescriptor,
        });
      }
    }
    catch (err) { log.warn('Failed to switch workspace', { error: err }); }
  }, [sessionId, switchWorkspace, workspaceSwitchDescriptor]);

  const handleOpenOtherFolder = useCallback(async () => {
    try {
      setWorkspaceDropdownOpen(false);
      setIsSelectingWorkspace(true);
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ directory: true, multiple: false });
      if (selected && typeof selected === 'string') {
        const workspace = await openWorkspace(selected);
        if (sessionId) {
          await FlowChatManager.getInstance().retargetEmptySessionWorkspace(sessionId, workspace, {
            preferredDescriptor: workspaceSwitchDescriptor,
          });
        }
      }
    } catch (err) {
      log.warn('Failed to open workspace folder', { error: err });
    } finally {
      setIsSelectingWorkspace(false);
    }
  }, [openWorkspace, sessionId, workspaceSwitchDescriptor]);

  const moveHighlightedWorkspace = useCallback((direction: 1 | -1) => {
    setHighlightedWorkspaceId((current) => {
      if (filteredWorkspaces.length === 0) return null;
      const currentIndex = current
        ? filteredWorkspaces.findIndex((ws) => ws.id === current)
        : -1;
      const fallbackIndex = direction === 1 ? 0 : filteredWorkspaces.length - 1;
      const nextIndex = currentIndex === -1
        ? fallbackIndex
        : (currentIndex + direction + filteredWorkspaces.length) % filteredWorkspaces.length;
      return filteredWorkspaces[nextIndex]?.id ?? null;
    });
  }, [filteredWorkspaces]);

  const handleWorkspaceSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setWorkspaceDropdownOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveHighlightedWorkspace(1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveHighlightedWorkspace(-1);
      return;
    }
    if (e.key === 'Enter') {
      const targetWorkspace = filteredWorkspaces.find((ws) => ws.id === highlightedWorkspaceId)
        ?? filteredWorkspaces[0];
      if (targetWorkspace) {
        e.preventDefault();
        void handleSwitchWorkspace(targetWorkspace);
      }
    }
  }, [filteredWorkspaces, handleSwitchWorkspace, highlightedWorkspaceId, moveHighlightedWorkspace]);

  const handleQuickActionClick = useCallback((cmd: string) => {
    onQuickAction?.(cmd);
  }, [onQuickAction]);

  const showHeadingPartner = welcome.headingMode !== 'greeting-only';
  const noWorkspaceHintKey = welcome.workspaceCopy === 'runno'
    ? 'welcome.noWorkspaceHintRunno'
    : 'welcome.noWorkspaceHint';
  const openOneKey = welcome.workspaceCopy === 'runno'
    ? 'welcome.openOneRunno'
    : 'welcome.openOne';
  const toStartKey = welcome.workspaceCopy === 'runno'
    ? 'welcome.toStartRunno'
    : 'welcome.toStart';
  const workspaceLeadKey = welcome.workspaceCopy === 'design'
    ? 'welcome.workingInDesign'
    : welcome.workspaceCopy === 'cowork'
      ? 'welcome.workingInCowork'
      : welcome.workspaceCopy === 'runno'
        ? 'welcome.workingInRunno'
        : 'welcome.workingIn';
  const workspaceTrailKey = welcome.workspaceCopy === 'design'
    ? 'welcome.projectDesign'
    : welcome.workspaceCopy === 'cowork'
      ? 'welcome.projectCowork'
      : welcome.workspaceCopy === 'runno'
        ? 'welcome.projectRunno'
        : 'welcome.project';

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
              ) : welcome.headingIcon === 'app-builder' ? (
                <>
                  <span className="welcome-panel__heading-icon welcome-panel__heading-icon--builder" aria-hidden>
                    <AppBuilderGlyph size={28} strokeWidth={1.5} />
                  </span>
                  {showHeadingPartner ? (
                    <>{greeting.title}，{t(aiPartnerKey)}</>
                  ) : (
                    greeting.title
                  )}
                </>
              ) : (
                <>
                  {showHeadingPartner ? (
                    <>{greeting.title}，{t(aiPartnerKey)}</>
                  ) : (
                    greeting.title
                  )}
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
                {t(noWorkspaceHintKey)}
                <Button
                  type="button"
                  variant="ghost"
                  size="small"
                  className="welcome-panel__inline-action welcome-panel__inline-action--interactive"
                  onClick={() => { void handleOpenOtherFolder(); }}
                  disabled={isSelectingWorkspace}
                >
                  {t(openOneKey)}
                </Button>
                {' '}{t(toStartKey)}
              </>
            ) : (
              <>
                <span className="welcome-panel__narrative-sentence">
                  <span className="welcome-panel__narrative-sentence__text">
                    {t(workspaceLeadKey)}
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
                        aria-expanded={workspaceDropdownOpen}
                        aria-haspopup="listbox"
                        aria-controls={workspaceDropdownOpen ? workspaceListboxId : undefined}
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
                          <div className="welcome-panel__dropdown-header">
                            <Search
                              ref={workspaceSearchRef}
                              value={workspaceSearchQuery}
                              onChange={setWorkspaceSearchQuery}
                              onKeyDown={handleWorkspaceSearchKeyDown}
                              size="small"
                              shape="pill"
                              enterToSearch={false}
                              className="welcome-panel__dropdown-search"
                              placeholder={t('welcome.workspaceSearchPlaceholder')}
                              inputAriaLabel={t('welcome.workspaceSearchPlaceholder')}
                              clearAriaLabel={t('welcome.clearWorkspaceSearch')}
                              ariaControls={workspaceListboxId}
                              ariaExpanded={workspaceDropdownOpen}
                            />
                            <IconButton
                              type="button"
                              variant="ghost"
                              size="xs"
                              shape="circle"
                              className="welcome-panel__dropdown-open-workspace"
                              aria-label={t('welcome.openOtherProject')}
                              tooltip={t('welcome.openOtherProject')}
                              tooltipPlacement="right"
                              disabled={isSelectingWorkspace}
                              onClick={() => { void handleOpenOtherFolder(); }}
                            >
                              <FolderPlus size={13} />
                            </IconButton>
                          </div>
                          <div className="welcome-panel__dropdown-sep" />
                          <div
                            id={workspaceListboxId}
                            className="welcome-panel__dropdown-scroll"
                            role="listbox"
                            aria-label={t('welcome.workspace')}
                          >
                            {filteredWorkspaces.length > 0 ? (
                              filteredWorkspaces.map(ws => {
                                const selected = isSelectedWorkspace(ws);
                                const highlighted = highlightedWorkspaceId === ws.id;
                                const displayName = getWorkspaceDisplayName(ws);
                                const optionClassName = [
                                  'welcome-panel__dropdown-option',
                                  selected && 'welcome-panel__dropdown-option--selected',
                                  highlighted && 'welcome-panel__dropdown-option--highlighted',
                                ].filter(Boolean).join(' ');
                                return (
                                  <Button
                                    key={ws.id}
                                    type="button"
                                    variant="ghost"
                                    size="small"
                                    role="option"
                                    aria-selected={selected}
                                    className={optionClassName}
                                    onMouseEnter={() => setHighlightedWorkspaceId(ws.id)}
                                    onClick={() => { void handleSwitchWorkspace(ws); }}
                                    title={ws.rootPath}
                                  >
                                    <span className="welcome-panel__dropdown-check" aria-hidden>
                                      {selected ? <Check size={11} /> : null}
                                    </span>
                                    <FolderOpen size={12} />
                                    <span className="welcome-panel__dropdown-name">{displayName}</span>
                                  </Button>
                                );
                              })
                            ) : (
                              <div className="welcome-panel__dropdown-empty">
                                {t('welcome.workspaceSearchEmpty')}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </span>
                  </span>
                  <span className="welcome-panel__narrative-sentence__text">
                    {t(workspaceTrailKey)}
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

        {welcome.promptPanel === 'app-builder' && (
          <div className="welcome-panel__builder-prompts">
            <div className="welcome-panel__builder-prompt-title">{t('welcome.appBuilderPrompts.title')}</div>
            <div className="welcome-panel__builder-prompt-grid">
              {APP_BUILDER_PROMPTS.map((prompt) => {
                const Icon = prompt.icon;
                return (
                  <Button
                    key={prompt.id}
                    type="button"
                    variant="ghost"
                    size="small"
                    className="welcome-panel__builder-prompt-card"
                    onClick={() => handleQuickActionClick(t(`welcome.appBuilderPrompts.items.${prompt.id}.prompt`))}
                  >
                    <span className="welcome-panel__builder-prompt-card-icon" aria-hidden>
                      <Icon size={17} />
                    </span>
                    <span className="welcome-panel__builder-prompt-card-copy">
                      <span className="welcome-panel__builder-prompt-card-title">
                        {t(`welcome.appBuilderPrompts.items.${prompt.id}.title`)}
                      </span>
                      <span className="welcome-panel__builder-prompt-card-desc">
                        {t(`welcome.appBuilderPrompts.items.${prompt.id}.description`)}
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
