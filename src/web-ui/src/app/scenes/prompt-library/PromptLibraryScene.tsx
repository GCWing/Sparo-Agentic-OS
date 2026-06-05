import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpenText, Clock, FileText, GitBranch, Plus, RefreshCw, Save, Search, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/design-system';
import { MarkdownRenderer } from '@/shared/markdown';
import { useWorkspaceContext } from '@/infrastructure/contexts/WorkspaceContext';
import {
  PromptLibraryAPI,
  type PromptAsset,
  type PromptAssetGitCommit,
  type PromptAssetGitDiff,
  type PromptAssetGitStatus,
  type PromptAssetMetadata,
  type PromptAssetScope,
  type PromptAssetSummary,
  type GitPromptCommit,
  type PromptHistoryEvent,
  type GitHeadSnapshot,
  type PromptValidationReport,
  type FileChange,
  type DetailedToolRecord,
  type PrecedingPromptEntry,
} from '@/infrastructure/api/service-api/PromptLibraryAPI';
import { useNotification } from '@/shared/notification-system';
import { useModelConfigs } from '@/hooks/useModelConfigs';
import './PromptLibraryScene.scss';

type TabId = 'history' | 'assets' | 'git';
type Mode = 'view' | 'edit' | 'create';

interface EditorState {
  id: string;
  name: string;
  scope: PromptAssetScope;
  body: string;
}

const EMPTY_EDITOR: EditorState = {
  id: '',
  name: '',
  scope: 'project',
  body: '',
};

const SCOPES: PromptAssetScope[] = ['project', 'workspace', 'user'];
const HISTORY_SCOPES: PromptAssetScope[] = ['project', 'user'];
const GIT_HISTORY_PAGE_SIZE = 80;

const PromptLibraryScene: React.FC = () => {
  const { t } = useTranslation('scenes/prompt-library');
  const { error: notifyError, success: notifySuccess } = useNotification();
  const { hasWorkspace, workspacePath, workspaceName } = useWorkspaceContext();

  const [tab, setTab] = useState<TabId>('history');
  const [scope, setScope] = useState<PromptAssetScope>('project');
  const [query, setQuery] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [gitLoading, setGitLoading] = useState(false);
  const [assets, setAssets] = useState<PromptAssetSummary[]>([]);
  const [history, setHistory] = useState<PromptHistoryEvent[]>([]);
  const [gitPromptHistory, setGitPromptHistory] = useState<GitPromptCommit[]>([]);
  const [gitSnapshot, setGitSnapshot] = useState<GitHeadSnapshot | null>(null);
  const [gitHasMore, setGitHasMore] = useState(true);
  const [gitLoadingMore, setGitLoadingMore] = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<PromptAsset | null>(null);
  const [mode, setMode] = useState<Mode>('view');
  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR);
  const [validation, setValidation] = useState<PromptValidationReport | null>(null);
  const [gitStatus, setGitStatus] = useState<PromptAssetGitStatus | null>(null);
  const [gitDiff, setGitDiff] = useState<PromptAssetGitDiff | null>(null);
  const [gitHistory, setGitHistory] = useState<PromptAssetGitCommit[]>([]);
  const gitLoadingRef = useRef(false);
  const gitSnapshotRef = useRef<GitHeadSnapshot | null>(null);

  const selectedHistory = useMemo(
    () => history.find((item) => item.id === selectedHistoryId) ?? null,
    [history, selectedHistoryId],
  );

  const selectedCommit = useMemo(
    () => gitPromptHistory.find((item) => item.hash === selectedCommitHash) ?? null,
    [gitPromptHistory, selectedCommitHash],
  );

  const filteredAssets = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return assets;
    return assets.filter((asset) => `${asset.name} ${asset.id} ${asset.description ?? ''} ${asset.kind}`.toLowerCase().includes(q));
  }, [assets, query]);

  const filteredHistory = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return history;
    return history.filter((item) => `${item.text} ${item.agentType} ${item.sessionId}`.toLowerCase().includes(q));
  }, [history, query]);

  const filteredGitPromptHistory = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return gitPromptHistory;
    return gitPromptHistory.filter((commit) => {
      const promptText = commit.prompts.map((prompt) => `${prompt.text} ${prompt.agentType} ${prompt.sessionId}`).join(' ');
      return `${commit.hash} ${commit.shortHash} ${commit.subject} ${commit.author} ${promptText}`.toLowerCase().includes(q);
    });
  }, [gitPromptHistory, query]);

  const loadHistory = useCallback(async () => {
    if (!workspacePath) return;
    setHistoryLoading(true);
    try {
      const result = await PromptLibraryAPI.listPromptHistory({
        workspacePath,
        query: query || undefined,
        limit: 200,
      });
      setHistory(result.events);
      setSelectedHistoryId((current) => current && result.events.some((item) => item.id === current) ? current : result.events[0]?.id ?? null);
    } catch (error) {
      notifyError(t('messages.loadHistoryFailed', { error: formatError(error) }));
    } finally {
      setHistoryLoading(false);
    }
  }, [notifyError, query, t, workspacePath]);

  const loadAssets = useCallback(async () => {
    if (!workspacePath) return;
    setAssetsLoading(true);
    try {
      const [items, status] = await Promise.all([
        PromptLibraryAPI.listPromptAssets(workspacePath, scope),
        scope === 'project' ? PromptLibraryAPI.getPromptAssetGitStatus(workspacePath).catch(() => null) : Promise.resolve(null),
      ]);
      setAssets(items);
      setGitStatus(status);
      setSelectedAssetId((current) => current && items.some((item) => item.id === current) ? current : items[0]?.id ?? null);
    } catch (error) {
      notifyError(t('messages.loadAssetsFailed', { error: formatError(error) }));
    } finally {
      setAssetsLoading(false);
    }
  }, [notifyError, scope, t, workspacePath]);

  const loadGitPromptHistory = useCallback(async () => {
    if (!workspacePath || gitLoadingRef.current) return;
    gitLoadingRef.current = true;
    setGitLoading(true);
    try {
      const headSnapshot = await PromptLibraryAPI.getPromptGitHeadSnapshot(workspacePath).catch(() => null);
      setGitSnapshot(headSnapshot);
      gitSnapshotRef.current = headSnapshot;
      const commits = await PromptLibraryAPI.listGitPromptCommits(workspacePath, undefined, GIT_HISTORY_PAGE_SIZE, 0);
      setGitPromptHistory(commits);
      setGitHasMore(commits.length === GIT_HISTORY_PAGE_SIZE);
      setSelectedCommitHash((current) => current && commits.some((item) => item.hash === current) ? current : commits[0]?.hash ?? null);
    } catch (error) {
      notifyError(t('messages.loadGitHistoryFailed', { error: formatError(error) }));
    } finally {
      gitLoadingRef.current = false;
      setGitLoading(false);
    }
  }, [notifyError, t, workspacePath]);

  const loadMoreGitPromptHistory = useCallback(async () => {
    if (!workspacePath || gitLoading || gitLoadingMore || !gitHasMore) return;
    setGitLoadingMore(true);
    try {
      const commits = await PromptLibraryAPI.listGitPromptCommits(workspacePath, undefined, GIT_HISTORY_PAGE_SIZE, gitPromptHistory.length);
      const selectedBeforeLoad = selectedCommitHash;
      setGitPromptHistory((current) => mergeGitPromptHistory(current, commits));
      if (!selectedBeforeLoad && commits[0]) setSelectedCommitHash(commits[0].hash);
      setGitHasMore(commits.length === GIT_HISTORY_PAGE_SIZE);
    } catch (error) {
      notifyError(t('messages.loadGitHistoryFailed', { error: formatError(error) }));
    } finally {
      setGitLoadingMore(false);
    }
  }, [gitHasMore, gitLoading, gitLoadingMore, gitPromptHistory.length, notifyError, selectedCommitHash, t, workspacePath]);

  useEffect(() => {
    if (tab === 'history' && scope === 'workspace') {
      setScope('project');
      return;
    }
    if (tab === 'history') void loadHistory();
    else if (tab === 'assets') void loadAssets();
    else void loadGitPromptHistory();
  }, [scope, tab, loadAssets, loadGitPromptHistory, loadHistory]);

  useEffect(() => {
    void loadGitPromptHistory();
  }, [loadGitPromptHistory]);

  useEffect(() => {
    if (tab !== 'git' || !workspacePath) return undefined;
    let cancelled = false;
    const checkGitHead = async () => {
      if (gitLoadingRef.current) return;
      const next = await PromptLibraryAPI.getPromptGitHeadSnapshot(workspacePath).catch(() => null);
      if (cancelled || !next) return;
      const previous = gitSnapshotRef.current;
      const changed = !previous
        || previous.observedHead !== next.observedHead
        || previous.observedBranch !== next.observedBranch;
      if (changed) void loadGitPromptHistory();
    };
    const interval = window.setInterval(() => {
      void checkGitHead();
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [loadGitPromptHistory, tab, workspacePath]);

  useEffect(() => {
    if (tab !== 'assets' || !workspacePath || !selectedAssetId) {
      setSelectedAsset(null);
      setGitDiff(null);
      setGitHistory([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const asset = await PromptLibraryAPI.getPromptAsset(workspacePath, selectedAssetId, scope);
        if (cancelled) return;
        setSelectedAsset(asset);
        setEditor(assetToEditor(asset));
        setMode('view');
        setValidation(null);
        if (scope === 'project') {
          const path = promptGitPath(asset.relativePath);
          const [diff, commits] = await Promise.all([
            PromptLibraryAPI.getPromptAssetGitDiff(workspacePath, path).catch(() => null),
            PromptLibraryAPI.getPromptAssetGitHistory(workspacePath, path, 8).catch(() => []),
          ]);
          if (!cancelled) {
            setGitDiff(diff);
            setGitHistory(commits);
          }
        } else {
          setGitDiff(null);
          setGitHistory([]);
        }
      } catch (error) {
        if (!cancelled) notifyError(t('messages.loadAssetFailed', { error: formatError(error) }));
      }
    })();
    return () => { cancelled = true; };
  }, [notifyError, scope, selectedAssetId, t, tab, workspacePath]);

  const refresh = useCallback(() => {
    if (tab === 'history') void loadHistory();
    else if (tab === 'assets') void loadAssets();
    else void loadGitPromptHistory();
  }, [loadAssets, loadGitPromptHistory, loadHistory, tab]);

  const startCreate = useCallback(() => {
    setTab('assets');
    setSelectedAssetId(null);
    setSelectedAsset(null);
    setEditor({ ...EMPTY_EDITOR, scope });
    setValidation(null);
    setMode('create');
  }, [scope]);

  const saveEditor = useCallback(async () => {
    if (!workspacePath) return;
    if (!editor.body.trim()) {
      notifyError(t('messages.required'));
      return;
    }
    const autoName = titleFromText(editor.body);
    const autoId = promptIdFromText(editor.body);
    const resolvedEditor = {
      ...editor,
      name: editor.name || autoName,
      id: editor.id || autoId,
    };
    try {
      const asset = await PromptLibraryAPI.savePromptAsset({
        workspacePath,
        metadata: editorToMetadata(resolvedEditor),
        body: editor.body,
        relativePath: mode === 'edit' ? selectedAsset?.relativePath : undefined,
      });
      notifySuccess(t('messages.saved', { name: asset.metadata.name }));
      setScope(asset.metadata.scope);
      setSelectedAssetId(asset.metadata.id);
      setMode('view');
      await loadAssets();
    } catch (error) {
      notifyError(t('messages.saveFailed', { error: formatError(error) }));
    }
  }, [editor, loadAssets, mode, notifyError, notifySuccess, selectedAsset?.relativePath, t, workspacePath]);

  const promoteSelectedHistory = useCallback(async () => {
    if (!workspacePath || !selectedHistory) return;
    const metadata = editorToMetadata({
      ...EMPTY_EDITOR,
      id: promptIdFromText(selectedHistory.text),
      name: titleFromText(selectedHistory.text),
      scope,
      body: selectedHistory.text,
    });
    try {
      const asset = await PromptLibraryAPI.promotePromptHistoryToAsset({
        workspacePath,
        historyEventId: selectedHistory.id,
        metadata,
      });
      notifySuccess(t('messages.promoted', { name: asset.metadata.name }));
      setTab('assets');
      setSelectedAssetId(asset.metadata.id);
      await loadAssets();
    } catch (error) {
      notifyError(t('messages.promoteFailed', { error: formatError(error) }));
    }
  }, [loadAssets, notifyError, notifySuccess, scope, selectedHistory, t, workspacePath]);

  if (!hasWorkspace || !workspacePath) {
    return (
      <div className="prompt-library-scene">
        <div className="prompt-library-empty">
          <BookOpenText size={36} />
          <h2>{t('empty.noWorkspaceTitle')}</h2>
          <p>{t('empty.noWorkspace')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="prompt-library-scene">
      <header className="prompt-library-scene__header">
        <div className="prompt-library-scene__identity">
          <div className="prompt-library-scene__eyebrow"><Sparkles size={14} /> {workspaceName || t('workspace')}</div>
          <h2>{t('title')}</h2>
          <p>{t('subtitle')}</p>
        </div>
        <div className="prompt-library-scene__actions">
          <button type="button" className="prompt-library-btn" onClick={refresh}><RefreshCw size={15} />{t('actions.refresh')}</button>
          <button type="button" className="prompt-library-btn prompt-library-btn--primary" onClick={startCreate}><Plus size={15} />{t('actions.new')}</button>
        </div>
      </header>

      <section className="prompt-library-toolbar">
        <div className="prompt-library-tabs" role="tablist">
          {(['history', 'assets', 'git'] as TabId[]).map((item) => (
            <button key={item} type="button" className={tab === item ? 'is-active' : ''} onClick={() => setTab(item)}>
              {t(`tabs.${item}`)}
            </button>
          ))}
        </div>
        {tab === 'git' ? <div /> : (
          <label className="prompt-library-select">
            <span>{tab === 'history' ? t('fields.range') : t('fields.scope')}</span>
            <select value={scope} onChange={(event) => setScope(event.target.value as PromptAssetScope)}>
              {(tab === 'history' ? HISTORY_SCOPES : SCOPES).map((value) => (
                <option key={value} value={value}>
                  {tab === 'history' ? t(`historyScopes.${value}`) : t(`scopes.${value}`)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="prompt-library-search">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('search')} />
        </label>
      </section>

      <main className={`prompt-library-workbench${tab === 'git' ? ' prompt-library-workbench--git' : ''}`}>
        <aside className={tab === 'git' ? 'prompt-library-git-graph-pane' : 'prompt-library-list'}>
          {tab === 'git' ? (
            <GitHistoryGraph
              commits={filteredGitPromptHistory}
              gitSnapshot={gitSnapshot}
              selectedCommitHash={selectedCommitHash}
              loading={gitLoading}
              loadingMore={gitLoadingMore}
              hasMore={gitHasMore && !query.trim()}
              onSelectCommit={setSelectedCommitHash}
              onLoadMore={loadMoreGitPromptHistory}
              t={t}
            />
          ) : (
            <>
              <div className="prompt-library-list__head">
                <span>{tab === 'history' ? t('tabs.history') : t('tabs.assets')}</span>
                <small>{listCountLabel(tab, historyLoading, assetsLoading, gitLoading, filteredHistory.length, filteredAssets.length, filteredGitPromptHistory.length, t)}</small>
              </div>
              <div className="prompt-library-list__scroll">
                {tab === 'history' ? filteredHistory.map((item) => {
                  const commitLabel = historyCommitInlineLabel(item);
                  return (
                    <button key={item.id} type="button" className={`prompt-library-row${selectedHistoryId === item.id ? ' is-active' : ''}`} onClick={() => setSelectedHistoryId(item.id)}>
                      <FileText size={15} />
                      <span className="prompt-library-row__content">
                        <strong>{firstLine(item.text)}</strong>
                        <small>{item.agentType} - {formatDate(item.createdAt)}</small>
                        {commitLabel && <small>{commitLabel}</small>}
                      </span>
                    </button>
                  );
                }) : filteredAssets.map((asset) => (
                  <button key={asset.id} type="button" className={`prompt-library-row${selectedAssetId === asset.id ? ' is-active' : ''}`} onClick={() => setSelectedAssetId(asset.id)}>
                    <BookOpenText size={15} />
                    <span><strong>{asset.name}</strong><small>{t(`kinds.${asset.kind}`)} · {t(`status.${asset.status}`)}</small></span>
                  </button>
                ))}
              </div>
            </>
          )}
        </aside>

        <section className="prompt-library-detail">
          {tab === 'history' ? (
            <HistoryDetail
              item={selectedHistory}
              onPromote={promoteSelectedHistory}
              t={t}
            />
          ) : tab === 'git' ? (
            <GitPromptDetail
              commit={selectedCommit}
              t={t}
              onNavigateToPrompt={(promptId) => {
                setSelectedHistoryId(promptId);
                setTab('history');
              }}
            />
          ) : mode === 'view' && selectedAsset ? (
            <AssetDetail
              asset={selectedAsset}
              validation={validation}
              gitStatus={gitStatus}
              gitDiff={gitDiff}
              gitHistory={gitHistory}
              onEdit={() => setMode('edit')}
              t={t}
            />
          ) : (
            <AssetEditor
              editor={editor}
              onChange={setEditor}
              onCancel={() => setMode(selectedAsset ? 'view' : 'create')}
              onSave={saveEditor}
              t={t}
            />
          )}
        </section>
      </main>
    </div>
  );
};

function HistoryDetail({ item, onPromote, t }: {
  item: PromptHistoryEvent | null;
  onPromote: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const { configs: modelConfigs } = useModelConfigs();
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set());

  // Reset expanded tools when switching to a different history item
  useEffect(() => { setExpandedTools(new Set()); }, [item?.id]);

  // Resolve model display name from model configs
  const modelDisplayName = useMemo(() => {
    if (!item?.modelId) return null;
    const modelId = item.modelId;
    const match = modelConfigs.find(
      (m) => m.id === modelId || m.name === modelId || m.modelName === modelId,
    );
    if (!match) return modelId === 'primary'
      ? t('history.fields.primaryModel')
      : modelId === 'fast'
        ? t('history.fields.fastModel')
        : modelId;
    if (match.name && match.modelName && match.name !== match.modelName) {
      return `${match.name} / ${match.modelName}`;
    }
    return match.name || match.modelName || modelId;
  }, [item?.modelId, modelConfigs, t]);

  // Format git commit: subject + short hash
  const commitLabel = useMemo(() => {
    if (!item?.afterCommitHash) return null;
    const shortHash = item.afterCommitHash.slice(0, 7);
    if (item.afterCommitSubject) {
      return `${item.afterCommitSubject} (${shortHash})`;
    }
    return shortHash;
  }, [item?.afterCommitHash, item?.afterCommitSubject]);

  if (!item) return <div className="prompt-library-placeholder">{t('history.emptySelection')}</div>;

  const charCount = item.text.length;
  const lineCount = item.text.split('\n').length;
  const estimatedTokens = Math.round(charCount / 3.5);
  const fileChanges = parseFileChanges(item.responseModifiedFiles);
  const toolTimeline = parseToolTimeline(item.responseToolSummary);
  const precedingPrompts = parsePrecedingPrompts(item.precedingPromptEventIds);
  const hasResponseMetrics = item.responseStatus
    || item.responseTotalRounds != null
    || item.responseTotalTools != null
    || item.responseDurationMs != null
    || item.responseTotalTokens != null;

  const statusBadgeVariant = item.responseStatus === 'completed'
    ? 'success' as const
    : item.responseStatus === 'failed'
      ? 'error' as const
      : 'warning' as const;

  return (
    <div className="prompt-library-panel">
      <div className="prompt-library-panel__head">
        <div>
          <h3>{t('history.detailTitle')}</h3>
          <p>
            <strong>{item.sessionName || item.sessionId}</strong>
            <span className="prompt-library-text-muted"> — {formatDate(item.createdAt)}</span>
            <span className="prompt-library-text-muted"> · {relativeTime(item.createdAt, t)}</span>
          </p>
          <div className="prompt-library-meta">
            <Badge variant="neutral">{item.agentType}</Badge>
            <Badge variant="accent">{sourceLabel(item.source, t)}</Badge>
            {modelDisplayName && (
              <Badge variant="neutral" className="prompt-library-model-badge">{modelDisplayName}</Badge>
            )}
            {item.responseStatus && (
              <Badge variant={statusBadgeVariant}>{t(`history.responseStatus.${item.responseStatus}`)}</Badge>
            )}
            {item.imageContextCount > 0 && (
              <Badge variant="info">{t('history.badges.images', { count: item.imageContextCount })}</Badge>
            )}
            {item.pinned && <Badge variant="warning">{t('history.fields.pinned')}</Badge>}
          </div>
        </div>
        <button type="button" className="prompt-library-btn prompt-library-btn--primary" onClick={onPromote}><Save size={15} />{t('actions.saveAsAsset')}</button>
      </div>

      {/* Response metrics */}
      {hasResponseMetrics && (
        <div className="prompt-library-metrics-bar">
          {item.responseTotalRounds != null && (
            <Badge variant="neutral">{t('history.fields.responseRounds')}: {item.responseTotalRounds}</Badge>
          )}
          {item.responseTotalTools != null && (
            <Badge variant="neutral">{t('history.fields.responseTools')}: {item.responseTotalTools}</Badge>
          )}
          {item.responseDurationMs != null && (
            <Badge variant="neutral">{t('history.fields.responseDuration')}: {formatDuration(item.responseDurationMs)}</Badge>
          )}
          {item.responseTotalTokens != null && (
            <Badge variant="neutral">{t('history.fields.responseTokens')}: {formatTokens(item.responseTotalTokens, item.responseInputTokens, item.responseOutputTokens)}</Badge>
          )}
        </div>
      )}

      {item.responseError && (
        <div className="prompt-library-error-banner">{item.responseError}</div>
      )}

      {/* File changes */}
      {fileChanges.length > 0 && (
        <section className="prompt-library-info-section prompt-library-file-changes-section">
          <h4>{t('history.sections.fileChanges')}</h4>
          <ul className="prompt-library-file-changes">
            {fileChanges.map((fc, i) => (
              <li key={i} className="prompt-library-file-change">
                <span className="prompt-library-file-change__file" title={fc.file}>{fc.file}</span>
                <span className="prompt-library-file-change__stats">
                  {fc.added > 0 && <span className="prompt-library-file-change__added">+{fc.added}</span>}
                  {fc.removed > 0 && <span className="prompt-library-file-change__removed">-{fc.removed}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Tool call timeline */}
      <section className="prompt-library-info-section prompt-library-tool-timeline-section">
        <h4>{t('history.sections.toolSummary')}</h4>
        {toolTimeline.length === 0 ? (
          <p className="prompt-library-text-muted">{t('history.sections.noTools')}</p>
        ) : (
          <ol className="prompt-library-tool-timeline">
            {toolTimeline.map((entry, i) => {
              const isExpanded = expandedTools.has(i);
              const hasDetails = !!(entry.filePath || entry.context || entry.linesAdded != null || entry.linesRemoved != null || entry.error || entry.resultSummary);
              return (
              <li key={entry.toolId || i} className={`prompt-library-tool-timeline__item prompt-library-tool-timeline__item--${entry.status}`}>
                <span className="prompt-library-tool-timeline__index">{i + 1}</span>
                <div className="prompt-library-tool-timeline__body">
                  <div
                    className={`prompt-library-tool-timeline__head${hasDetails ? ' prompt-library-tool-timeline__head--expandable' : ''}`}
                    onClick={() => { if (hasDetails) setExpandedTools((prev) => { const next = new Set(prev); if (next.has(i)) next.delete(i); else next.add(i); return next; }); }}
                    role={hasDetails ? 'button' : undefined}
                    tabIndex={hasDetails ? 0 : undefined}
                    onKeyDown={hasDetails ? (e) => { if (e.key === 'Enter' || e.key === ' ') setExpandedTools((prev) => { const next = new Set(prev); if (next.has(i)) next.delete(i); else next.add(i); return next; }); } : undefined}
                    aria-expanded={hasDetails ? isExpanded : undefined}
                  >
                    <strong className="prompt-library-tool-timeline__name">{entry.toolName}</strong>
                    {entry.durationMs > 0 && (
                      <span className="prompt-library-tool-timeline__time"><Clock size={12} /> {formatDuration(entry.durationMs)}</span>
                    )}
                    {entry.status === 'failed' && (
                      <Badge variant="error">{t('history.responseStatus.failed')}</Badge>
                    )}
                    {entry.status === 'started' && (
                      <Badge variant="warning">{t('history.sections.running')}</Badge>
                    )}
                  </div>
                  {isExpanded && (
                    <div className="prompt-library-tool-timeline__details">
                      {(entry.filePath || entry.context) && (
                        <div className="prompt-library-tool-timeline__context">
                          {entry.filePath && (
                            <span className="prompt-library-tool-timeline__file" title={entry.filePath}>
                              <FileText size={12} /> {entry.filePath}
                            </span>
                          )}
                          {entry.context && (
                            <code className="prompt-library-tool-timeline__ctx">{entry.context}</code>
                          )}
                        </div>
                      )}
                      {(entry.linesAdded != null || entry.linesRemoved != null) && (
                        <div className="prompt-library-tool-timeline__diff">
                          {entry.linesAdded != null && entry.linesAdded > 0 && (
                            <span className="prompt-library-file-change__added">+{entry.linesAdded}</span>
                          )}
                          {entry.linesRemoved != null && entry.linesRemoved > 0 && (
                            <span className="prompt-library-file-change__removed">-{entry.linesRemoved}</span>
                          )}
                        </div>
                      )}
                      {entry.error && (
                        <div className="prompt-library-error-banner">{entry.error}</div>
                      )}
                      {entry.resultSummary && (
                        <pre className="prompt-library-tool-timeline__result">{entry.resultSummary}</pre>
                      )}
                    </div>
                  )}
                </div>
              </li>
            )})}
          </ol>
        )}
      </section>

      {/* Preceding prompts */}
      <section className="prompt-library-info-section prompt-library-preceding-section">
        <h4>{t('history.sections.precedingPrompts')}</h4>
        {precedingPrompts.length === 0 ? (
          <p className="prompt-library-text-muted">{t('history.sections.noPreceding')}</p>
        ) : (
          <ol className="prompt-library-preceding-timeline">
            {precedingPrompts.map((entry, i) => (
              <li key={entry.id} className="prompt-library-preceding-timeline__item">
                <span className="prompt-library-preceding-timeline__index">{precedingPrompts.length - i}</span>
                <div className="prompt-library-preceding-timeline__body">
                  <p className="prompt-library-preceding-timeline__summary">{entry.summary}</p>
                  <div className="prompt-library-preceding-timeline__meta">
                    <Badge variant="neutral">{entry.agentType}</Badge>
                    <span className="prompt-library-text-muted"><Clock size={12} /> {relativeTime(entry.createdAt, t)}</span>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Details card: environment + git + text stats */}
      <section className="prompt-library-info-section prompt-library-details-card">
        <h4>{t('history.sections.details')}</h4>
        <dl>
          {item.gitBranchAtCreated && (
            <>
              <dt>{t('history.fields.gitBranchAtCreated')}</dt>
              <dd><GitBranch size={12} /> {item.gitBranchAtCreated}</dd>
            </>
          )}
          {commitLabel && (
            <>
              <dt>{t('history.fields.commit')}</dt>
              <dd className="prompt-library-commit-label">{commitLabel}</dd>
            </>
          )}
          <dt>{t('history.fields.textStats')}</dt>
          <dd>{charCount} chars · {lineCount} lines · ~{estimatedTokens} tokens</dd>
        </dl>
      </section>

      {item.responseSummary && item.responseSummary.length > 0 && (
        <section className="prompt-library-info-section prompt-library-markdown-card">
          <h4>{t('history.sections.responseSummary')}</h4>
          <div className="prompt-library-markdown-body">
            <MarkdownRenderer content={item.responseSummary} />
          </div>
        </section>
      )}

      <section className="prompt-library-prompt-block">
        <h4>{t('history.sections.promptText')}</h4>
        <pre className="prompt-library-pre">{item.text}</pre>
      </section>
    </div>
  );
}

function GitPromptDetail({ commit, t, onNavigateToPrompt }: {
  commit: GitPromptCommit | null;
  t: (key: string, options?: Record<string, unknown>) => string;
  onNavigateToPrompt: (promptId: string) => void;
}) {
  if (!commit) return <div className="prompt-library-placeholder">{t('git.emptySelection')}</div>;

  return (
    <div className="prompt-library-panel">
      <div className="prompt-library-panel__head">
        <div>
          <h3>{commit.subject || commit.shortHash}</h3>
          <p>{commit.shortHash} - {commit.author} - {formatDate(commit.date)}</p>
        </div>
      </div>
      <div className="prompt-library-meta">
        <span><GitBranch size={13} /> {commit.shortHash}</span>
        <span>{t('git.promptCount', { count: commit.prompts.length })}</span>
        {commit.trace && <span>{t('git.traceReady')}</span>}
        {commit.trace && <span>{commit.trace.confidence === 'direct' ? t('git.direct') : t('git.inferred')}</span>}
      </div>
      {commit.trace && (
        <section className="prompt-library-info-section prompt-library-trace-section">
          <h4>{t('git.trace')}</h4>
          <dl>
            <dt>{t('git.fields.traceId')}</dt>
            <dd>{commit.trace.traceId}</dd>
            <dt>{t('git.fields.tracePath')}</dt>
            <dd>{commit.trace.tracePath}</dd>
          </dl>
        </section>
      )}
      {commit.prompts.length === 0 ? (
        <div className="prompt-library-placeholder">{t('git.emptyPrompts')}</div>
      ) : (
        <div className="prompt-library-git-prompts">
          {commit.prompts.map((prompt) => (
            <section
              key={prompt.id}
              className="prompt-library-git-prompt prompt-library-git-prompt--clickable"
              onClick={() => onNavigateToPrompt(prompt.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onNavigateToPrompt(prompt.id); }}
            >
              <div className="prompt-library-git-prompt__head">
                <div>
                  <h4>{firstLine(prompt.text)}</h4>
                  <p>{prompt.agentType} - {formatDate(prompt.createdAt)}</p>
                </div>
              </div>
              <pre className="prompt-library-pre">{prompt.text}</pre>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function GitHistoryGraph({ commits, gitSnapshot, selectedCommitHash, loading, loadingMore, hasMore, onSelectCommit, onLoadMore, t }: {
  commits: GitPromptCommit[];
  gitSnapshot: GitHeadSnapshot | null;
  selectedCommitHash: string | null;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onSelectCommit: (hash: string) => void;
  onLoadMore: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [hoveredCommitHash, setHoveredCommitHash] = useState<string | null>(null);
  const rows = useMemo(() => buildGitGraphRows(commits), [commits]);
  const rowByHash = useMemo(() => new Map(rows.map((row) => [row.hash, row])), [rows]);
  const laneLeft = 20;
  const laneWidth = 14;
  const rowHeight = 46;
  const loadMoreReserve = hasMore || loadingMore ? 48 : 0;
  const canvasHeight = Math.max(160, rows.length * rowHeight + 24 + loadMoreReserve);
  const activeCommitHash = hoveredCommitHash ?? selectedCommitHash;
  const connections = rows.flatMap((row) => row.parentHashes
    .map((parentHash) => rowByHash.get(parentHash))
    .filter((parent): parent is GitGraphRow => Boolean(parent))
    .map((parent) => ({ row, parent })));
  const graphWidth = Math.max(54, laneLeft + Math.max(1, rows.laneCount) * laneWidth + 20);

  const handleScroll = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !hasMore || loadingMore) return;
    if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 260) onLoadMore();
  }, [hasMore, loadingMore, onLoadMore]);

  useEffect(() => {
    handleScroll();
  }, [handleScroll, rows.length]);

  if (loading && rows.length === 0) return <div className="prompt-library-placeholder">{t('loading')}</div>;
  if (rows.length === 0) return <div className="prompt-library-placeholder">{t('git.empty')}</div>;

  return (
    <div className="prompt-library-git-graph-browser">
      <div className="prompt-library-list__head">
        <span>{t('tabs.git')}</span>
        <small>{gitSnapshot?.observedBranch ? `${gitSnapshot.observedBranch} · ${rows.length}` : rows.length}</small>
      </div>
      <div ref={scrollerRef} className="prompt-library-git-graph-browser__scroll" onScroll={handleScroll}>
        <div className="prompt-library-git-graph-browser__canvas" style={{ minHeight: `${canvasHeight}px` }}>
          <svg className="prompt-library-git-graph-browser__edges" width={graphWidth} height={canvasHeight} viewBox={`0 0 ${graphWidth} ${canvasHeight}`} preserveAspectRatio="none">
            {connections.map(({ row, parent }) => {
              const source = { x: laneLeft + row.lane * laneWidth, y: row.y };
              const target = { x: laneLeft + parent.lane * laneWidth, y: parent.y };
              const isActive = Boolean(activeCommitHash && (row.hash === activeCommitHash || parent.hash === activeCommitHash));
              return (
                <path
                  key={`${row.hash}-${parent.hash}`}
                  className={`prompt-library-git-graph-edge prompt-library-git-graph-edge--lane-${row.lane % 6}${isActive ? ' is-active' : ''}`}
                  d={gitGraphEdgePath(source, target)}
                />
              );
            })}
          </svg>
          {rows.map((row) => {
            const selected = selectedCommitHash === row.hash;
            const active = activeCommitHash === row.hash;
            const nodeX = laneLeft + row.lane * laneWidth;
            const messageLeft = gitGraphMessageLeft(row, connections, laneLeft, laneWidth, rowHeight);
            return (
              <button
                key={row.hash}
                type="button"
                className={`prompt-library-git-graph-browser__row prompt-library-git-graph-node--lane-${row.lane % 6}${selected ? ' is-selected' : ''}${active ? ' is-active' : ''}`}
                style={{ top: `${row.y - rowHeight / 2}px` }}
                onClick={() => onSelectCommit(row.hash)}
                onMouseEnter={() => setHoveredCommitHash(row.hash)}
                onMouseLeave={() => setHoveredCommitHash((current) => current === row.hash ? null : current)}
                onFocus={() => setHoveredCommitHash(row.hash)}
                onBlur={() => setHoveredCommitHash((current) => current === row.hash ? null : current)}
                title={`${row.subject || row.shortHash}\n${row.shortHash} · ${row.author ? `${row.author} · ` : ''}${formatDate(row.date)}`}
              >
                <span className="prompt-library-git-graph-browser__graph">
                  <span
                    className="prompt-library-git-graph-node"
                    style={{ left: `${nodeX}px` }}
                    aria-hidden="true"
                  >
                    <span />
                    {row.promptCount > 0 && <small>{row.promptCount}</small>}
                  </span>
                </span>
                <span className="prompt-library-git-graph-browser__message" style={{ left: `${messageLeft}px` }}>
                  <strong>{row.subject || row.shortHash}</strong>
                  <small>{row.shortHash} · {row.author ? `${row.author} · ` : ''}{formatDate(row.date)}</small>
                </span>
              </button>
            );
          })}
          {(loadingMore || hasMore) && (
            <button
              type="button"
              className="prompt-library-git-graph-browser__load-more"
              style={{ top: `${rows.length * rowHeight + 4}px`, left: `${graphWidth}px` }}
              onClick={onLoadMore}
              disabled={loadingMore}
            >
              {loadingMore ? t('loading') : t('git.loadMore')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface GitGraphRow extends GitPromptCommit {
  lane: number;
  y: number;
  promptCount: number;
}

function buildGitGraphRows(commits: GitPromptCommit[]): GitGraphRow[] & { laneCount: number } {
  const rows = commits.map((commit, index) => ({
    ...commit,
    lane: 0,
    y: 34 + index * 46,
    promptCount: commit.prompts.length,
  })) as GitGraphRow[] & { laneCount: number };
  rows.laneCount = assignGitGraphLanes(rows);
  return rows;
}

function assignGitGraphLanes(rows: GitGraphRow[]): number {
  const rowByHash = new Map(rows.map((row) => [row.hash, row]));
  const active: string[] = [];
  let laneCount = 1;

  for (const row of rows) {
    let lane = active.indexOf(row.hash);
    if (lane < 0) {
      lane = active.findIndex((hash) => !hash || !rowByHash.has(hash));
      if (lane < 0) lane = active.length;
      active[lane] = row.hash;
    }
    row.lane = lane;

    const visibleParents = row.parentHashes.filter((hash) => rowByHash.has(hash));
    if (visibleParents.length > 0) active[lane] = visibleParents[0];
    else active.splice(lane, 1);

    for (let index = 1; index < visibleParents.length; index += 1) {
      const parentHash = visibleParents[index];
      if (!active.includes(parentHash)) active.splice(lane + index, 0, parentHash);
    }

    // Clean up stale duplicate entries of this row's hash in other lanes
    for (let i = active.length - 1; i >= 0; i -= 1) {
      if (active[i] === row.hash) active.splice(i, 1);
    }

    laneCount = Math.max(laneCount, active.length, row.lane + 1);
  }

  return laneCount;
}

function gitGraphMessageLeft(row: GitGraphRow, connections: Array<{ row: GitGraphRow; parent: GitGraphRow }>, laneLeft: number, laneWidth: number, rowHeight: number): number {
  const nodeX = laneLeft + row.lane * laneWidth;
  const baseLeft = nodeX + 18;
  const rowTop = row.y - rowHeight / 2;
  const rowBottom = row.y + rowHeight / 2;
  const maxCrossingX = connections.reduce((maxX, connection) => {
    if (connection.row.hash === row.hash || connection.parent.hash === row.hash) return maxX;
    const sourceY = connection.row.y + 8;
    const targetY = connection.parent.y - 8;
    const crossesRow = Math.min(sourceY, targetY) < rowBottom && Math.max(sourceY, targetY) > rowTop;
    if (!crossesRow) return maxX;
    const sourceX = laneLeft + connection.row.lane * laneWidth;
    const targetX = laneLeft + connection.parent.lane * laneWidth;
    return Math.max(maxX, sourceX, targetX);
  }, 0);
  return Math.max(baseLeft, maxCrossingX > 0 ? maxCrossingX + 18 : baseLeft);
}

function gitGraphEdgePath(source: { x: number; y: number }, target: { x: number; y: number }): string {
  const sourceY = source.y + 8;
  const targetY = target.y - 8;
  if (source.x === target.x) return `M ${source.x} ${sourceY} L ${target.x} ${targetY}`;

  const radius = Math.min(8, Math.abs(targetY - sourceY) / 4, Math.abs(target.x - source.x) / 2);
  const direction = target.x > source.x ? 1 : -1;
  const bendY = sourceY + radius * 1.8;
  return [
    `M ${source.x} ${sourceY}`,
    `L ${source.x} ${bendY - radius}`,
    `C ${source.x} ${bendY}, ${source.x + direction * radius} ${bendY}, ${source.x + direction * radius} ${bendY}`,
    `L ${target.x - direction * radius} ${bendY}`,
    `C ${target.x} ${bendY}, ${target.x} ${bendY + radius}, ${target.x} ${bendY + radius}`,
    `L ${target.x} ${targetY}`,
  ].join(' ');
}

function mergeGitPromptHistory(current: GitPromptCommit[], next: GitPromptCommit[]): GitPromptCommit[] {
  if (next.length === 0) return current;
  const seen = new Set(current.map((commit) => commit.hash));
  const merged = current.slice();
  for (const commit of next) {
    if (!seen.has(commit.hash)) {
      seen.add(commit.hash);
      merged.push(commit);
    }
  }
  return merged;
}

function AssetDetail({ asset, validation, gitStatus, gitDiff, gitHistory, onEdit, t }: {
  asset: PromptAsset;
  validation: PromptValidationReport | null;
  gitStatus: PromptAssetGitStatus | null;
  gitDiff: PromptAssetGitDiff | null;
  gitHistory: PromptAssetGitCommit[];
  onEdit: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <div className="prompt-library-panel">
      <div className="prompt-library-panel__head">
        <div><h3>{asset.metadata.name}</h3><p>{asset.metadata.id} · {asset.relativePath}</p></div>
        <button type="button" className="prompt-library-btn" onClick={onEdit}>{t('actions.edit')}</button>
      </div>
      <div className="prompt-library-meta">
        <span>{t(`kinds.${asset.metadata.kind}`)}</span>
        <span>{t(`scopes.${asset.metadata.scope}`)}</span>
        <span>{t(`status.${asset.metadata.status}`)}</span>
        {gitStatus && <span><GitBranch size={13} /> {gitStatus.isGitRepository ? t('git.enabled') : t('git.disabled')}</span>}
      </div>
      {asset.metadata.description && <p className="prompt-library-description">{asset.metadata.description}</p>}
      <pre className="prompt-library-pre">{asset.body}</pre>
      {validation && <div className={`prompt-library-validation${validation.valid ? ' is-valid' : ' is-invalid'}`}>{validation.valid ? t('validation.valid') : t('validation.invalid')}</div>}
      {gitDiff?.diff && <section className="prompt-library-git"><h4>{t('git.diff')}</h4><pre>{gitDiff.diff}</pre></section>}
      {gitHistory.length > 0 && <section className="prompt-library-git"><h4>{t('git.history')}</h4>{gitHistory.map((commit) => <div key={commit.hash} className="prompt-library-commit"><code>{commit.shortHash}</code><span>{commit.subject}</span></div>)}</section>}
    </div>
  );
}

function AssetEditor({ editor, onChange, onCancel, onSave, t }: {
  editor: EditorState;
  onChange: (state: EditorState) => void;
  onCancel: () => void;
  onSave: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const [hintOpen, setHintOpen] = useState(false);
  const bodyPlaceholder = t('editor.bodyPlaceholder', { defaultValue: 'Write your prompt content here...' });

  return (
    <div className="prompt-library-panel prompt-library-editor">
      <div className="prompt-library-panel__head">
        <div>
          <h3>{t('editor.title')}</h3>
        </div>
      </div>

      <div className="prompt-library-editor__body">
        {/* ---- 编写提示 ---- */}
        <div className="prompt-library-editor__section">
          <button
            type="button"
            className="prompt-library-editor__collapse-bar"
            onClick={() => setHintOpen((o) => !o)}
          >
            <span className={`prompt-library-editor__collapse-chevron ${hintOpen ? 'prompt-library-editor__collapse-chevron--open' : ''}`} />
            <span className="prompt-library-editor__collapse-label">{t('editor.hintLabel')}</span>
          </button>
          {hintOpen && (
            <div className="prompt-library-editor__hint">
              <pre>{t('editor.hintExample')}</pre>
            </div>
          )}
        </div>

        {/* ---- Body ---- */}
        <div className="prompt-library-editor__section">
          <label className="prompt-library-editor__field">
            <span className="prompt-library-editor__label-text">{t('fields.body')}</span>
            <textarea
              className="prompt-library-editor__body-area"
              value={editor.body}
              onChange={(e) => onChange({ ...editor, body: e.target.value })}
              placeholder={bodyPlaceholder}
              spellCheck={false}
            />
          </label>
        </div>
      </div>

      <div className="prompt-library-editor__actions">
        <button type="button" className="prompt-library-btn" onClick={onCancel}>{t('actions.cancel')}</button>
        <button type="button" className="prompt-library-btn prompt-library-btn--primary" onClick={onSave}>{t('actions.save')}</button>
      </div>
    </div>
  );
}

function assetToEditor(asset: PromptAsset): EditorState {
  return {
    id: asset.metadata.id,
    name: asset.metadata.name,
    scope: asset.metadata.scope,
    body: asset.body,
  };
}

function editorToMetadata(editor: EditorState): PromptAssetMetadata {
  return {
    schemaVersion: 2,
    id: editor.id.trim(),
    kind: 'template',
    scope: editor.scope,
    name: editor.name.trim(),
    description: undefined,
    tools: [],
    status: 'draft',
    tags: [],
    dimensions: undefined,
    templateType: 'custom',
  };
}


function promptGitPath(relativePath: string): string { return `.sparo_os/prompts/${relativePath}`; }
function historyCommitInlineLabel(item: PromptHistoryEvent): string | undefined {
  const shortHash = item.afterCommitHash?.slice(0, 8);
  const parts = [
    item.gitBranchAtCreated,
    shortHash,
  ].filter((value): value is string => Boolean(value && value.trim()));
  return parts.length > 0 ? parts.join(' · ') : undefined;
}
function listCountLabel(
  tab: TabId,
  historyLoading: boolean,
  assetsLoading: boolean,
  gitLoading: boolean,
  historyCount: number,
  assetsCount: number,
  gitCount: number,
  t: (key: string) => string,
): string | number {
  if (tab === 'history') return historyLoading ? t('loading') : historyCount;
  if (tab === 'assets') return assetsLoading ? t('loading') : assetsCount;
  return gitLoading ? t('loading') : gitCount;
}
function firstLine(text: string): string { return text.trim().split(/\r?\n/)[0]?.slice(0, 80) || 'Prompt'; }
function titleFromText(text: string): string { return firstLine(text).slice(0, 64); }
function promptIdFromText(text: string): string { return titleFromText(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'prompt'; }
function sourceLabel(source: PromptHistoryEvent['source'], t: (key: string) => string): string {
  return t(`history.sources.${source}`);
}
function formatDate(value: string): string { return new Date(value).toLocaleString(); }
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}m ${seconds}s`;
}
function formatTokens(total: number, input?: number | null, output?: number | null): string {
  const parts: string[] = [`${(total / 1000).toFixed(1)}k`];
  if (input != null) parts.push(`${(input / 1000).toFixed(1)}k in`);
  if (output != null) parts.push(`${(output / 1000).toFixed(1)}k out`);
  return parts.join(' · ');
}
function parseFileChanges(raw: string | undefined): FileChange[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((fc: unknown) => fc && typeof fc === 'object' && 'file' in (fc as Record<string, unknown>))) {
      return parsed as FileChange[];
    }
  } catch {
    // Legacy comma-separated format — return as single entry with no per-file stats
    if (raw.includes(',') || raw.length > 0) {
      return raw.split(',').map((f) => ({ file: f.trim(), added: 0, removed: 0 })).filter((f) => f.file);
    }
  }
  return [];
}
function parseToolTimeline(raw: string | undefined): DetailedToolRecord[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as DetailedToolRecord[];
  } catch { /* ignore */ }
  return [];
}
function parsePrecedingPrompts(raw: string | undefined): PrecedingPromptEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as PrecedingPromptEntry[];
  } catch { /* ignore */ }
  return [];
}
function relativeTime(value: string, t: (key: string, options?: Record<string, unknown>) => string): string {
  const diffMs = Date.now() - new Date(value).getTime();
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return t('history.relativeTime.justNow');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('history.relativeTime.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('history.relativeTime.hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t('history.relativeTime.daysAgo', { count: days });
  const months = Math.floor(days / 30);
  if (months < 12) return t('history.relativeTime.monthsAgo', { count: months });
  return t('history.relativeTime.yearsAgo', { count: Math.floor(months / 12) });
}
function formatError(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export default PromptLibraryScene;
