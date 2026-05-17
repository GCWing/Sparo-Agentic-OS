/**
 * Design artifacts browser — lists all artifacts in the current workspace with
 * search, archive toggles, and quick "Open in Canvas" actions. Rendered as a
 * dedicated `design-artifacts-browser` Tab in the right panel.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import {
  Archive,
  ArchiveRestore,
  ExternalLink,
  RefreshCcw,
  Search,
  Palette,
} from 'lucide-react';
import { Badge, Button, Checkbox, IconButton, Input } from '@/design-system';
import { useDesignArtifactStore } from './store/designArtifactStore';
import { designArtifactAPI } from './api';
import { ideControl } from '@/shared/services/ide-control';
import { createLogger } from '@/shared/utils/logger';
import { useLastUsedWorkspace } from '@/infrastructure/contexts/WorkspaceContext';
import './DesignArtifactBrowser.scss';

const log = createLogger('DesignArtifactBrowser');

export interface DesignArtifactBrowserProps {
  workspacePath?: string;
}

export const DesignArtifactBrowser: React.FC<DesignArtifactBrowserProps> = ({ workspacePath }) => {
  const { t } = useTranslation('flow-chat');
  const { workspacePath: lastUsedWorkspacePath } = useLastUsedWorkspace();
  const manifests = useDesignArtifactStore(
    useShallow((s) =>
      Object.values(s.artifacts)
        .map((artifact) => artifact.manifest)
        .sort((left, right) => left.id.localeCompare(right.id))
    )
  );
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const effectiveWorkspacePath = workspacePath || lastUsedWorkspacePath;

  const refresh = useMemo(
    () => async () => {
      setIsLoading(true);
      try {
        await designArtifactAPI.list(effectiveWorkspacePath);
      } catch (err) {
        log.warn('Browser refresh failed', err);
      } finally {
        setIsLoading(false);
      }
    },
    [effectiveWorkspacePath]
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return manifests
      .filter((m) => (showArchived ? true : !m.archived_at))
      .filter((m) => {
        if (!q) return true;
        return (
          m.title.toLowerCase().includes(q) ||
          m.id.toLowerCase().includes(q) ||
          m.kind.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  }, [manifests, query, showArchived]);

  const openInCanvas = (id: string) => {
    const manifest = manifests.find((item) => item.id === id);
    if (!manifest) return;
    ideControl.panel.open('design-artifact', {
      position: 'right',
      config: {
        title: manifest.title,
        data: { artifactId: manifest.id, manifest },
        workspace_path: effectiveWorkspacePath,
      },
      options: { auto_focus: true, check_duplicate: true },
    });
  };

  const toggleArchive = async (id: string, archived: boolean) => {
    try {
      await designArtifactAPI.archive(id, archived, effectiveWorkspacePath);
    } catch (err) {
      log.warn('toggleArchive failed', err);
    }
  };

  return (
    <div className="design-artifact-browser">
      <div className="design-artifact-browser__toolbar">
        <Input
          className="design-artifact-browser__search"
          inputSize="small"
          type="text"
          value={query}
          placeholder={t('designCanvas.browser.searchPlaceholder')}
          prefix={<Search size={14} />}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Checkbox
          className="design-artifact-browser__archived-toggle"
          size="small"
          checked={showArchived}
          label={t('designCanvas.browser.showArchived')}
          onChange={(e) => setShowArchived(e.target.checked)}
        />
        <Button
          type="button"
          className="design-artifact-browser__refresh"
          variant="secondary"
          size="small"
          onClick={refresh}
        >
          <RefreshCcw size={13} />
          {t('designCanvas.browser.refresh')}
        </Button>
      </div>

      {isLoading && filtered.length === 0 ? (
        <div className="design-artifact-browser__empty">{t('designCanvas.browser.loading')}</div>
      ) : filtered.length === 0 ? (
        <div className="design-artifact-browser__empty">
          <Palette size={20} />
          <div>{t('designCanvas.browser.emptyTitle')}</div>
          <div className="design-artifact-browser__empty-hint">
            {t('designCanvas.browser.emptyHint')}
          </div>
        </div>
      ) : (
        <ul className="design-artifact-browser__list">
          {filtered.map((m) => {
            const archived = Boolean(m.archived_at);
            return (
              <li
                key={m.id}
                className={`design-artifact-browser__item${
                  archived ? ' design-artifact-browser__item--archived' : ''
                }`}
              >
                <IconButton
                  type="button"
                  className="design-artifact-browser__thumb"
                  onClick={() => openInCanvas(m.id)}
                  aria-label={t('designCanvas.browser.openInCanvas')}
                  tooltip={t('designCanvas.browser.openInCanvas')}
                  size="large"
                  variant="primary"
                >
                  <Palette size={18} />
                </IconButton>
                <div className="design-artifact-browser__meta">
                  <div className="design-artifact-browser__title">{m.title}</div>
                  <div className="design-artifact-browser__subtitle">
                    <code>{m.id}</code>
                    <Badge variant="neutral">{m.kind}</Badge>
                    <Badge variant="info">
                      {t('designCanvas.browser.fileCount', { count: m.files.length })}
                    </Badge>
                    <Badge variant="accent">
                      {t('designCanvas.browser.snapshotCount', { count: m.versions.length })}
                    </Badge>
                    {m.current_version && (
                      <Badge variant="neutral">v{m.current_version.slice(0, 8)}</Badge>
                    )}
                  </div>
                </div>
                <div className="design-artifact-browser__actions">
                  <IconButton
                    type="button"
                    className="design-artifact-browser__action"
                    onClick={() => openInCanvas(m.id)}
                    aria-label={t('designCanvas.browser.openInCanvas')}
                    tooltip={t('designCanvas.browser.openInCanvas')}
                    size="small"
                    variant="ghost"
                  >
                    <ExternalLink size={13} />
                  </IconButton>
                  <IconButton
                    type="button"
                    className="design-artifact-browser__action"
                    onClick={() => toggleArchive(m.id, !archived)}
                    aria-label={archived ? t('designCanvas.browser.unarchive') : t('designCanvas.browser.archive')}
                    tooltip={archived ? t('designCanvas.browser.unarchive') : t('designCanvas.browser.archive')}
                    size="small"
                    variant="ghost"
                  >
                    {archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
                  </IconButton>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default DesignArtifactBrowser;
