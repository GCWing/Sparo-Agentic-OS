import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bot, Brush, Folder, FolderOpen, MoreHorizontal, FolderSearch, Plus, ChevronDown, Copy, FileText } from 'lucide-react';
import { DotMatrixArrowRightIcon } from './DotMatrixArrowRightIcon';
import { Tooltip } from '@/component-library';
import { useI18n } from '@/infrastructure/i18n';
import { i18nService } from '@/infrastructure/i18n';
import { ACPClientAPI, type AcpClientInfo } from '@/infrastructure/api/service-api/ACPClientAPI';
import { useWorkspaceContext } from '@/infrastructure/contexts/WorkspaceContext';
import { useNavSceneStore } from '@/app/stores/navSceneStore';
import { useApp } from '@/app/hooks/useApp';
import { workspaceAPI } from '@/infrastructure/api';
import { notificationService } from '@/shared/notification-system';
import { flowChatManager } from '@/flow_chat/services/FlowChatManager';
import { openMainSession } from '@/flow_chat/services/childSessionPanels';
import { findReusableEmptySessionId } from '@/app/utils/projectSessionWorkspace';
import SessionList from '@/app/components/SessionList/SessionList';
import {
  isRemoteWorkspace,
  type WorkspaceInfo,
} from '@/shared/types';
import { SSHContext } from '@/features/ssh-remote/SSHRemoteContext';
import { acpClientIdFromAgentType, isAcpAgentType } from '@/flow_chat/utils/acpSession';

interface WorkspaceItemProps {
  workspace: WorkspaceInfo;
  isActive: boolean;
  isSingle?: boolean;
  draggable?: boolean;
  isDragging?: boolean;
  onDragStart?: React.DragEventHandler<HTMLDivElement>;
  onDragEnd?: React.DragEventHandler<HTMLDivElement>;
}

const WorkspaceItem: React.FC<WorkspaceItemProps> = ({
  workspace,
  isActive,
  isSingle = false,
  draggable = false,
  isDragging = false,
  onDragStart,
  onDragEnd,
}) => {
  const { t } = useI18n('common');
  const {
    rememberWorkspace,
    closeWorkspaceById,
  } = useWorkspaceContext();
  const { switchLeftPanelTab } = useApp();
  const openNavScene = useNavSceneStore(s => s.openNavScene);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sessionsCollapsed, setSessionsCollapsed] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuAnchorRef = useRef<HTMLDivElement>(null);
  const menuPopoverRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [acpClients, setAcpClients] = useState<AcpClientInfo[]>([]);
  const workspaceDisplayName = workspace.name;
  // Remote connection status — optional: safe if not inside SSHRemoteProvider
  const sshContext = useContext(SSHContext);
  const remoteConnStatus = workspace.connectionId && sshContext
    ? (sshContext.workspaceStatuses[workspace.connectionId] ?? 'connecting')
    : undefined;

  const updateMenuPosition = useCallback(() => {
    const anchor = menuAnchorRef.current;
    if (!anchor) return;

    const rect = anchor.getBoundingClientRect();
    const viewportPadding = 8;
    const estimatedWidth = 240;
    const maxLeft = window.innerWidth - estimatedWidth - viewportPadding;

    setMenuPosition({
      top: Math.max(viewportPadding, rect.bottom + 6),
      left: Math.max(viewportPadding, Math.min(rect.left, maxLeft)),
    });
  }, []);

  const loadAcpClients = useCallback(async () => {
    try {
      const clients = await ACPClientAPI.getClients();
      setAcpClients(
        clients
          .filter(client => client.enabled)
          .sort((left, right) => {
            const leftName = left.name?.trim() || left.id;
            const rightName = right.name?.trim() || right.id;
            return leftName.localeCompare(rightName);
          })
      );
    } catch (error) {
      setAcpClients([]);
    }
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const handleOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const isInsideTriggerArea = menuRef.current?.contains(target);
      const isInsidePopover = menuPopoverRef.current?.contains(target);
      if (!isInsideTriggerArea && !isInsidePopover) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;

    updateMenuPosition();

    const handleViewportChange = () => updateMenuPosition();
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);

    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [menuOpen, updateMenuPosition]);

  useEffect(() => {
    void loadAcpClients();

    const handleClientsChanged = () => {
      void loadAcpClients();
    };

    window.addEventListener('bitfun:acp-clients-changed', handleClientsChanged);
    return () => {
      window.removeEventListener('bitfun:acp-clients-changed', handleClientsChanged);
    };
  }, [loadAcpClients]);

  const handleActivate = useCallback(async () => {
    if (!isActive) {
      await rememberWorkspace(workspace.id);
    }
  }, [isActive, rememberWorkspace, workspace.id]);

  const handleCollapseToggle = useCallback(() => {
    setSessionsCollapsed(prev => !prev);
  }, []);

  const handleCardNameClick = useCallback(async () => {
    if (!isActive) {
      await rememberWorkspace(workspace.id);
    } else {
      setSessionsCollapsed(prev => !prev);
    }
  }, [isActive, rememberWorkspace, workspace.id]);

  const handleCloseWorkspace = useCallback(async () => {
    setMenuOpen(false);
    try {
      await closeWorkspaceById(workspace.id);
    } catch (error) {
      notificationService.error(
        error instanceof Error ? error.message : t('nav.workspaces.closeFailed'),
        { duration: 4000 }
      );
    }
  }, [closeWorkspaceById, t, workspace.id]);

  const handleReveal = useCallback(async () => {
    setMenuOpen(false);
    if (isRemoteWorkspace(workspace)) return;
    try {
      await workspaceAPI.revealInExplorer(workspace.rootPath);
    } catch (error) {
      notificationService.error(
        error instanceof Error ? error.message : t('nav.workspaces.revealFailed'),
        { duration: 4000 }
      );
    }
  }, [t, workspace]);

  const handleCopyWorkspacePath = useCallback(async () => {
    setMenuOpen(false);
    const path = workspace.rootPath;
    if (!path) return;
    try {
      await navigator.clipboard.writeText(path);
      notificationService.success(t('contextMenu.status.copyPathSuccess'), { duration: 2000 });
    } catch (error) {
      notificationService.error(
        error instanceof Error ? error.message : t('nav.workspaces.copyPathFailed'),
        { duration: 4000 }
      );
    }
  }, [t, workspace.rootPath]);

  const handleCreateSession = useCallback(async (mode?: string) => {
    setMenuOpen(false);
    const resolvedMode = mode;
    try {
      const reusableId = findReusableEmptySessionId(workspace, resolvedMode);
      if (reusableId) {
        await openMainSession(reusableId, {
          workspaceId: workspace.id,
          activateWorkspace: rememberWorkspace,
        });
        return;
      }
      const sessionConfig = {
        workspacePath: workspace.rootPath,
        ...(isRemoteWorkspace(workspace) && workspace.connectionId
          ? { remoteConnectionId: workspace.connectionId }
          : {}),
        ...(isRemoteWorkspace(workspace) && workspace.sshHost
          ? { remoteSshHost: workspace.sshHost }
          : {}),
      };
      const newSessionId = isAcpAgentType(resolvedMode)
        ? await (() => {
            const clientId = acpClientIdFromAgentType(resolvedMode);
            if (!clientId) {
              throw new Error(`Invalid ACP agent type: ${resolvedMode}`);
            }
            return flowChatManager.createAcpChatSession(clientId, sessionConfig);
          })()
        : await flowChatManager.createChatSession(sessionConfig, resolvedMode);
      await openMainSession(newSessionId, {
        workspaceId: workspace.id,
        activateWorkspace: rememberWorkspace,
      });
    } catch (error) {
      notificationService.error(
        error instanceof Error ? error.message : t('nav.workspaces.createSessionFailed'),
        { duration: 4000 }
      );
    }
  }, [
    rememberWorkspace,
    t,
    workspace,
  ]);

  const handleCreateCodeSession = useCallback(() => {
    void handleCreateSession('agentic');
  }, [handleCreateSession]);

  const handleCreateCoworkSession = useCallback(() => {
    void handleCreateSession('Cowork');
  }, [handleCreateSession]);

  const handleCreateDesignSession = useCallback(() => {
    void handleCreateSession('Design');
  }, [handleCreateSession]);

  const handleCreateAcpSession = useCallback((clientId: string) => {
    void handleCreateSession(`acp:${clientId}`);
  }, [handleCreateSession]);

  const acpMenuItems = useMemo(
    () =>
      acpClients.map(client => ({
        id: client.id,
        label: t('nav.sessions.newExternalAgentSessionShort', {
          agentName: client.name?.trim() || client.id,
        }),
      })),
    [acpClients, t]
  );

  const handleCreateInitSession = useCallback(async () => {
    setMenuOpen(false);

    try {
      const sessionId = await flowChatManager.createChatSession(
        {
          workspacePath: workspace.rootPath,
          ...(isRemoteWorkspace(workspace) && workspace.connectionId
            ? { remoteConnectionId: workspace.connectionId }
            : {}),
          ...(isRemoteWorkspace(workspace) && workspace.sshHost
            ? { remoteSshHost: workspace.sshHost }
            : {}),
        },
        'Init'
      );

      await openMainSession(sessionId, {
        workspaceId: workspace.id,
        activateWorkspace: rememberWorkspace,
      });

      const initPrompt = i18nService.t('flow-chat:chatInput.initPrompt', {
        defaultValue: 'Please generate or update AGENTS.md so it matches the current project. Write it in English and keep the English version complete.',
      });

      await flowChatManager.sendMessage(initPrompt, sessionId, initPrompt, 'Init');
    } catch (error) {
      notificationService.error(
        error instanceof Error ? error.message : t('nav.workspaces.initSessionFailed'),
        { duration: 4000 }
      );
    }
  }, [rememberWorkspace, t, workspace]);

  const handleOpenFiles = useCallback(async () => {
    try {
      await handleActivate();
      switchLeftPanelTab('files');
      openNavScene('file-viewer');
    } catch (error) {
      notificationService.error(
        error instanceof Error ? error.message : t('nav.workspaces.revealFailed'),
        { duration: 4000 }
      );
    }
  }, [handleActivate, openNavScene, switchLeftPanelTab, t]);

  return (
    <div className={[
      'bitfun-nav-panel__workspace-item',
      isActive && 'is-active',
      isDragging && 'is-dragging',
      menuOpen && 'is-menu-open',
      sessionsCollapsed && 'is-sessions-collapsed',
      isSingle && 'is-single',
    ].filter(Boolean).join(' ')}
    aria-current={isActive ? 'location' : undefined}
    aria-grabbed={draggable ? isDragging : undefined}>
      <div
        className="bitfun-nav-panel__workspace-item-card"
        draggable={draggable}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <button
          type="button"
          className="bitfun-nav-panel__workspace-item-collapse-btn"
          onClick={handleCollapseToggle}
          aria-label={sessionsCollapsed ? t('nav.workspaces.expandSessions') : t('nav.workspaces.collapseSessions')}
          aria-expanded={!sessionsCollapsed}
        >
          <span className="bitfun-nav-panel__workspace-item-icon" aria-hidden="true">
            <span className="bitfun-nav-panel__workspace-item-icon-default">
              {isActive ? (
                <span className="bitfun-nav-panel__workspace-item-active-icon">
                  <DotMatrixArrowRightIcon size={14} />
                </span>
              ) : (
                <FolderOpen size={14} />
              )}
            </span>
            <span className={`bitfun-nav-panel__workspace-item-icon-toggle${sessionsCollapsed ? ' is-collapsed' : ''}`}>
              <ChevronDown size={14} />
            </span>
          </span>
        </button>
        <button
          type="button"
          className="bitfun-nav-panel__workspace-item-name-btn"
          onClick={() => { void handleCardNameClick(); }}
        >
          <span className={`bitfun-nav-panel__workspace-item-title${isRemoteWorkspace(workspace) ? ' is-remote' : ''}`}>
            <span className="bitfun-nav-panel__workspace-item-label">{workspaceDisplayName}</span>
            {isRemoteWorkspace(workspace) && (
              <span className="bitfun-nav-panel__workspace-item-subtitle">
                <span
                  className={`bitfun-nav-panel__workspace-item-status-dot is-${remoteConnStatus ?? 'connecting'}`}
                  aria-label={remoteConnStatus ?? 'connecting'}
                />
                <span>{workspace.connectionName}</span>
              </span>
            )}
          </span>
        </button>

        <div className="bitfun-nav-panel__workspace-item-menu" ref={menuRef}>
          <Tooltip content={t('nav.items.project')} placement="right" followCursor>
            <button
              type="button"
              className="bitfun-nav-panel__workspace-item-menu-trigger"
              onClick={() => { void handleOpenFiles(); }}
            >
              <Folder size={14} />
            </button>
          </Tooltip>
          <div ref={menuAnchorRef}>
            <button
              type="button"
              className={`bitfun-nav-panel__workspace-item-menu-trigger${menuOpen ? ' is-open' : ''}`}
              onClick={() => setMenuOpen(prev => !prev)}
            >
              <MoreHorizontal size={14} />
            </button>
          </div>

          {menuOpen && menuPosition && createPortal(
            <div
              ref={menuPopoverRef}
              className="bitfun-nav-panel__workspace-item-menu-popover"
              role="menu"
              style={{ top: `${menuPosition.top}px`, left: `${menuPosition.left}px` }}
            >
              <button type="button" className="bitfun-nav-panel__workspace-item-menu-item" onClick={handleCreateCodeSession}>
                <Plus size={13} />
                <span className="bitfun-nav-panel__workspace-item-menu-label">{t('nav.sessions.newCodeSessionShort')}</span>
              </button>
              <button type="button" className="bitfun-nav-panel__workspace-item-menu-item" onClick={handleCreateCoworkSession}>
                <Plus size={13} />
                <span className="bitfun-nav-panel__workspace-item-menu-label">{t('nav.sessions.newCoworkSessionShort')}</span>
              </button>
              <button type="button" className="bitfun-nav-panel__workspace-item-menu-item" onClick={handleCreateDesignSession}>
                <Brush size={13} />
                <span className="bitfun-nav-panel__workspace-item-menu-label">{t('nav.sessions.newDesignSessionShort')}</span>
              </button>
              {acpMenuItems.map(client => (
                <button
                  key={client.id}
                  type="button"
                  className="bitfun-nav-panel__workspace-item-menu-item"
                  onClick={() => handleCreateAcpSession(client.id)}
                >
                  <Bot size={13} />
                  <span className="bitfun-nav-panel__workspace-item-menu-label">{client.label}</span>
                </button>
              ))}
              <button type="button" className="bitfun-nav-panel__workspace-item-menu-item" onClick={() => { void handleCreateInitSession(); }}>
                <FileText size={13} />
                <span className="bitfun-nav-panel__workspace-item-menu-label">{t('nav.workspaces.actions.initAgents')}</span>
              </button>
              <div className="bitfun-nav-panel__workspace-item-menu-divider" />
              <button
                type="button"
                className="bitfun-nav-panel__workspace-item-menu-item"
                onClick={() => { void handleCopyWorkspacePath(); }}
                disabled={!workspace.rootPath}
              >
                <Copy size={13} />
                <span className="bitfun-nav-panel__workspace-item-menu-label">{t('nav.workspaces.actions.copyPath')}</span>
              </button>
              <button
                type="button"
                className="bitfun-nav-panel__workspace-item-menu-item"
                onClick={() => { void handleReveal(); }}
                disabled={isRemoteWorkspace(workspace)}
              >
                <FolderSearch size={13} />
                <span className="bitfun-nav-panel__workspace-item-menu-label">{t('nav.workspaces.actions.reveal')}</span>
              </button>
              <div className="bitfun-nav-panel__workspace-item-menu-divider" />
              <button type="button" className="bitfun-nav-panel__workspace-item-menu-item is-danger" onClick={() => { void handleCloseWorkspace(); }}>
                <FolderOpen size={13} />
                <span className="bitfun-nav-panel__workspace-item-menu-label">{t('nav.workspaces.actions.close')}</span>
              </button>
            </div>,
            document.body
          )}
        </div>
      </div>

      <div className={`bitfun-nav-panel__workspace-item-sessions${sessionsCollapsed ? ' is-collapsed' : ''}`}>
        <SessionList
          workspaceId={workspace.id}
          workspacePath={workspace.rootPath}
          remoteConnectionId={isRemoteWorkspace(workspace) ? workspace.connectionId : null}
          remoteSshHost={isRemoteWorkspace(workspace) ? workspace.sshHost : null}
          isActiveWorkspace={isActive}
        />
      </div>

    </div>
  );
};

export default WorkspaceItem;
