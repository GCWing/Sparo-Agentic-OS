/**
 * Dialog to create a chat session with explicit agent mode and workspace.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { Modal, Select, Button } from '@/component-library';
import { useI18n } from '@/infrastructure/i18n';
import {
  getWorkspaceDisplayName,
  useWorkspaceContext,
} from '@/infrastructure/contexts/WorkspaceContext';
import { flowChatManager } from '@/flow_chat/services/FlowChatManager';
import { flowChatStore } from '@/flow_chat/store/FlowChatStore';
import {
  findReusableEmptyLiveAppStudioSessionId,
  findReusableEmptySessionId,
} from '@/app/utils/projectSessionWorkspace';
import {
  clearDeferredNewSessionWorkspace,
  markDeferredNewSessionWorkspace,
} from '@/app/utils/deferredWorkspaceSession';
import { openMainSession } from '@/flow_chat/services/childSessionPanels';
import { useSessionModeStore } from '@/app/stores/sessionModeStore';
import { isRemoteWorkspace, type WorkspaceInfo } from '@/shared/types';
import { notificationService } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import './NewSessionDialog.scss';

const log = createLogger('NewSessionDialog');

const LS_AGENT = 'bitfun.newSessionDialog.agent';
const LS_WORKSPACE = 'bitfun.newSessionDialog.workspaceId';
const BROWSED_WORKSPACE_VALUE = '__browsed_workspace__';

export type NewSessionAgentChoice = 'agentic' | 'Cowork' | 'Design' | 'DeepResearch' | 'LiveAppStudio' | 'AgentAppStudio' | (string & {});

export interface NewSessionDialogProps {
  open: boolean;
  onClose: () => void;
  initialAgentChoice?: NewSessionAgentChoice;
}

function sessionModeToChoice(mode: string | undefined): NewSessionAgentChoice {
  if (!mode || mode === 'Dispatcher') return 'agentic';
  const m = mode.toLowerCase();
  if (m === 'cowork') return 'Cowork';
  if (m === 'design') return 'Design';
  if (m === 'deepresearch') return 'DeepResearch';
  if (m === 'liveappstudio') return 'LiveAppStudio';
  if (m === 'agentappstudio') return 'AgentAppStudio';
  return 'agentic';
}

function pickDefaultWorkspaceId(
  opened: WorkspaceInfo[],
  recent: WorkspaceInfo[],
  current: WorkspaceInfo | null,
  storedId: string | null
): string | null {
  if (storedId && opened.some(w => w.id === storedId)) {
    return storedId;
  }
  for (const r of recent) {
    if (opened.some(w => w.id === r.id)) {
      return r.id;
    }
  }
  if (current && opened.some(w => w.id === current.id)) {
    return current.id;
  }
  return opened[0]?.id ?? null;
}

function normalizeWorkspacePath(path: string): string {
  return path.trim().replace(/\\/g, '/');
}

function findOpenedWorkspaceByPath(
  openedWorkspaces: WorkspaceInfo[],
  path: string
): WorkspaceInfo | undefined {
  const normalizedPath = normalizeWorkspacePath(path);
  return openedWorkspaces.find(
    workspace => normalizeWorkspacePath(workspace.rootPath) === normalizedPath
  );
}

function getBrowsedWorkspaceLabel(path: string): string {
  const segments = path.split(/[\\/]+/).filter(Boolean);
  const name = segments[segments.length - 1] || path;
  return `${name} (${path})`;
}

function resolveModeFromChoice(agentChoice: NewSessionAgentChoice): string {
  return agentChoice === 'agentic'
    ? 'agentic'
    : agentChoice === 'Cowork'
      ? 'Cowork'
      : agentChoice === 'Design'
        ? 'Design'
        : agentChoice === 'DeepResearch'
          ? 'DeepResearch'
          : agentChoice === 'LiveAppStudio'
            ? 'LiveAppStudio'
            : agentChoice;
}

function syncSessionModeStore(mode: string): void {
  if (mode === 'Cowork') {
    useSessionModeStore.getState().setMode('cowork');
  } else if (mode === 'Design') {
    useSessionModeStore.getState().setMode('design');
  } else if (mode === 'LiveAppStudio') {
    useSessionModeStore.getState().setMode('liveappstudio');
  } else if (mode === 'AgentAppStudio') {
    useSessionModeStore.getState().setMode('agentappstudio');
  } else {
    useSessionModeStore.getState().setMode('code');
  }
}

// Re-exported for other modules; HMR is fine without fast-refresh for this non-component.
// eslint-disable-next-line react-refresh/only-export-components
export async function launchSessionForChoice(params: {
  agentChoice: NewSessionAgentChoice;
  /** Not used when `agentChoice` is `LiveAppStudio` (global `agentic_os` session). */
  workspace: WorkspaceInfo | null;
  rememberWorkspace: (workspaceId: string) => Promise<WorkspaceInfo>;
}): Promise<void> {
  const { agentChoice, workspace, rememberWorkspace } = params;
  const resolvedMode = resolveModeFromChoice(agentChoice);

  syncSessionModeStore(resolvedMode);

  if (agentChoice === 'LiveAppStudio' || agentChoice === 'AgentAppStudio') {
    if (agentChoice === 'AgentAppStudio') {
      const newId = await flowChatManager.createChatSession(
        { storageScope: 'agentic_os' },
        resolvedMode
      );
      await openMainSession(newId);
      return;
    }
    const reusableId = findReusableEmptyLiveAppStudioSessionId();
    if (reusableId) {
      await openMainSession(reusableId);
      return;
    }
    const newId = await flowChatManager.createChatSession(
      { storageScope: 'agentic_os' },
      resolvedMode
    );
    await openMainSession(newId);
    return;
  }

  if (!workspace) {
    throw new Error('Workspace is required for this session mode');
  }

  const reusableId = findReusableEmptySessionId(workspace, resolvedMode);
  if (reusableId) {
    await openMainSession(reusableId, {
      workspaceId: workspace.id,
      activateWorkspace: rememberWorkspace,
    });
    return;
  }

  await flowChatManager.createChatSession(
    {
      workspacePath: workspace.rootPath,
      ...(isRemoteWorkspace(workspace) && workspace.connectionId
        ? { remoteConnectionId: workspace.connectionId }
        : {}),
      ...(isRemoteWorkspace(workspace) && workspace.sshHost
        ? { remoteSshHost: workspace.sshHost }
        : {}),
    },
    resolvedMode
  );
  await rememberWorkspace(workspace.id);
}

export const NewSessionDialog: React.FC<NewSessionDialogProps> = ({
  open: isOpen,
  onClose,
  initialAgentChoice,
}) => {
  const { t } = useI18n('common');
  const {
    openedWorkspacesList,
    recentWorkspaces,
    lastUsedWorkspace,
    rememberWorkspace,
    openWorkspace,
  } = useWorkspaceContext();

  const [agentChoice, setAgentChoice] = useState<NewSessionAgentChoice>('agentic');
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [browsedWorkspacePath, setBrowsedWorkspacePath] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const resetDefaults = useCallback(() => {
    let storedAgent: NewSessionAgentChoice | null = null;
    let storedWs: string | null = null;
    try {
      const a = localStorage.getItem(LS_AGENT) as NewSessionAgentChoice | null;
      if (a === 'agentic' || a === 'Cowork' || a === 'Design' || a === 'DeepResearch' || a === 'LiveAppStudio' || a === 'AgentAppStudio') {
        storedAgent = a;
      }
      const w = localStorage.getItem(LS_WORKSPACE);
      if (w) storedWs = w;
    } catch {
      /* ignore */
    }

    const activeId = flowChatStore.getState().activeSessionId;
    const active = activeId ? flowChatStore.getState().sessions.get(activeId) : undefined;
    const fromSession = sessionModeToChoice(active?.mode);

    setAgentChoice(initialAgentChoice ?? storedAgent ?? fromSession);
    setBrowsedWorkspacePath(null);
    setWorkspaceId(
      pickDefaultWorkspaceId(openedWorkspacesList, recentWorkspaces, lastUsedWorkspace, storedWs)
    );
  }, [lastUsedWorkspace, initialAgentChoice, openedWorkspacesList, recentWorkspaces]);

  useEffect(() => {
    if (!isOpen) return;
    resetDefaults();
  }, [isOpen, resetDefaults]);

  const workspaceOptions = useMemo(() => {
    const recentOrder = new Map(recentWorkspaces.map((w, i) => [w.id, i]));
    const sorted = [...openedWorkspacesList].sort((a, b) => {
      const ra = recentOrder.has(a.id) ? (recentOrder.get(a.id) as number) : 9999;
      const rb = recentOrder.has(b.id) ? (recentOrder.get(b.id) as number) : 9999;
      if (ra !== rb) return ra - rb;
      return getWorkspaceDisplayName(a).localeCompare(getWorkspaceDisplayName(b));
    });
    const options = sorted.map(w => ({
      label: getWorkspaceDisplayName(w),
      value: w.id,
    }));
    if (browsedWorkspacePath) {
      options.unshift({
        label: getBrowsedWorkspaceLabel(browsedWorkspacePath),
        value: BROWSED_WORKSPACE_VALUE,
      });
    }
    return options;
  }, [browsedWorkspacePath, openedWorkspacesList, recentWorkspaces]);

  const agentOptions = useMemo(
    () => [
      {
        value: 'agentic',
        label: t('nav.sessions.newCodeSession'),
      },
      {
        value: 'Cowork',
        label: t('nav.sessions.newCoworkSession'),
      },
      {
        value: 'Design',
        label: t('nav.sessions.newDesignSession'),
      },
      {
        value: 'DeepResearch',
        label: t('nav.sessions.newDeepResearchSession'),
      },
      {
        value: 'LiveAppStudio',
        label: t('nav.sessions.newLiveAppStudioSession'),
      },
      {
        value: 'AgentAppStudio',
        label: t('nav.sessions.newAgentAppStudioSession'),
      },
    ],
    [t]
  );

  const handleBrowse = useCallback(async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t('header.selectProjectDirectory'),
      });
      if (selected && typeof selected === 'string') {
        const openedWorkspace = findOpenedWorkspaceByPath(openedWorkspacesList, selected);
        if (openedWorkspace) {
          setBrowsedWorkspacePath(null);
          setWorkspaceId(openedWorkspace.id);
          return;
        }

        setBrowsedWorkspacePath(selected);
        setWorkspaceId(BROWSED_WORKSPACE_VALUE);
      }
    } catch (e) {
      log.error('Browse workspace failed', e);
      notificationService.error(
        e instanceof Error ? e.message : t('nav.workspaces.createSessionFailed'),
        { duration: 3000 }
      );
    }
  }, [openedWorkspacesList, t]);

  const handleConfirm = useCallback(async () => {
    if (agentChoice === 'LiveAppStudio' || agentChoice === 'AgentAppStudio') {
      setSubmitting(true);
      try {
        await launchSessionForChoice({ agentChoice, workspace: null, rememberWorkspace });
        try {
          localStorage.setItem(LS_AGENT, agentChoice);
        } catch {
          /* ignore */
        }
        onClose();
      } catch (e) {
        log.error('Create session from dialog failed', e);
        notificationService.error(
          e instanceof Error ? e.message : t('nav.workspaces.createSessionFailed'),
          { duration: 4000 }
        );
      } finally {
        setSubmitting(false);
      }
      return;
    }

    let workspace = openedWorkspacesList.find(w => w.id === workspaceId);
    const shouldOpenBrowsedWorkspace =
      workspaceId === BROWSED_WORKSPACE_VALUE && !!browsedWorkspacePath;

    if (!workspace && !shouldOpenBrowsedWorkspace) {
      notificationService.error(t('nav.sessionCapsule.workspaceMissing'), { duration: 4000 });
      return;
    }

    setSubmitting(true);
    let openedBrowsedWorkspace = false;
    try {
      if (!workspace && browsedWorkspacePath) {
        markDeferredNewSessionWorkspace(browsedWorkspacePath);
        workspace = await openWorkspace(browsedWorkspacePath);
        openedBrowsedWorkspace = true;
      }

      if (!workspace) {
        notificationService.error(t('nav.sessionCapsule.workspaceMissing'), { duration: 4000 });
        return;
      }

      await launchSessionForChoice({ agentChoice, workspace, rememberWorkspace });

      try {
        localStorage.setItem(LS_AGENT, agentChoice);
        localStorage.setItem(LS_WORKSPACE, workspace.id);
      } catch {
        /* ignore */
      }

      onClose();
    } catch (e) {
      log.error('Create session from dialog failed', e);
      notificationService.error(
        e instanceof Error ? e.message : t('nav.workspaces.createSessionFailed'),
        { duration: 4000 }
      );
      if (!openedBrowsedWorkspace && browsedWorkspacePath) {
        clearDeferredNewSessionWorkspace(browsedWorkspacePath);
      }
    } finally {
      setSubmitting(false);
    }
  }, [
    agentChoice,
    browsedWorkspacePath,
    onClose,
    openWorkspace,
    openedWorkspacesList,
    rememberWorkspace,
    t,
    workspaceId,
  ]);

  const noWorkspaces = workspaceOptions.length === 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('nav.sessionCapsule.newSessionDialogTitle')}
      size="medium"
      contentInset
      contentClassName="new-session-dialog__modal-surface"
      overlayClassName="new-session-dialog-overlay"
      showCloseButton
      closeOnOverlayClick={false}
    >
      <div className="new-session-dialog">
        <header className="new-session-dialog__masthead">
          <p className="new-session-dialog__lede">{t('nav.sessionCapsule.newSessionLede')}</p>
        </header>

        <div className="new-session-dialog__card">
          <section className="new-session-dialog__section" aria-labelledby="new-session-agent-heading">
            <div className="new-session-dialog__section-head">
              <span className="new-session-dialog__index" aria-hidden>
                01
              </span>
              <h2 className="new-session-dialog__section-title" id="new-session-agent-heading">
                {t('nav.sessionCapsule.newSessionSectionAgent')}
              </h2>
            </div>
            <div className="new-session-dialog__control">
              <Select
                size="medium"
                options={agentOptions}
                value={agentChoice}
                onChange={v => setAgentChoice(v as NewSessionAgentChoice)}
                searchable={false}
              />
            </div>
          </section>

          {agentChoice !== 'LiveAppStudio' && agentChoice !== 'AgentAppStudio' && (
            <>
              <div className="new-session-dialog__divider" role="presentation" />

              <section className="new-session-dialog__section" aria-labelledby="new-session-ws-heading">
                <div className="new-session-dialog__section-head">
                  <span className="new-session-dialog__index" aria-hidden>
                    02
                  </span>
                  <h2 className="new-session-dialog__section-title" id="new-session-ws-heading">
                    {t('nav.sessionCapsule.newSessionSectionWorkspace')}
                  </h2>
                </div>
                <div className="new-session-dialog__workspace-row">
                  <div className="new-session-dialog__workspace-select">
                    <Select
                      size="medium"
                      options={workspaceOptions}
                      value={workspaceId ?? ''}
                      onChange={v => {
                        const selectedValue = String(v);
                        setWorkspaceId(selectedValue);
                        if (selectedValue !== BROWSED_WORKSPACE_VALUE) {
                          setBrowsedWorkspacePath(null);
                        }
                      }}
                      placeholder={t('nav.sessionCapsule.workspacePlaceholder')}
                      disabled={noWorkspaces}
                      searchable
                      emptyText={t('nav.sessionCapsule.noOpenWorkspace')}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="dashed"
                    size="medium"
                    className="new-session-dialog__browse"
                    onClick={() => void handleBrowse()}
                  >
                    <FolderOpen size={16} aria-hidden />
                    {t('nav.sessionCapsule.browseWorkspace')}
                  </Button>
                </div>
              </section>
            </>
          )}
        </div>

        <footer className="new-session-dialog__actions">
          <Button type="button" variant="ghost" size="medium" onClick={onClose} disabled={submitting}>
            {t('nav.sessions.cancelEdit')}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="medium"
            isLoading={submitting}
            onClick={() => void handleConfirm()}
            disabled={submitting || (agentChoice !== 'LiveAppStudio' && agentChoice !== 'AgentAppStudio' && (!workspaceId || noWorkspaces))}
          >
            {t('nav.sessionCapsule.confirmCreate')}
          </Button>
        </footer>
      </div>
    </Modal>
  );
};
