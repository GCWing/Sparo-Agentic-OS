import { useEffect, useCallback, useRef } from 'react';
import { ChatProvider, useAIInitialization } from '../infrastructure';
import { ViewModeProvider } from '../infrastructure/contexts/ViewModeProvider';
import AppLayout from './layout/AppLayout';
import { useCurrentModelConfig } from '../hooks/useModelConfigs';
import { ContextMenuRenderer } from '../shared/context-menu-system/components/ContextMenuRenderer';
import { NotificationContainer } from '../shared/notification-system';
import { AnnouncementProvider } from '../shared/announcement-system';
import { ConfirmDialogRenderer } from '@/design-system';
import { createLogger } from '@/shared/utils/logger';
import { aiExperienceConfigService } from '@/infrastructure/config/services/AIExperienceConfigService';
import { syncAgentCompanionDesktopWindow } from '@/infrastructure/config/services/AgentCompanionWindowService';
import { isTauriRuntime } from '@/infrastructure/runtime';
import { buildAgentCompanionActivity, subscribeAgentCompanionActivity } from '@/flow_chat/utils/agentCompanionActivity';
import { emitAgentCompanionActivity } from '@/flow_chat/services/AgentCompanionActivityBridge';
import { useWorkspaceContext } from '../infrastructure/contexts/WorkspaceContext';
import BootErrorPanel from '@/boot/BootErrorPanel';
import { useBootStage } from '@/boot/useBootStage';
import { isAppReady, isDegraded } from '@/boot/bootStage';
import { useGlobalSceneShortcuts } from './hooks/useGlobalSceneShortcuts';
import { openAgentCompanionSession } from './services/openAgentCompanionSession';
import { useSettingsStore } from './scenes/settings/settingsStore';
import { openWorkspaceScene } from './navigation/workspaceNavigation';

const log = createLogger('App');
/**
 * BitFun main application component.
 *
 * Unified architecture:
 * - Use a single AppLayout component
 * - AppLayout switches content based on workspace presence
 * - Without a workspace: show startup content (branding + actions)
 * - With a workspace: show workspace panels
 * - Header is always present; elements toggle by state
 */
function App() {
  // AI initialization
  const { currentConfig } = useCurrentModelConfig();
  const { isInitialized: aiInitialized, isInitializing: aiInitializing, error: aiError } = useAIInitialization(currentConfig);

  // Workspace loading state — keeps WorkspaceProvider context honest, but is
  // no longer the source of truth for splash exit (the boot stage event is).
  const { loading: workspaceLoading } = useWorkspaceContext();
  void workspaceLoading;

  // Backend-driven boot stage. Used only for the degraded-recovery panel
  // now — the inline splash in index.html handles the "still booting" UX
  // and dismisses itself on `workspaceReady` (see main.tsx).
  const bootStage = useBootStage();
  void isAppReady; // retained import for callers; intentionally unused here

  const mainWindowShownRef = useRef(false);

  const showMainWindow = useCallback(async (reason: string) => {
    if (mainWindowShownRef.current) {
      return;
    }
    mainWindowShownRef.current = true;

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('show_main_window');
      log.debug('Main window shown', { reason });
    } catch (error: any) {
      log.error('Failed to show main window', error);

      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const mainWindow = getCurrentWindow();
        await mainWindow.show();
        await mainWindow.setFocus();
        log.debug('Main window shown via fallback', { reason });
      } catch (fallbackError) {
        log.error('Fallback window show failed', fallbackError);
        mainWindowShownRef.current = false;
      }
    }
  }, []);

  // Reveal the native window as soon as React has painted a frame.
  // The inline HTML splash still covers the UI until the backend reports
  // `workspaceReady`, so users see the breathing logo immediately instead
  // of waiting on a hidden window while startup continues.
  useEffect(() => {
    void showMainWindow('startup-overlay');
  }, [showMainWindow]);

  // Safety net: if backend never reports WorkspaceReady in 3s, reveal the
  // window anyway so the user can see what's happening (or use BootErrorPanel).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void showMainWindow('startup-watchdog');
    }, 3000);

    return () => window.clearTimeout(timer);
  }, [showMainWindow]);

  // Startup logs and initialization
  useEffect(() => {
    log.info('Application started, initializing systems');
    
    // Initialize IDE control system
    const initIdeControl = async () => {
      try {
        const { initializeIdeControl } = await import('../shared/services/ide-control');
        await initializeIdeControl();
        log.debug('IDE control system initialized');
      } catch (error) {
        log.error('Failed to initialize IDE control system', error);
      }
    };
    
    // Initialize MCP servers
    const initMCPServers = async () => {
      try {
        const { MCPAPI } = await import('../infrastructure/api/service-api/MCPAPI');
        await MCPAPI.initializeServers();
        log.debug('MCP servers initialized');
      } catch (error) {
        log.error('Failed to initialize MCP servers', error);
      }
    };

    // Initialize self-control event listener
    const initSelfControl = async () => {
      try {
        const { startSelfControlEventListener } = await import('../infrastructure/self-control');
        startSelfControlEventListener();
        log.debug('Self-control event listener initialized');
      } catch (error) {
        log.error('Failed to initialize self-control event listener', error);
      }
    };

    initIdeControl();
    initMCPServers();
    initSelfControl();
    
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    const emitCurrentAgentCompanionActivity = () => {
      void emitAgentCompanionActivity(buildAgentCompanionActivity());
    };

    void aiExperienceConfigService.getSettingsAsync().then(async settings => {
      await syncAgentCompanionDesktopWindow(settings);
      emitCurrentAgentCompanionActivity();
      window.setTimeout(emitCurrentAgentCompanionActivity, 250);
    });

    return aiExperienceConfigService.addChangeListener(settings => {
      void syncAgentCompanionDesktopWindow(settings).then(() => {
        emitCurrentAgentCompanionActivity();
        window.setTimeout(emitCurrentAgentCompanionActivity, 250);
      });
    });
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let unlisten: (() => void) | null = null;
    void import('@tauri-apps/api/event')
      .then(({ listen }) => listen(
        'agent-companion://open-settings',
        async () => {
          useSettingsStore.getState().setActiveTab('personalization');
          openWorkspaceScene('settings');

          try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('show_main_window');
          } catch (error) {
            log.warn('Failed to show main window from Agent companion settings menu', error);
          }
        },
      ))
      .then(removeListener => {
        unlisten = removeListener;
      })
      .catch(error => {
        log.warn('Failed to listen for Agent companion settings events', error);
      });

    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let unlisten: (() => void) | null = null;
    void import('@tauri-apps/api/event')
      .then(({ listen }) => listen(
        'agent-companion://open-latest-task',
        async () => {
          const latestTask = [...buildAgentCompanionActivity().tasks]
            .sort((a, b) => b.updatedAt - a.updatedAt)[0];

          if (latestTask) {
            await openAgentCompanionSession(latestTask.sessionId);
          }

          try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('show_main_window');
          } catch (error) {
            log.warn('Failed to show main window from Agent companion latest task menu', error);
          }
        },
      ))
      .then(removeListener => {
        unlisten = removeListener;
      })
      .catch(error => {
        log.warn('Failed to listen for Agent companion latest task events', error);
      });

    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => subscribeAgentCompanionActivity(activity => {
    void emitAgentCompanionActivity(activity);
  }), []);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let unlisten: (() => void) | null = null;
    void import('@tauri-apps/api/event')
      .then(({ listen }) => listen<{ sessionId?: string }>(
        'agent-companion://open-session',
        async event => {
          const sessionId = event.payload?.sessionId;
          if (!sessionId) return;

          await openAgentCompanionSession(sessionId);

          try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('show_main_window');
          } catch (error) {
            log.warn('Failed to show main window from Agent companion bubble', {
              sessionId,
              error,
            });
          }
        },
      ))
      .then(removeListener => {
        unlisten = removeListener;
      })
      .catch(error => {
        log.warn('Failed to listen for Agent companion session open events', error);
      });

    return () => {
      unlisten?.();
    };
  }, []);

  // Observe AI initialization state
  useEffect(() => {
    if (aiError) {
      log.error('AI initialization failed', aiError);
    } else if (aiInitialized) {
      log.debug('AI client initialized successfully');
    } else if (!aiInitializing && !currentConfig) {
      log.warn('AI not initialized: waiting for model config');
    } else if (!aiInitializing && currentConfig && !currentConfig.apiKey) {
      log.warn('AI not initialized: missing API key');
    } else if (!aiInitializing && currentConfig && !currentConfig.modelName) {
      log.warn('AI not initialized: missing model name');
    } else if (!aiInitializing && currentConfig && !currentConfig.baseUrl) {
      log.warn('AI not initialized: missing base URL');
    }
  }, [aiInitialized, aiInitializing, aiError, currentConfig]);

  // Block browser-native Ctrl+F (find bar) and Ctrl+R (hard reload).
  // On macOS the equivalent modifiers are Cmd+F / Cmd+R.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const primary = e.ctrlKey || e.metaKey;
      if (!primary) return;
      const key = e.key.toLowerCase();
      if (key === 'f' || key === 'r') {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, []);

  // Scene overlays: Mod+, / Mod+Shift+`
  useGlobalSceneShortcuts();

  // Unified layout via a single AppLayout
  return (
    <ChatProvider>
        <ViewModeProvider defaultMode="coder">
            {/* Unified app layout with startup/workspace modes */}
            <AppLayout />

            {/* Context menu renderer */}
            <ContextMenuRenderer />

            {/* Notification system */}
            <NotificationContainer />

            {/* Confirm dialog */}
            <ConfirmDialogRenderer />

            {/* Announcement / feature-demo / tips system */}
            <AnnouncementProvider />

            {/* Recovery panel for boot failures. */}
            {isDegraded(bootStage) && (
              <BootErrorPanel stage={bootStage.stage} error={bootStage.error} />
            )}
        </ViewModeProvider>
    </ChatProvider>
  );
}

export default App;
