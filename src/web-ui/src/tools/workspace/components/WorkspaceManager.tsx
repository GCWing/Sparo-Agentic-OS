import React, { useState } from 'react';
import { FolderOpen, Clock } from 'lucide-react';
import { useWorkspaceContext } from '../../../infrastructure/contexts/WorkspaceContext';
import { WorkspaceInfo } from '../../../shared/types';
import { Button, Dialog, SelectableRow } from '@/design-system';
import { i18nService } from '@/infrastructure/i18n';
import { createLogger } from '@/shared/utils/logger';
import { getRecentWorkspaceLineParts } from '@/shared/utils/recentWorkspaceDisplay';
import './WorkspaceManager.css';

const log = createLogger('WorkspaceManager');

interface WorkspaceManagerProps {
  isVisible: boolean;
  onClose: () => void;
  onWorkspaceSelect?: (workspace: WorkspaceInfo) => void;
}

/**
 * Workspace management component.
 * Displays current workspace status and recent workspaces.
 */
const WorkspaceManager: React.FC<WorkspaceManagerProps> = ({
  isVisible,
  onClose,
  onWorkspaceSelect
}) => {
  const {
    lastUsedWorkspace,
    recentWorkspaces,
    loading,
    error,
    switchWorkspace,
    closeWorkspace,
    scanWorkspaceInfo
  } = useWorkspaceContext();

  const [scanning, setScanning] = useState(false);

  const getWorkspaceDisplayName = (workspace: WorkspaceInfo) => {
    const emoji = workspace.identity?.emoji?.trim();
    return emoji ? `${emoji} ${workspace.name}` : workspace.name;
  };

  const renderIdentityDetails = (workspace: WorkspaceInfo) => {
    const entries = [
      workspace.identity?.creature ? { label: 'Creature', value: workspace.identity.creature } : null,
      workspace.identity?.vibe ? { label: 'Vibe', value: workspace.identity.vibe } : null,
    ].filter(Boolean) as Array<{ label: string; value: string }>;

    if (entries.length === 0) {
      return null;
    }

    return (
      <div className="workspace-identity">
        {entries.map(entry => (
          <span key={entry.label} className="workspace-identity__item">
            <span className="workspace-identity__label">{entry.label}</span>
            <span className="workspace-identity__value">{entry.value}</span>
          </span>
        ))}
      </div>
    );
  };

  const handleWorkspaceSelect = async (workspace: WorkspaceInfo) => {
    try {
      await switchWorkspace(workspace);
      onWorkspaceSelect?.(workspace);
      onClose();
    } catch (err) {
      log.error('Failed to switch workspace', { workspaceId: workspace.id, error: err });
    }
  };

  const handleCloseWorkspace = async () => {
    try {
      await closeWorkspace();
    } catch (err) {
      log.error('Failed to close workspace', err);
    }
  };

  const handleScanWorkspace = async () => {
    try {
      setScanning(true);
      await scanWorkspaceInfo();
    } catch (err) {
      log.error('Failed to scan workspace', err);
    } finally {
      setScanning(false);
    }
  };

  const getWorkspaceIcon = (_workspace: WorkspaceInfo) => {
    return <FolderOpen size={16} />;
  };

  const formatDate = (dateStr: string) => {
    try {
      return i18nService.formatDate(new Date(dateStr), {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateStr;
    }
  };

  const renderWorkspaceTitle = (workspace: WorkspaceInfo) => {
    const { hostPrefix } = getRecentWorkspaceLineParts(workspace);
    return (
      <>
        {hostPrefix ? (
          <span className="workspace-name__ssh-host">{hostPrefix} · </span>
        ) : null}
        {getWorkspaceDisplayName(workspace)}
      </>
    );
  };

  return (
    <Dialog
      open={isVisible}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
      title="Workspace Status"
      size="medium"
    >
      <div className="workspace-manager">
        {error && (
          <div className="error-message">
            <span>Error: {error}</span>
          </div>
        )}

        <div className="current-workspace-section">
          <h3>Current Workspace</h3>
          {lastUsedWorkspace ? (
            <div className="workspace-card current">
              <div className="workspace-header">
                <div className="workspace-icon">
                  {getWorkspaceIcon(lastUsedWorkspace)}
                </div>
                <div className="workspace-info">
                  <div className="workspace-name">{getWorkspaceDisplayName(lastUsedWorkspace)}</div>
                  <div className="workspace-path">{lastUsedWorkspace.rootPath}</div>
                  <div className="workspace-meta">
                    {lastUsedWorkspace.lastAccessed && (
                      <span className="workspace-time">
                        <Clock size={12} />
                        {formatDate(lastUsedWorkspace.lastAccessed)}
                      </span>
                    )}
                  </div>
                  {renderIdentityDetails(lastUsedWorkspace)}
                </div>
              </div>
              
              <div className="workspace-actions">
                <Button
                  variant="secondary"
                  size="small"
                  onClick={handleScanWorkspace}
                  disabled={scanning}
                  isLoading={scanning}
                  loadingLabel="Scanning..."
                >
                  Rescan
                </Button>
                <Button
                  variant="danger"
                  size="small"
                  onClick={handleCloseWorkspace}
                  disabled={loading}
                >
                  Close Workspace
                </Button>
              </div>
            </div>
          ) : (
            <div className="no-workspace">
              <FolderOpen size={48} />
              <p>No workspace is currently open</p>
            </div>
          )}
        </div>

        <div className="recent-workspaces-section">
          <h3>Recent Workspaces</h3>
          {recentWorkspaces.length > 0 ? (
            <div className="workspace-list">
              {recentWorkspaces.map((workspace) => (
                <SelectableRow
                  key={workspace.id}
                  className="workspace-list-row"
                  onClick={() => handleWorkspaceSelect(workspace)}
                  leading={<span className="workspace-icon workspace-icon--row">{getWorkspaceIcon(workspace)}</span>}
                  title={renderWorkspaceTitle(workspace)}
                  description={(
                    <span className="workspace-list-row__description">
                      <span className="workspace-path workspace-path--row">{workspace.rootPath}</span>
                      {renderIdentityDetails(workspace)}
                    </span>
                  )}
                  meta={workspace.lastAccessed ? (
                    <span className="workspace-time">
                      <Clock size={12} />
                      {formatDate(workspace.lastAccessed)}
                    </span>
                  ) : undefined}
                />
              ))}
            </div>
          ) : (
            <div className="no-recent">
              <p>No recent workspaces</p>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
};

export default WorkspaceManager;
