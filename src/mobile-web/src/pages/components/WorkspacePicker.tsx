import React, { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { RemoteSessionManager, type RecentWorkspaceEntry } from '../../services/RemoteSessionManager';
import { useMobileStore } from '../../services/store';
import HairlineDivider from '../../components/HairlineDivider';
import EyebrowLabel from '../../components/EyebrowLabel';
import './WorkspacePicker.scss';

interface WorkspacePickerProps {
  sessionMgr: RemoteSessionManager;
  onDone?: () => void;
}

const WorkspacePicker: React.FC<WorkspacePickerProps> = ({ sessionMgr, onDone }) => {
  const { t } = useI18n();
  const { selectedWorkspace, setSelectedWorkspace } = useMobileStore();
  const [list, setList] = useState<RecentWorkspaceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const ws = await sessionMgr.listRecentWorkspaces();
        setList(ws);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [sessionMgr]);

  const handleSelect = useCallback(async (ws: RecentWorkspaceEntry) => {
    if (switching) return;
    setSwitching(true);
    setError(null);
    try {
      const result = await sessionMgr.setWorkspace(ws.path);
      if (result.success) {
        setSelectedWorkspace({
          has_workspace: true,
          path: result.path || ws.path,
          project_name: result.project_name || ws.name,
        });
        onDone?.();
      } else {
        setError(result.error || t('workspace.failedToSetWorkspace'));
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSwitching(false);
    }
  }, [switching, sessionMgr, setSelectedWorkspace, onDone, t]);

  if (loading) {
    return <div className="workspace-picker__loading">{t('common.loading')}</div>;
  }

  return (
    <div className="workspace-picker">
      <div className="workspace-picker__head">
        <EyebrowLabel>{t('workspace.recentWorkspaces')}</EyebrowLabel>
      </div>
      <HairlineDivider />

      {list.length === 0 && (
        <div className="workspace-picker__empty">{t('workspace.noRecentWorkspaces')}</div>
      )}

      {list.map((ws) => (
        <React.Fragment key={ws.path}>
          <button
            type="button"
            className={`workspace-picker__item${selectedWorkspace?.path === ws.path ? ' is-current' : ''}`}
            onClick={() => void handleSelect(ws)}
            disabled={switching}
          >
            <div className="workspace-picker__item-name">{ws.name}</div>
            <div className="workspace-picker__item-path">{ws.path}</div>
            {selectedWorkspace?.path === ws.path && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>
          <HairlineDivider />
        </React.Fragment>
      ))}

      {error && <div className="workspace-picker__error">{error}</div>}
    </div>
  );
};

export default WorkspacePicker;
