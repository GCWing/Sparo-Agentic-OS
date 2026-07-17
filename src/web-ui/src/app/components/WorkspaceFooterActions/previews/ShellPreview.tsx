import React, { useCallback, useEffect, useMemo } from 'react';
import { Bot, Play, Plus, SquareTerminal } from 'lucide-react';
import { IconButton } from '@/design-system';
import { useWorkspaceContext } from '@/infrastructure/contexts/WorkspaceContext';
import { configManager } from '@/infrastructure/config/services/ConfigManager';
import type { TerminalConfig } from '@/infrastructure/config/types';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';
import { openShellSessionTarget } from '@/shared/services/openShellSessionTarget';
import { createLogger } from '@/shared/utils/logger';
import { getTerminalService } from '@/tools/terminal';
import { listManualTerminalProfiles, type ManualTerminalProfile } from '@/tools/terminal/services/manualTerminalProfileService';
import type { SessionResponse } from '@/tools/terminal/types/session';
import { isSessionRunning } from '@/app/scenes/shell/hooks/shellEntryTypes';
import {
  WorkspaceHubPreviewEmpty,
  WorkspaceHubPreviewError,
  WorkspaceHubPreviewFrame,
  WorkspaceHubPreviewLoading,
  WorkspaceHubPreviewRow,
  WorkspaceHubPreviewSection,
} from './WorkspaceHubPreviewFrame';
import type { WorkspaceHubPreviewProps } from './workspaceHubPreviewTypes';
import { useHubPreviewResource } from './useHubPreviewResource';
import './ShellPreview.scss';

const log = createLogger('WorkspaceHubShellPreview');

async function loadTerminalSessions(): Promise<SessionResponse[]> {
  const service = getTerminalService();
  await service.connect();
  const sessions = await service.listSessions();
  return sessions.filter((session) => session.shellType !== 'Remote');
}

async function defaultShellType(): Promise<string | undefined> {
  try {
    const config = await configManager.getSetting<TerminalConfig>('core.terminal');
    return config?.default_shell || undefined;
  } catch {
    return undefined;
  }
}

const ShellPreview: React.FC<WorkspaceHubPreviewProps> = ({
  label,
  primaryActionRef,
  onOpenItem,
  onClose,
}) => {
  const { t } = useI18n('common');
  const { lastUsedWorkspace } = useWorkspaceContext();
  const sessions = useHubPreviewResource<SessionResponse[]>(
    'workspace-hub:shell:sessions',
    loadTerminalSessions,
    { ttlMs: 5_000 },
  );
  const savedProfiles = useMemo<ManualTerminalProfile[]>(
    () => lastUsedWorkspace?.rootPath
      ? listManualTerminalProfiles(lastUsedWorkspace.rootPath)
      : [],
    [lastUsedWorkspace?.rootPath],
  );
  const runningSessions = useMemo(
    () => (sessions.data ?? [])
      .filter(isSessionRunning)
      .sort((left, right) => left.name.localeCompare(right.name)),
    [sessions.data],
  );
  const initialLoading = sessions.loading && !sessions.data;
  const refreshSessions = sessions.refresh;

  useEffect(() => {
    const service = getTerminalService();
    return service.onEvent((event) => {
      if (event.type === 'ready' || event.type === 'exit') refreshSessions();
    });
  }, [refreshSessions]);

  const handleOpenSession = useCallback((session: SessionResponse) => {
    onClose();
    openShellSessionTarget({ sessionId: session.id, sessionName: session.name });
  }, [onClose]);

  const handleOpenProfile = useCallback((profile: ManualTerminalProfile) => {
    onClose();
    void (async () => {
      const service = getTerminalService();
      await service.connect();
      const current = (await service.listSessions()).find((session) => session.id === profile.sessionId);
      if (current && !isSessionRunning(current)) await service.closeSession(current.id);
      if (!current || !isSessionRunning(current)) {
        await service.createSession({
          sessionId: profile.sessionId,
          workingDirectory: profile.workingDirectory ?? lastUsedWorkspace?.rootPath,
          name: profile.name,
          shellType: profile.shellType ?? await defaultShellType(),
          source: 'manual',
        });
        if (profile.startupCommand?.trim()) {
          await new Promise((resolve) => window.setTimeout(resolve, 800));
          try {
            await service.sendCommand(profile.sessionId, profile.startupCommand);
          } catch (error) {
            log.warn('Failed to run saved terminal startup command', {
              sessionId: profile.sessionId,
              error,
            });
          }
        }
      }
      openShellSessionTarget({ sessionId: profile.sessionId, sessionName: profile.name });
    })().catch((error) => {
      log.error('Failed to open saved terminal from Workspace Hub', {
        sessionId: profile.sessionId,
        error,
      });
    });
  }, [lastUsedWorkspace?.rootPath, onClose]);

  const handleCreateTerminal = useCallback(() => {
    onClose();
    void (async () => {
      const service = getTerminalService();
      await service.connect();
      const current = await service.listSessions();
      const nextIndex = current.filter((session) => session.source === 'manual').length + 1;
      const session = await service.createSession({
        workingDirectory: lastUsedWorkspace?.rootPath,
        name: t('nav.menuPanel.hub.preview.shell.newSessionName', { count: nextIndex }),
        shellType: await defaultShellType(),
        source: 'manual',
      });
      openShellSessionTarget({ sessionId: session.id, sessionName: session.name });
    })().catch((error) => {
      log.error('Failed to create terminal from Workspace Hub', { error });
    });
  }, [lastUsedWorkspace?.rootPath, onClose, t]);

  return (
    <WorkspaceHubPreviewFrame
      title={label}
      className="sparo-workspace-hub-shell-preview"
      headerMeta={(
        <div className="sparo-workspace-hub-shell-preview__header-actions">
          <IconButton
            variant="ghost"
            size="medium"
            shape="circle"
            aria-label={t('nav.menuPanel.hub.preview.shell.actions.new')}
            tooltip={t('nav.menuPanel.hub.preview.shell.actions.new')}
            tooltipPlacement="top"
            onClick={handleCreateTerminal}
          >
            <Plus size={16} aria-hidden="true" />
          </IconButton>
          <IconButton
            ref={primaryActionRef}
            variant="brand"
            size="medium"
            shape="circle"
            aria-label={t('nav.menuPanel.hub.preview.shell.actions.open')}
            tooltip={t('nav.menuPanel.hub.preview.shell.actions.open')}
            tooltipPlacement="top"
            onClick={() => onOpenItem('shell')}
          >
            <SquareTerminal size={16} aria-hidden="true" />
          </IconButton>
        </div>
      )}
    >
      {initialLoading ? (
        <div className="sparo-workspace-hub-preview__wide">
          <WorkspaceHubPreviewLoading rows={2} />
        </div>
      ) : sessions.error && !sessions.data ? (
        <div className="sparo-workspace-hub-preview__wide">
          <WorkspaceHubPreviewError
            message={t('nav.menuPanel.hub.preview.shell.errors.sessions')}
            retryLabel={t('nav.menuPanel.hub.preview.common.retry')}
            onRetry={sessions.refresh}
          />
        </div>
      ) : (
        <div className="sparo-workspace-hub-preview__wide sparo-workspace-hub-shell-preview__body">
          {runningSessions.length > 0 && (
            <WorkspaceHubPreviewSection
              title={t('nav.menuPanel.hub.preview.shell.sections.running')}
              className="sparo-workspace-hub-shell-preview__running"
            >
              {runningSessions.slice(0, 2).map((session) => (
                <WorkspaceHubPreviewRow
                  key={session.id}
                  icon={session.source === 'agent' ? <Bot size={15} /> : <SquareTerminal size={15} />}
                  title={session.name}
                  trailing={session.shellType}
                  tooltip={session.cwd}
                  tone={session.source === 'agent' ? 'accent' : 'positive'}
                  onClick={() => handleOpenSession(session)}
                />
              ))}
            </WorkspaceHubPreviewSection>
          )}

          {savedProfiles.length > 0 && (
            <WorkspaceHubPreviewSection
              title={t('nav.menuPanel.hub.preview.shell.sections.saved')}
              className="sparo-workspace-hub-shell-preview__saved"
            >
              {savedProfiles.slice(0, 2).map((profile) => (
                <WorkspaceHubPreviewRow
                  key={profile.id}
                  icon={<Play size={15} />}
                  title={profile.name}
                  trailing={profile.shellType}
                  tooltip={profile.workingDirectory ?? lastUsedWorkspace?.rootPath}
                  tone="accent"
                  onClick={() => handleOpenProfile(profile)}
                />
              ))}
            </WorkspaceHubPreviewSection>
          )}

          {runningSessions.length === 0 && savedProfiles.length === 0 && (
            <div className="sparo-workspace-hub-shell-preview__empty">
              <WorkspaceHubPreviewEmpty
                title={t('nav.menuPanel.hub.preview.shell.empty.runningTitle')}
              />
            </div>
          )}
        </div>
      )}
    </WorkspaceHubPreviewFrame>
  );
};

export default ShellPreview;
