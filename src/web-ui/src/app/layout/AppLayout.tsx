/**
 * Main application layout.
 *
 * Column structure (top to bottom):
 *   WorkspaceBody (flex:1) �?contains UnifiedTopBar + full-width content area
 *                             floating: WorkDock
 *
 * TitleBar removed; window controls moved to UnifiedTopBar, dialogs managed here.
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useWorkspaceContext } from '../../infrastructure/contexts/WorkspaceContext';
import { useWindowControls } from '../hooks/useWindowControls';
import { useApp } from '../hooks/useApp';
import { configManager } from '@/infrastructure/config';
import { parseStoredKeybindings, shortcutManager } from '@/infrastructure/services/ShortcutManager';

type TransitionDirection = 'entering' | 'returning' | null;
import { FlowChatManager } from '../../flow_chat/services/FlowChatManager';
import { openDispatcherSession } from '@/flow_chat/services/openDispatcherSession';
import WorkspaceBody from './WorkspaceBody';
import { NewProjectDialog } from '../components/NewProjectDialog';
import { AboutDialog } from '../components/AboutDialog';
import { MCPInteractionDialog } from '../components/MCPInteractionDialog/MCPInteractionDialog';
import { WorkspaceManager } from '../../tools/workspace';
import { workspaceAPI } from '@/infrastructure/api';
import { createLogger } from '@/shared/utils/logger';
import { useI18n } from '@/infrastructure/i18n';
import { consumeDeferredNewSessionWorkspace } from '../utils/deferredWorkspaceSession';
import { appRuntime, runtimePolicy } from '@/infrastructure/app-runtime';
import { descriptorFromAgentType } from '@/flow_chat/domain/sessionDescriptor';
import './AppLayout.scss';

const log = createLogger('AppLayout');

const RECENT_WORKSPACE_PRELOAD_LIMIT = 7;
const RECENT_SESSION_WARMUP_LIMIT = 5;
const RECENT_DISPATCHER_WARMUP_LIMIT = 3;

interface AppLayoutProps {
  className?: string;
}

const AppLayout: React.FC<AppLayoutProps> = ({ className = '' }) => {
  const { t } = useI18n('components');
  const {
    lastUsedWorkspace,
    hasWorkspace,
    openWorkspace,
    recentWorkspaces,
    loading,
  } = useWorkspaceContext();
  const { handleMinimize, handleMaximize, handleClose, isMaximized } =
    useWindowControls();

  const { state, switchLeftPanelTab, toggleLeftPanel, toggleRightPanel } = useApp();

  // ── Load user keybinding overrides from config on startup ────────────────
  useEffect(() => {
    const load = async () => {
      try {
        const raw = await configManager.getConfig('app.keybindings');
        const overrides = parseStoredKeybindings(raw);
        if (Object.keys(overrides).length > 0) {
          shortcutManager.loadUserOverrides(overrides);
        }
      } catch {
        // No overrides stored yet �?that's fine
      }
    };

    void load();

    const unsubscribe = configManager.onConfigChange((path) => {
      if (path === 'app.keybindings') void load();
    });

    return () => unsubscribe();
  }, []);
  const isTransitioning = false;
  const transitionDir: TransitionDirection = null;
  const recentPreloadKeyRef = useRef<string | null>(null);

  /** Once per app mount: after FlowChat init, focus Agentic OS (Dispatcher) instead of a workspace-scoped chat. */
  const startupAgenticOsSessionAppliedRef = useRef(false);

  // Dialog state (previously in TitleBar)
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const [showAboutDialog, setShowAboutDialog] = useState(false);
  const [showWorkspaceStatus, setShowWorkspaceStatus] = useState(false);
  const handleOpenProject = useCallback(async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t('header.selectProjectDirectory'),
      });

      if (selected && typeof selected === 'string') {
        await openWorkspace(selected);
      }
    } catch (error) {
      log.error('Failed to open project', error);
    }
  }, [openWorkspace, t]);
  const handleNewProject = useCallback(() => setShowNewProjectDialog(true), []);
  const handleShowAbout  = useCallback(() => setShowAboutDialog(true), []);

  const handleConfirmNewProject = useCallback(async (parentPath: string, projectName: string) => {
    const normalized = parentPath.replace(/\\/g, '/');
    const newProjectPath = `${normalized}/${projectName}`;
    try {
      await workspaceAPI.createDirectory(newProjectPath);
      await openWorkspace(newProjectPath);
    } catch (error) {
      log.error('Failed to create project', error);
      throw error;
    }
  }, [openWorkspace]);

  // Listen for nav-panel events dispatched by the workspace area
  useEffect(() => {
    const onOpenProject = () => { void handleOpenProject(); };
    const onNewProject = () => handleNewProject();
    const onShowAbout = () => handleShowAbout();
    window.addEventListener('nav:open-project', onOpenProject);
    window.addEventListener('nav:new-project', onNewProject);
    window.addEventListener('nav:show-about', onShowAbout);
    return () => {
      window.removeEventListener('nav:open-project', onOpenProject);
      window.removeEventListener('nav:new-project', onNewProject);
      window.removeEventListener('nav:show-about', onShowAbout);
    };
  }, [handleNewProject, handleOpenProject, handleShowAbout]);

  // macOS native menubar events (previously in TitleBar)
  const isMacOS = useMemo(() => {
    const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
    return isTauri && typeof navigator?.platform === 'string' && navigator.platform.toUpperCase().includes('MAC');
  }, []);

  useEffect(() => {
    if (!isMacOS) return;
    let unlistenFns: Array<() => void> = [];
    void (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const { open } = await import('@tauri-apps/plugin-dialog');
        unlistenFns.push(await listen('sparo_menu_open_project', async () => {
          try {
            const selected = await open({ directory: true, multiple: false }) as string;
            if (selected) await openWorkspace(selected);
          } catch {}
        }));
        unlistenFns.push(await listen('sparo_menu_new_project', () => handleNewProject()));
        unlistenFns.push(await listen('sparo_menu_about', () => handleShowAbout()));
      } catch {}
    })();
    return () => { unlistenFns.forEach(fn => fn()); unlistenFns = []; };
  }, [isMacOS, openWorkspace, handleNewProject, handleShowAbout]);

  // Initialize FlowChatManager
  React.useEffect(() => {
    const initializeFlowChat = async () => {
      if (!lastUsedWorkspace?.rootPath) return;

      try {
        const explicitPreferredMode =
          sessionStorage.getItem('sparo:flowchat:preferredAgent') ||
          undefined;
        if (explicitPreferredMode) {
          sessionStorage.removeItem('sparo:flowchat:preferredAgent');
        }

        const initializationPreferredDescriptor = explicitPreferredMode
          ? descriptorFromAgentType(explicitPreferredMode)
          : undefined;
        const suppressAutoSessionSelection = consumeDeferredNewSessionWorkspace(
          lastUsedWorkspace.rootPath
        );

        const flowChatManager = FlowChatManager.getInstance();
        const initialization = await flowChatManager.initializeWorkspaceSessionState(
          lastUsedWorkspace.rootPath,
          {
            preferredDescriptor: initializationPreferredDescriptor,
            skipAutoSelectSession: suppressAutoSessionSelection,
            createDefaultSession: true,
            defaultSessionConfig: {
              workspaceId: lastUsedWorkspace.id,
              workspacePath: lastUsedWorkspace.rootPath,
            },
            defaultSessionDescriptor: initializationPreferredDescriptor ?? descriptorFromAgentType('agentic'),
          }
        );

        const { flowChatStore } = await import('@/flow_chat/store/FlowChatStore');
        const workspaceScopedActiveId =
          initialization.createdSessionId ||
          initialization.activeSessionId ||
          flowChatStore.getState().activeSessionId;

        const pendingDescription = sessionStorage.getItem('pendingProjectDescription');
        if (pendingDescription && pendingDescription.trim()) {
          sessionStorage.removeItem('pendingProjectDescription');
          const pendingTargetSessionId = workspaceScopedActiveId;

          setTimeout(async () => {
            try {
              const targetSessionId = pendingTargetSessionId || flowChatStore.getState().activeSessionId;

              if (!targetSessionId) {
                log.error('Cannot find active session ID');
                return;
              }

              const fullMessage = t('appLayout.projectRequestMessage', { description: pendingDescription });
              await flowChatManager.sendMessage(fullMessage, targetSessionId);

              import('@/shared/notification-system').then(({ notificationService }) => {
                notificationService.success(t('appLayout.projectRequestSent'), { duration: 3000 });
              });
            } catch (sendError) {
              log.error('Failed to send project description', sendError);
              import('@/shared/notification-system').then(({ notificationService }) => {
                notificationService.error(t('appLayout.projectRequestSendFailed'), { duration: 5000 });
              });
            }
          }, 500);
        }

        if (!startupAgenticOsSessionAppliedRef.current && !explicitPreferredMode) {
          try {
            await openDispatcherSession();
            startupAgenticOsSessionAppliedRef.current = true;
          } catch (dispatcherError) {
            log.warn('Failed to open default Agentic OS session', dispatcherError);
          }
        }

        const pendingSettings = sessionStorage.getItem('pendingOpenSettings');
        if (pendingSettings) {
          sessionStorage.removeItem('pendingOpenSettings');
          setTimeout(async () => {
            try {
              const { quickActions } = await import('@/shared/services/ide-control');
              await quickActions.openSettings(pendingSettings);
            } catch (settingsError) {
              log.error('Failed to open pending settings', settingsError);
            }
          }, 500);
        }
      } catch (error) {
        log.error('FlowChatManager initialization failed', error);
        import('@/shared/notification-system').then(({ notificationService }) => {
          notificationService.error(t('appLayout.flowChatInitFailed'), { duration: 5000 });
        });
      }
    };

    initializeFlowChat();
  }, [
    lastUsedWorkspace,
    lastUsedWorkspace?.id,
    lastUsedWorkspace?.rootPath,
    t,
  ]);

  React.useEffect(() => {
    if (loading || recentWorkspaces.length === 0) {
      return;
    }

    const preloadTargetMap = new Map<string, (typeof recentWorkspaces)[number]>();
    recentWorkspaces
      .slice(0, RECENT_WORKSPACE_PRELOAD_LIMIT)
      .forEach(workspace => preloadTargetMap.set(workspace.id, workspace));
    const preloadTargets = Array.from(preloadTargetMap.values());
    const preloadKey = preloadTargets
      .map(workspace => `${workspace.id}:${workspace.rootPath}`)
      .join('|');

    if (!preloadKey || recentPreloadKeyRef.current === preloadKey) {
      return;
    }
    recentPreloadKeyRef.current = preloadKey;

    let cancelled = false;
    const handle = appRuntime.scheduleTask('session-preload:recent-workspaces', async () => {
      try {
        const result = await FlowChatManager.getInstance().preloadRecentWorkspaceSessions(
          preloadTargets,
          {
            metadataLimit: RECENT_WORKSPACE_PRELOAD_LIMIT,
            warmHistoryCount: RECENT_SESSION_WARMUP_LIMIT,
          }
        );
        if (!cancelled) {
          log.info('Recent workspace session preload completed', result);
        }
      } catch (error) {
        if (!cancelled) {
          log.warn('Recent workspace session preload failed', error);
        }
      }
    }, runtimePolicy.sessionPreloadRecent);

    return () => {
      cancelled = true;
      handle.cancel();
    };
  }, [loading, recentWorkspaces]);

  React.useEffect(() => {
    if (loading) {
      return;
    }
    let cancelled = false;
    const handle = appRuntime.scheduleTask('session-preload:agentic-os', async () => {
      try {
        const result = await FlowChatManager.getInstance().preloadAgenticOsSessions({
          warmDispatcherCount: RECENT_DISPATCHER_WARMUP_LIMIT,
        });
        if (!cancelled) {
          log.info('Agentic OS session preload completed', result);
        }
      } catch (error) {
        if (!cancelled) {
          log.warn('Agentic OS session preload failed', error);
        }
      }
    }, runtimePolicy.sessionPreloadAgentic);
    return () => {
      cancelled = true;
      handle.cancel();
    };
  }, [loading]);

  // Save in-progress conversations on window close
  React.useEffect(() => {
    let unlistenFn: (() => void) | null = null;

    const setupWindowCloseListener = async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const currentWindow = getCurrentWindow();

        // NOTE: do NOT call `currentWindow.close()` here. The Rust-side
        // CloseRequested handler decides whether to hide-to-tray or actually
        // exit (based on the `wants_exit` flag). Calling `close()` from JS
        // after Rust has already called `prevent_close()` produces an
        // infinite CloseRequested loop. We just save in-flight state.
        unlistenFn = await currentWindow.onCloseRequested(async () => {
          try {
            const flowChatManager = FlowChatManager.getInstance();
            await flowChatManager.saveAllInProgressTurns();
          } catch (error) {
            log.error('Failed to save conversations on close', error);
          }
        });
      } catch (error) {
        log.error('Failed to setup window close listener', error);
      }
    };

    setupWindowCloseListener();
    return () => { if (unlistenFn) unlistenFn(); };
  }, []);

  // Handle switch-to-files-panel event
  React.useEffect(() => {
    const handleSwitchToFilesPanel = () => {
      switchLeftPanelTab('files');
      if (state.layout.leftPanelCollapsed) toggleLeftPanel();
      if (state.layout.rightPanelCollapsed) {
        setTimeout(() => toggleRightPanel(), 100);
      }
    };

    window.addEventListener('switch-to-files-panel', handleSwitchToFilesPanel);
    return () => window.removeEventListener('switch-to-files-panel', handleSwitchToFilesPanel);
  }, [state.layout.leftPanelCollapsed, state.layout.rightPanelCollapsed, switchLeftPanelTab, toggleLeftPanel, toggleRightPanel]);

  // Global drag-and-drop
  React.useEffect(() => {
    const handleDragStart = (e: DragEvent) => {
      if (e.dataTransfer) {
        if (e.dataTransfer.types.length === 0) e.dataTransfer.setData('text/plain', 'dragging');
        e.dataTransfer.effectAllowed = 'copy';
      }
    };
    const handleDragOver  = (e: DragEvent) => e.preventDefault();
    const handleDragEnter = (_e: DragEvent) => {};
    const handleDrop      = (e: DragEvent) => { if (!e.defaultPrevented) e.preventDefault(); };

    document.addEventListener('dragstart', handleDragStart, true);
    document.addEventListener('dragover',  handleDragOver,  true);
    document.addEventListener('dragenter', handleDragEnter, true);
    document.addEventListener('drop',      handleDrop,      true);

    return () => {
      document.removeEventListener('dragstart', handleDragStart, true);
      document.removeEventListener('dragover',  handleDragOver,  true);
      document.removeEventListener('dragenter', handleDragEnter, true);
      document.removeEventListener('drop',      handleDrop,      true);
    };
  }, []);

  const containerClassName = [
    'sparo-app-layout',
    isMacOS ? 'sparo-app-layout--macos' : '',
    className,
    isTransitioning ? 'sparo-app-layout--transitioning' : '',
  ].filter(Boolean).join(' ');

  return (
    <>
      <div className={containerClassName} data-testid="app-layout">
        {/* Main content �?always render WorkspaceBody; WelcomeScene in viewport handles no-workspace state */}
        <main className="sparo-app-main-workspace" data-testid="app-main-content">
          <WorkspaceBody
            onMinimize={isMacOS ? undefined : handleMinimize}
            onMaximize={handleMaximize}
            onClose={isMacOS ? undefined : handleClose}
            isMaximized={isMaximized}
            isEntering={transitionDir === 'entering'}
            isExiting={transitionDir === 'returning'}
          />
        </main>
      </div>

      {/* Dialogs (previously owned by TitleBar) */}
      <NewProjectDialog
        isOpen={showNewProjectDialog}
        onClose={() => setShowNewProjectDialog(false)}
        onConfirm={handleConfirmNewProject}
        defaultParentPath={hasWorkspace ? lastUsedWorkspace?.rootPath : undefined}
      />
      <AboutDialog
        isOpen={showAboutDialog}
        onClose={() => setShowAboutDialog(false)}
      />
      <WorkspaceManager
        isVisible={showWorkspaceStatus}
        onClose={() => setShowWorkspaceStatus(false)}
        onWorkspaceSelect={() => {}}
      />
      <MCPInteractionDialog />
    </>
  );
};

export default AppLayout;
