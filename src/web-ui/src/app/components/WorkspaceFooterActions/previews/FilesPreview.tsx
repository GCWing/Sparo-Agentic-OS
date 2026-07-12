import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Archive,
  ChevronRight,
  File,
  FileCode2,
  FileImage,
  FileText,
  Folder,
  FolderClock,
  FolderInput,
  FolderOpen,
  Search as SearchIcon,
  Star,
  X,
} from 'lucide-react';
import { Button, IconButton, Input, Tooltip } from '@/design-system';
import {
  pinnedAPI,
  systemFsAPI,
  type FsEntry,
  type PinnedPath,
  type QuickFolder,
} from '@/infrastructure/api';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';
import { openWorkspaceScene } from '@/app/navigation/workspaceNavigation';
import { loadRecentFileLocations } from '@/app/scenes/file-viewer/services/recentFileLocations';
import { externalRuntimeScope } from '@/shared/types/runtime-scope';
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
import './FilesPreview.scss';

const COMMON_LOCATION_LIMIT = 2;
const SEARCH_RESULT_LIMIT = 4;
const RECENT_CONTENT_LIMIT = 3;

type FileLocationKind = 'recent' | 'pinned' | 'quick' | 'typed';

interface FileLocation {
  id: string;
  name: string;
  path: string;
  kind: FileLocationKind;
}

function basename(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '');
  return normalized.split(/[\\/]+/).filter(Boolean).pop() || path;
}

function parentDirectory(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '');
  const index = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'));
  if (index < 0) return path;
  if (index === 2 && /^[A-Za-z]:/.test(normalized)) return `${normalized.slice(0, 2)}\\`;
  return normalized.slice(0, index) || path;
}

function pinnedTarget(item: PinnedPath): string {
  return item.kind === 'dir' ? item.path : parentDirectory(item.path);
}

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLocaleLowerCase();
}

function isLikelyPath(value: string): boolean {
  const trimmed = value.trim();
  return /^[A-Za-z]:[\\/]/.test(trimmed)
    || /^\\\\/.test(trimmed)
    || /^\//.test(trimmed)
    || /^~[\\/]/.test(trimmed);
}

function dedupeLocations(locations: readonly FileLocation[]): FileLocation[] {
  const seen = new Set<string>();
  return locations.filter((location) => {
    const key = normalizePath(location.path);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function locationFromPinned(item: PinnedPath): FileLocation {
  const path = pinnedTarget(item);
  return {
    id: `pinned:${item.id}`,
    name: item.label || basename(path),
    path,
    kind: 'pinned',
  };
}

function locationFromQuickFolder(folder: QuickFolder): FileLocation {
  return {
    id: `quick:${folder.id}`,
    name: folder.name,
    path: folder.path,
    kind: 'quick',
  };
}

function fileExtension(name: string): string {
  const index = name.lastIndexOf('.');
  return index > 0 ? name.slice(index + 1).toLocaleLowerCase() : '';
}

function entryIcon(entry: FsEntry): React.ReactNode {
  if (entry.kind === 'dir') return <Folder size={17} />;
  const extension = fileExtension(entry.name);
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(extension)) {
    return <FileImage size={17} />;
  }
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(extension)) return <Archive size={17} />;
  if (['ts', 'tsx', 'js', 'jsx', 'rs', 'py', 'go', 'java', 'json', 'html', 'css', 'scss'].includes(extension)) {
    return <FileCode2 size={17} />;
  }
  if (['md', 'txt', 'doc', 'docx', 'pdf', 'rtf'].includes(extension)) return <FileText size={17} />;
  return <File size={17} />;
}

const FilesPreview: React.FC<WorkspaceHubPreviewProps> = ({
  label,
  primaryActionRef,
  onOpenItem,
  onClose,
}) => {
  const { t, formatRelativeTime } = useI18n('common');
  const listboxId = useId();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const recentLocations = useMemo(loadRecentFileLocations, []);
  const pinned = useHubPreviewResource(
    'workspace-hub:files:pinned',
    () => pinnedAPI.list(),
    { ttlMs: 15_000 },
  );
  const quickFolders = useHubPreviewResource<QuickFolder[]>(
    'workspace-hub:files:quick-folders',
    () => systemFsAPI.listQuickFolders(),
    { ttlMs: 60_000 },
  );

  const pinnedLocations = useMemo(
    () => (pinned.data?.paths ?? []).map(locationFromPinned),
    [pinned.data?.paths],
  );
  const quickLocations = useMemo(
    () => (quickFolders.data ?? []).map(locationFromQuickFolder),
    [quickFolders.data],
  );
  const recentLocationItems = useMemo(() => recentLocations.map((path, index) => ({
    id: `recent:${index}:${path}`,
    name: basename(path),
    path,
    kind: 'recent' as const,
  })), [recentLocations]);
  const continueLocation = recentLocationItems[0];
  const recentContents = useHubPreviewResource<FsEntry[]>(
    `workspace-hub:files:contents:${normalizePath(continueLocation?.path ?? '') || 'empty'}`,
    () => continueLocation ? systemFsAPI.listDir(continueLocation.path) : Promise.resolve([]),
    { ttlMs: 15_000 },
  );
  const visibleRecentContents = useMemo(() => (
    (recentContents.data ?? [])
      .filter((entry) => !entry.hidden)
      .sort((left, right) => {
        if (left.kind === 'dir' && right.kind !== 'dir') return -1;
        if (left.kind !== 'dir' && right.kind === 'dir') return 1;
        return left.name.localeCompare(right.name);
      })
      .slice(0, RECENT_CONTENT_LIMIT)
  ), [recentContents.data]);
  const commonLocations = useMemo(() => {
    const continuePath = continueLocation ? normalizePath(continueLocation.path) : '';
    return dedupeLocations([...pinnedLocations, ...quickLocations])
      .filter((location) => normalizePath(location.path) !== continuePath)
      .slice(0, COMMON_LOCATION_LIMIT);
  }, [continueLocation, pinnedLocations, quickLocations]);
  const knownLocations = useMemo(
    () => dedupeLocations([...recentLocationItems, ...pinnedLocations, ...quickLocations]),
    [pinnedLocations, quickLocations, recentLocationItems],
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchingLocations = useMemo(() => {
    if (!normalizedQuery) return [];
    return knownLocations.filter((location) => (
      location.name.toLocaleLowerCase().includes(normalizedQuery)
      || location.path.toLocaleLowerCase().includes(normalizedQuery)
    )).slice(0, SEARCH_RESULT_LIMIT);
  }, [knownLocations, normalizedQuery]);
  const searchResults = useMemo(() => {
    if (matchingLocations.length > 0) return matchingLocations;
    if (!isLikelyPath(query)) return [];
    const path = query.trim();
    return [{
      id: `typed:${path}`,
      name: basename(path),
      path,
      kind: 'typed' as const,
    }];
  }, [matchingLocations, query]);
  const commonLoading = pinned.loading && !pinned.data
    && quickFolders.loading && !quickFolders.data;

  useEffect(() => {
    setActiveResultIndex(0);
  }, [normalizedQuery, searchResults.length]);

  useEffect(() => {
    if (!searchExpanded) return undefined;
    const frameId = window.requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frameId);
  }, [searchExpanded]);

  const openLocation = useCallback((path: string) => {
    const normalizedPath = path.trim();
    const scope = externalRuntimeScope(normalizedPath, basename(normalizedPath));
    if (!scope) return;
    onClose();
    openWorkspaceScene('file-viewer', { scope });
  }, [onClose]);

  const openEntry = useCallback((entry: FsEntry) => {
    if (entry.kind === 'dir') {
      openLocation(entry.path);
      return;
    }
    onClose();
    void systemFsAPI.openWithDefault(entry.path);
  }, [onClose, openLocation]);

  const openActiveSearchResult = useCallback(() => {
    const result = searchResults[activeResultIndex] ?? searchResults[0];
    if (result) openLocation(result.path);
  }, [activeResultIndex, openLocation, searchResults]);

  const collapseSearch = useCallback(() => {
    setQuery('');
    setSearchExpanded(false);
  }, []);

  const handleSearchKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && searchResults.length > 0) {
      event.preventDefault();
      setActiveResultIndex((index) => (index + 1) % searchResults.length);
      return;
    }
    if (event.key === 'ArrowUp' && searchResults.length > 0) {
      event.preventDefault();
      setActiveResultIndex((index) => (index - 1 + searchResults.length) % searchResults.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      openActiveSearchResult();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      collapseSearch();
    }
  }, [collapseSearch, openActiveSearchResult, searchResults.length]);

  const locationIcon = (location: FileLocation) => {
    if (location.kind === 'recent') return <FolderClock size={18} />;
    if (location.kind === 'pinned') return <Star size={18} />;
    if (location.kind === 'typed') return <FolderInput size={18} />;
    return <Folder size={18} />;
  };

  const renderLocationRow = (location: FileLocation, options?: {
    active?: boolean;
    id?: string;
  }) => (
    <WorkspaceHubPreviewRow
      key={location.id}
      id={options?.id}
      active={options?.active}
      role={normalizedQuery ? 'option' : undefined}
      ariaSelected={normalizedQuery ? options?.active : undefined}
      icon={locationIcon(location)}
      title={location.name}
      tone={location.kind === 'recent' ? 'accent' : 'neutral'}
      onClick={() => openLocation(location.path)}
      ariaLabel={t('nav.menuPanel.hub.preview.files.aria.openLocation', { name: location.name })}
      tooltip={location.path}
    />
  );

  const entryMeta = (entry: FsEntry) => {
    const kindLabel = entry.kind === 'dir'
      ? t('nav.menuPanel.hub.preview.files.types.folder')
      : fileExtension(entry.name).toLocaleUpperCase()
        || t('nav.menuPanel.hub.preview.files.types.file');
    if (!entry.modified) return kindLabel;
    const modifiedAt = new Date(entry.modified);
    if (Number.isNaN(modifiedAt.getTime())) return kindLabel;
    return `${kindLabel} · ${formatRelativeTime(modifiedAt)}`;
  };

  const activeDescendant = normalizedQuery && searchResults.length > 0
    ? `${listboxId}-${activeResultIndex}`
    : undefined;

  return (
    <WorkspaceHubPreviewFrame
      title={label}
      className="sparo-workspace-hub-files-preview"
      headerMeta={(
        <div className="sparo-workspace-hub-files-preview__header-actions">
          <IconButton
            variant="ghost"
            size="medium"
            shape="circle"
            aria-label={t('nav.menuPanel.hub.preview.files.actions.search')}
            tooltip={t('nav.menuPanel.hub.preview.files.actions.search')}
            tooltipPlacement="top"
            onClick={() => setSearchExpanded((expanded) => !expanded)}
          >
            <SearchIcon size={16} aria-hidden="true" />
          </IconButton>
          <IconButton
            ref={primaryActionRef}
            variant="brand"
            size="medium"
            shape="circle"
            aria-label={t('nav.menuPanel.hub.preview.files.actions.open')}
            tooltip={t('nav.menuPanel.hub.preview.files.actions.open')}
            tooltipPlacement="top"
            onClick={() => onOpenItem('files')}
          >
            <FolderOpen size={16} aria-hidden="true" />
          </IconButton>
        </div>
      )}
      summary={searchExpanded ? (
        <Input
          ref={searchInputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder={t('nav.menuPanel.hub.preview.files.search.placeholder')}
          aria-label={t('nav.menuPanel.hub.preview.files.search.ariaLabel')}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={Boolean(normalizedQuery)}
          aria-controls={normalizedQuery ? listboxId : undefined}
          aria-activedescendant={activeDescendant}
          autoComplete="off"
          inputSize="large"
          prefix={<SearchIcon size={16} aria-hidden="true" />}
          suffix={(
            <IconButton
              variant="ghost"
              size="xs"
              className="sparo-workspace-hub-files-preview__clear"
              onClick={collapseSearch}
              aria-label={t('nav.menuPanel.hub.preview.files.search.clear')}
            >
              <X size={13} aria-hidden="true" />
            </IconButton>
          )}
          className="sparo-workspace-hub-files-preview__search"
        />
      ) : undefined}
    >
      {normalizedQuery ? (
        <WorkspaceHubPreviewSection
          title={t('nav.menuPanel.hub.preview.files.sections.results')}
          className="sparo-workspace-hub-files-preview__results"
        >
          <div id={listboxId} role="listbox" className="sparo-workspace-hub-files-preview__listbox">
            {searchResults.length > 0 ? searchResults.map((location, index) => renderLocationRow(location, {
              active: activeResultIndex === index,
              id: `${listboxId}-${index}`,
            })) : (
              <WorkspaceHubPreviewEmpty
                title={t('nav.menuPanel.hub.preview.files.empty.searchTitle')}
              />
            )}
          </div>
        </WorkspaceHubPreviewSection>
      ) : (
        <>
          {continueLocation ? (
            <WorkspaceHubPreviewSection
              title={t('nav.menuPanel.hub.preview.files.sections.continue')}
              className="sparo-workspace-hub-files-preview__continue"
            >
              <div className="sparo-workspace-hub-files-preview__context">
                <Tooltip content={continueLocation.path} placement="right" followCursor>
                  <Button
                    variant="ghost"
                    size="small"
                    className="sparo-workspace-hub-files-preview__context-heading"
                    onClick={() => openLocation(continueLocation.path)}
                    aria-label={t('nav.menuPanel.hub.preview.files.aria.openLocation', { name: continueLocation.name })}
                  >
                    <span className="sparo-workspace-hub-files-preview__context-icon" aria-hidden="true">
                      <FolderOpen size={18} />
                    </span>
                    <span className="sparo-workspace-hub-files-preview__context-copy">
                      <strong>{continueLocation.name}</strong>
                    </span>
                    <ChevronRight size={15} aria-hidden="true" />
                  </Button>
                </Tooltip>

                <div className="sparo-workspace-hub-files-preview__contents">
                  {recentContents.loading && !recentContents.data ? (
                    <WorkspaceHubPreviewLoading rows={4} />
                  ) : recentContents.error && !recentContents.data ? (
                    <WorkspaceHubPreviewError
                      message={t('nav.menuPanel.hub.preview.files.errors.contents')}
                      retryLabel={t('nav.menuPanel.hub.preview.common.retry')}
                      onRetry={recentContents.refresh}
                    />
                  ) : visibleRecentContents.length > 0 ? visibleRecentContents.map((entry) => (
                    <Button
                      key={entry.path}
                      variant="ghost"
                      size="small"
                      className="sparo-workspace-hub-files-preview__content-row"
                      onClick={() => openEntry(entry)}
                      aria-label={t('nav.menuPanel.hub.preview.files.aria.openEntry', { name: entry.name })}
                    >
                      <span className={`sparo-workspace-hub-files-preview__content-icon is-${entry.kind}`} aria-hidden="true">
                        {entryIcon(entry)}
                      </span>
                      <strong>{entry.name}</strong>
                      <span>{entryMeta(entry)}</span>
                    </Button>
                  )) : (
                    <WorkspaceHubPreviewEmpty
                      title={t('nav.menuPanel.hub.preview.files.empty.contentsTitle')}
                    />
                  )}
                </div>
              </div>
            </WorkspaceHubPreviewSection>
          ) : (
            <WorkspaceHubPreviewEmpty
              title={t('nav.menuPanel.hub.preview.files.empty.continueTitle')}
            />
          )}

          {(commonLoading || commonLocations.length > 0) && (
            <WorkspaceHubPreviewSection
              title={t('nav.menuPanel.hub.preview.files.sections.common')}
              className="sparo-workspace-hub-files-preview__common"
            >
              {commonLoading ? (
                <WorkspaceHubPreviewLoading rows={2} />
              ) : commonLocations.map((location) => renderLocationRow(location))}
            </WorkspaceHubPreviewSection>
          )}
        </>
      )}
    </WorkspaceHubPreviewFrame>
  );
};

export default FilesPreview;
