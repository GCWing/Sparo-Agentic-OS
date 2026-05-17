/**
 * FileViewerNav �?scene-specific navigation for the file viewer scene.
 *
 * Header mirrors the directory NavItem (Folder icon + label, same font-size /
 * height / padding) so the transition feels like the item "expanded in-place".
 * Navigation back is handled by the Home button in UnifiedTopBar.
 */

import React, { useState, useCallback } from 'react';
import { Folder, Search as SearchIcon, List, FilePlus, FolderPlus, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLastUsedWorkspace } from '../../../infrastructure/contexts/WorkspaceContext';
import { useI18n } from '@/infrastructure/i18n';
import { Badge, IconButton, Tooltip } from '@/design-system';
import type { FileExplorerToolbarHandlers } from '@/tools/file-system';
import FilesPanel from '../../components/panels/FilesPanel';
import './FileViewerNav.scss';

const FileViewerNav: React.FC = () => {
  const { workspace: lastUsedWorkspace } = useLastUsedWorkspace();
  const { t } = useI18n('common');
  const { t: tTools } = useI18n('tools');
  const { t: tFiles } = useTranslation('panels/files');
  const [viewMode, setViewMode] = useState<'tree' | 'search'>('tree');
  const [explorerToolbar, setExplorerToolbar] = useState<FileExplorerToolbarHandlers | null>(null);
  const workspacePath = lastUsedWorkspace?.rootPath;
  const viewModeLabel = viewMode === 'tree' ? tFiles('title') : tFiles('search.placeholder');

  const handleToggleViewMode = useCallback(() => {
    setViewMode(prev => prev === 'tree' ? 'search' : 'tree');
  }, []);

  return (
    <div className="sparo-file-viewer-nav">
      <div className="sparo-file-viewer-nav__header">
        <span className="sparo-file-viewer-nav__icon" aria-hidden="true">
          <Folder size={15} />
        </span>
        <Tooltip content={workspacePath} placement="bottom" disabled={!workspacePath}>
          <span className="sparo-file-viewer-nav__label">
            {t('nav.items.project')}
          </span>
        </Tooltip>
        {workspacePath && (
          <span className="sparo-file-viewer-nav__actions">
            <Badge variant={viewMode === 'tree' ? 'neutral' : 'info'} className="sparo-file-viewer-nav__mode-badge">
              {viewModeLabel}
            </Badge>
            {viewMode === 'tree' && explorerToolbar && (
              <>
                <IconButton
                  aria-label={tTools('fileTree.newFile')}
                  size="xs"
                  variant="ghost"
                  onClick={explorerToolbar.onNewFile}
                  tooltip={tTools('fileTree.newFile')}
                  tooltipPlacement="bottom"
                >
                  <FilePlus size={14} />
                </IconButton>
                <IconButton
                  aria-label={tTools('fileTree.newFolder')}
                  size="xs"
                  variant="ghost"
                  onClick={explorerToolbar.onNewFolder}
                  tooltip={tTools('fileTree.newFolder')}
                  tooltipPlacement="bottom"
                >
                  <FolderPlus size={14} />
                </IconButton>
                <IconButton
                  aria-label={tTools('fileTree.refresh')}
                  size="xs"
                  variant="ghost"
                  onClick={explorerToolbar.onRefresh}
                  tooltip={tTools('fileTree.refresh')}
                  tooltipPlacement="bottom"
                >
                  <RefreshCw size={14} />
                </IconButton>
              </>
            )}
            <IconButton
              aria-label={viewMode === 'tree' ? tFiles('actions.switchToSearch') : tFiles('actions.switchToTree')}
              size="xs"
              variant="ghost"
              onClick={handleToggleViewMode}
              tooltip={viewMode === 'tree' ? tFiles('actions.switchToSearch') : tFiles('actions.switchToTree')}
              tooltipPlacement="bottom"
            >
              {viewMode === 'tree' ? <SearchIcon size={14} /> : <List size={14} />}
            </IconButton>
          </span>
        )}
      </div>
      <FilesPanel
        workspacePath={workspacePath}
        hideHeader
        hideExplorerToolbar
        onExplorerToolbarApi={setExplorerToolbar}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />
    </div>
  );
};

export default FileViewerNav;
