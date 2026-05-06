import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpenText, FileText, GitBranch, GitCommitHorizontal, Plus, RefreshCw, Save, Search, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceContext } from '@/infrastructure/contexts/WorkspaceContext';
import {
  PromptLibraryAPI,
  type PromptAsset,
  type PromptAssetGitCommit,
  type PromptAssetGitDiff,
  type PromptAssetGitStatus,
  type PromptAssetKind,
  type PromptAssetMetadata,
  type PromptAssetScope,
  type PromptAssetStatus,
  type PromptAssetSummary,
  type GitPromptHistoryCommit,
  type PromptHistoryEvent,
  type PromptHistoryModelSnapshot,
  type PromptLlmAssessment,
  type PromptValueRecord,
  type PromptValidationReport,
} from '@/infrastructure/api/service-api/PromptLibraryAPI';
import { useNotification } from '@/shared/notification-system';
import './PromptLibraryScene.scss';

type TabId = 'history' | 'assets' | 'git';
type Mode = 'view' | 'edit' | 'create';
type PromptValueTier = 'excellent' | 'high' | 'potential' | 'context' | 'normal' | 'risk';
type PromptValueConfidence = 'low' | 'medium' | 'high';

interface EditorState {
  id: string;
  name: string;
  description: string;
  kind: PromptAssetKind;
  scope: PromptAssetScope;
  status: PromptAssetStatus;
  body: string;
}

interface PromptValueCommitLink {
  hash: string;
  shortHash: string;
  subject: string;
  source: 'headMarker' | 'timeWindow';
  confidence: 'direct' | 'inferred';
}

interface PromptValueAssessment {
  score: number;
  tier: PromptValueTier;
  confidence: PromptValueConfidence;
  reuseCount: number;
  reasons: string[];
  warnings: string[];
  assetNames: string[];
  commitLinks: PromptValueCommitLink[];
  llmAssessment?: PromptLlmAssessment;
}

const EMPTY_EDITOR: EditorState = {
  id: '',
  name: '',
  description: '',
  kind: 'template',
  scope: 'project',
  status: 'draft',
  body: '',
};

const SCOPES: PromptAssetScope[] = ['project', 'workspace', 'user'];
const HISTORY_SCOPES: PromptAssetScope[] = ['project', 'user'];
const KINDS: PromptAssetKind[] = ['template', 'snippet', 'agent', 'mode'];
const STATUSES: PromptAssetStatus[] = ['draft', 'staging', 'production', 'archived'];

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
  const [historyAssets, setHistoryAssets] = useState<PromptAssetSummary[]>([]);
  const [history, setHistory] = useState<PromptHistoryEvent[]>([]);
  const [gitPromptHistory, setGitPromptHistory] = useState<GitPromptHistoryCommit[]>([]);
  const [promptValueRecords, setPromptValueRecords] = useState<PromptValueRecord[]>([]);
  const [llmAssessmentRequests, setLlmAssessmentRequests] = useState<Set<string>>(() => new Set());
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

  const selectedHistory = useMemo(
    () => history.find((item) => item.id === selectedHistoryId) ?? null,
    [history, selectedHistoryId],
  );

  const selectedCommit = useMemo(
    () => gitPromptHistory.find((item) => item.hash === selectedCommitHash) ?? null,
    [gitPromptHistory, selectedCommitHash],
  );

  const promptValueAssessments = useMemo(
    () => {
      if (promptValueRecords.length > 0) {
        return promptValueRecordsToAssessments(promptValueRecords, t);
      }
      return assessPromptValues(history, gitPromptHistory, historyAssets, t);
    },
    [gitPromptHistory, history, historyAssets, promptValueRecords, t],
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

  const historyScope = scope === 'user' ? 'user' : 'project';

  const loadHistory = useCallback(async () => {
    if (!workspacePath) return;
    setHistoryLoading(true);
    try {
      const [result, assetResults] = await Promise.all([
        PromptLibraryAPI.listPromptHistory({
          workspacePath,
          scope: historyScope,
          query: query || undefined,
          limit: 200,
        }),
        Promise.allSettled(SCOPES.map((assetScope) => PromptLibraryAPI.listPromptAssets(workspacePath, assetScope))),
      ]);
      setHistory(result.events);
      setHistoryAssets(assetResults.flatMap((assetResult) => assetResult.status === 'fulfilled' ? assetResult.value : []));
      const valueRecords = await PromptLibraryAPI.listPromptValues(workspacePath, historyScope, 500).catch(() => []);
      setPromptValueRecords(valueRecords);
      setSelectedHistoryId((current) => current && result.events.some((item) => item.id === current) ? current : result.events[0]?.id ?? null);
    } catch (error) {
      notifyError(t('messages.loadHistoryFailed', { error: formatError(error) }));
    } finally {
      setHistoryLoading(false);
    }
  }, [historyScope, notifyError, query, t, workspacePath]);

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
    if (!workspacePath) return;
    setGitLoading(true);
    try {
      const commits = await PromptLibraryAPI.listGitPromptHistory(workspacePath, 60);
      setGitPromptHistory(commits);
      const valueRecords = await PromptLibraryAPI.listPromptValues(workspacePath, 'project', 500).catch(() => []);
      setPromptValueRecords(valueRecords);
      setSelectedCommitHash((current) => current && commits.some((item) => item.hash === current) ? current : commits[0]?.hash ?? null);
    } catch (error) {
      notifyError(t('messages.loadGitHistoryFailed', { error: formatError(error) }));
    } finally {
      setGitLoading(false);
    }
  }, [notifyError, t, workspacePath]);

  const requestSelectedPromptLlmAssessment = useCallback(async () => {
    if (!workspacePath || !selectedHistory) return;
    setLlmAssessmentRequests((current) => new Set(current).add(selectedHistory.id));
    try {
      const assessment = await PromptLibraryAPI.requestPromptLlmAssessment({
        workspacePath,
        sourceWorkspacePath: selectedHistory.workspacePath,
        historyEventId: selectedHistory.id,
      });
      setPromptValueRecords((records) => records.map((record) => (
        record.promptHistoryEventId === selectedHistory.id
          ? { ...record, llmAssessment: assessment }
          : record
      )));
      notifySuccess(t('messages.llmAssessmentStarted'));
      window.setTimeout(() => {
        void loadHistory();
      }, 1500);
    } catch (error) {
      notifyError(t('messages.llmAssessmentFailed', { error: formatError(error) }));
    } finally {
      setLlmAssessmentRequests((current) => {
        const next = new Set(current);
        next.delete(selectedHistory.id);
        return next;
      });
    }
  }, [loadHistory, notifyError, notifySuccess, selectedHistory, t, workspacePath]);

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
    if (!editor.id.trim() || !editor.name.trim() || !editor.body.trim()) {
      notifyError(t('messages.required'));
      return;
    }
    try {
      const asset = await PromptLibraryAPI.savePromptAsset({
        workspacePath,
        metadata: editorToMetadata(editor),
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

  const validateEditor = useCallback(async () => {
    try {
      const report = await PromptLibraryAPI.validatePromptContent(editorToMarkdown(editor));
      setValidation(report);
      if (report.valid) notifySuccess(t('messages.valid'));
      else notifyError(t('messages.invalid'));
    } catch (error) {
      notifyError(t('messages.validationFailed', { error: formatError(error) }));
    }
  }, [editor, notifyError, notifySuccess, t]);

  const promoteSelectedHistory = useCallback(async () => {
    if (!workspacePath || !selectedHistory) return;
    const metadata = editorToMetadata({
      ...EMPTY_EDITOR,
      id: promptIdFromText(selectedHistory.text),
      name: titleFromText(selectedHistory.text),
      description: t('history.assetDescription', { sessionId: selectedHistory.sessionId }),
      scope,
      body: selectedHistory.text,
    });
    try {
      const asset = await PromptLibraryAPI.promotePromptHistoryToAsset({
        workspacePath,
        sourceWorkspacePath: selectedHistory.workspacePath,
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

      <main className="prompt-library-workbench">
        <aside className="prompt-library-list">
          <div className="prompt-library-list__head">
            <span>{tab === 'history' ? t('tabs.history') : tab === 'assets' ? t('tabs.assets') : t('tabs.git')}</span>
            <small>{listCountLabel(tab, historyLoading, assetsLoading, gitLoading, filteredHistory.length, filteredAssets.length, filteredGitPromptHistory.length, t)}</small>
          </div>
          <div className="prompt-library-list__scroll">
            {tab === 'history' ? filteredHistory.map((item) => {
              const assessment = promptValueAssessments.get(item.id) ?? defaultPromptValueAssessment(item);
              return (
                <button key={item.id} type="button" className={`prompt-library-row prompt-library-row--value-${assessment.tier}${selectedHistoryId === item.id ? ' is-active' : ''}`} onClick={() => setSelectedHistoryId(item.id)}>
                  <FileText size={15} />
                  <span className="prompt-library-row__content">
                    <strong>{firstLine(item.text)}</strong>
                    <small>{item.agentType} - {formatDate(item.createdAt)}</small>
                    {assessment.tier !== 'normal' && (
                      <span className={`prompt-library-value-badge prompt-library-value-badge--${assessment.tier}`}>
                        {t(`value.tiers.${assessment.tier}`)} · {assessment.score} · {t(`value.confidence.${assessment.confidence}`)}
                      </span>
                    )}
                  </span>
                </button>
              );
            }) : tab === 'assets' ? filteredAssets.map((asset) => (
              <button key={asset.id} type="button" className={`prompt-library-row${selectedAssetId === asset.id ? ' is-active' : ''}`} onClick={() => setSelectedAssetId(asset.id)}>
                <BookOpenText size={15} />
                <span><strong>{asset.name}</strong><small>{t(`kinds.${asset.kind}`)} · {t(`status.${asset.status}`)}</small></span>
              </button>
            )) : filteredGitPromptHistory.map((commit) => (
              <button key={commit.hash} type="button" className={`prompt-library-row${selectedCommitHash === commit.hash ? ' is-active' : ''}`} onClick={() => setSelectedCommitHash(commit.hash)}>
                <GitCommitHorizontal size={15} />
                <span>
                  <strong>{commit.subject || commit.shortHash}</strong>
                  <small>{commit.shortHash} - {formatDate(commit.date)} - {t('git.promptCount', { count: commit.prompts.length })}</small>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="prompt-library-detail">
          {tab === 'history' ? (
            <HistoryDetail
              item={selectedHistory}
              assessment={selectedHistory ? promptValueAssessments.get(selectedHistory.id) ?? defaultPromptValueAssessment(selectedHistory) : null}
              onPromote={promoteSelectedHistory}
              onRequestLlmAssessment={requestSelectedPromptLlmAssessment}
              llmAssessmentRequesting={selectedHistory ? llmAssessmentRequests.has(selectedHistory.id) : false}
              t={t}
            />
          ) : tab === 'git' ? (
            <GitPromptDetail commit={selectedCommit} assessments={promptValueAssessments} t={t} />
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
              validation={validation}
              onChange={setEditor}
              onCancel={() => setMode(selectedAsset ? 'view' : 'create')}
              onSave={saveEditor}
              onValidate={validateEditor}
              t={t}
            />
          )}
        </section>
      </main>
    </div>
  );
};

function HistoryDetail({ item, assessment, onPromote, onRequestLlmAssessment, llmAssessmentRequesting, t }: {
  item: PromptHistoryEvent | null;
  assessment: PromptValueAssessment | null;
  onPromote: () => void;
  onRequestLlmAssessment: () => void;
  llmAssessmentRequesting: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  if (!item) return <div className="prompt-library-placeholder">{t('history.emptySelection')}</div>;

  const context = item.context;
  const model = context?.model;
  const session = context?.session;
  const globalAi = context?.globalAi;
  const runtime = context?.runtime;

  return (
    <div className="prompt-library-panel">
      <div className="prompt-library-panel__head">
        <div><h3>{t('history.detailTitle')}</h3><p>{item.sessionId} - {formatDate(item.createdAt)}</p></div>
        <button type="button" className="prompt-library-btn prompt-library-btn--primary" onClick={onPromote}><Save size={15} />{t('actions.saveAsAsset')}</button>
      </div>
      <div className="prompt-library-meta">
        <span>{item.agentType}</span>
        <span>{sourceLabel(item.source, t)}</span>
        {modelDisplay(model) && <span>{modelDisplay(model)}</span>}
        {runtime && runtime.imageContextCount > 0 && <span>{t('history.badges.images', { count: runtime.imageContextCount })}</span>}
      </div>
      {assessment && (
        <PromptValuePanel
          assessment={assessment}
          onRequestLlmAssessment={onRequestLlmAssessment}
          llmAssessmentRequesting={llmAssessmentRequesting}
          t={t}
        />
      )}
      <div className="prompt-library-history-sections">
        <HistoryInfoSection title={t('history.sections.model')} rows={[
          { label: t('history.fields.modelDisplay'), value: modelDisplay(model) },
          { label: t('history.fields.requestedModelId'), value: model?.requestedModelId },
          { label: t('history.fields.resolvedModelId'), value: model?.resolvedModelId },
          { label: t('history.fields.provider'), value: model?.provider },
          { label: t('history.fields.modelName'), value: model?.modelName },
          { label: t('history.fields.baseUrl'), value: model?.baseUrl },
          { label: t('history.fields.requestUrl'), value: model?.requestUrl },
          { label: t('history.fields.enabled'), value: formatBoolean(model?.enabled, t) },
          { label: t('history.fields.contextWindow'), value: model?.contextWindow },
          { label: t('history.fields.maxTokens'), value: model?.maxTokens },
          { label: t('history.fields.temperature'), value: model?.temperature },
          { label: t('history.fields.topP'), value: model?.topP },
          { label: t('history.fields.category'), value: model?.category },
          { label: t('history.fields.capabilities'), value: formatList(model?.capabilities) },
          { label: t('history.fields.reasoningMode'), value: model?.reasoningMode },
          { label: t('history.fields.reasoningEffort'), value: model?.reasoningEffort },
          { label: t('history.fields.thinkingBudgetTokens'), value: model?.thinkingBudgetTokens },
          { label: t('history.fields.authType'), value: model?.authType },
          { label: t('history.fields.inlineThinkInText'), value: formatBoolean(model?.inlineThinkInText, t) },
          { label: t('history.fields.customHeaders'), value: formatBoolean(model?.hasCustomHeaders, t) },
          { label: t('history.fields.customHeadersMode'), value: model?.customHeadersMode },
          { label: t('history.fields.customRequestBody'), value: formatBoolean(model?.hasCustomRequestBody, t) },
          { label: t('history.fields.customRequestBodyMode'), value: model?.customRequestBodyMode },
          { label: t('history.fields.skipSslVerify'), value: formatBoolean(model?.skipSslVerify, t) },
        ]} />
        <HistoryInfoSection title={t('history.sections.session')} rows={[
          { label: t('history.fields.sessionName'), value: session?.sessionName },
          { label: t('history.fields.sessionId'), value: item.sessionId },
          { label: t('history.fields.turnId'), value: item.turnId },
          { label: t('history.fields.sessionKind'), value: session?.sessionKind },
          { label: t('history.fields.workspacePath'), value: session?.workspacePath ?? item.workspacePath },
          { label: t('history.fields.storageScope'), value: session?.storageScope },
          { label: t('history.fields.remoteConnectionId'), value: session?.remoteConnectionId },
          { label: t('history.fields.remoteSshHost'), value: session?.remoteSshHost },
          { label: t('history.fields.sessionModelId'), value: session?.modelId },
          { label: t('history.fields.maxContextTokens'), value: session?.maxContextTokens },
          { label: t('history.fields.maxTurns'), value: session?.maxTurns },
          { label: t('history.fields.enableTools'), value: formatBoolean(session?.enableTools, t) },
          { label: t('history.fields.safeMode'), value: formatBoolean(session?.safeMode, t) },
          { label: t('history.fields.autoCompact'), value: formatBoolean(session?.autoCompact, t) },
          { label: t('history.fields.enableContextCompression'), value: formatBoolean(session?.enableContextCompression, t) },
          { label: t('history.fields.compressionThreshold'), value: formatPercent(session?.compressionThreshold) },
        ]} />
        <HistoryInfoSection title={t('history.sections.runtime')} rows={[
          { label: t('history.fields.triggerSource'), value: context?.triggerSource },
          { label: t('history.fields.persistAgentType'), value: formatBoolean(runtime?.persistAgentType, t) },
          { label: t('history.fields.systemReminderOverride'), value: formatBoolean(runtime?.systemReminderOverridePresent, t) },
          { label: t('history.fields.imageContextCount'), value: runtime?.imageContextCount },
          { label: t('history.fields.promptHash'), value: item.promptHash },
          { label: t('history.fields.afterCommitHash'), value: item.afterCommitHash },
          { label: t('history.fields.gitBranchAtCreated'), value: item.gitBranchAtCreated },
          { label: t('history.fields.historyId'), value: item.id },
          { label: t('history.fields.pinned'), value: formatBoolean(item.pinned, t) },
        ]} />
        <HistoryInfoSection title={t('history.sections.globalAi')} rows={[
          { label: t('history.fields.defaultPrimaryModelId'), value: globalAi?.defaultPrimaryModelId },
          { label: t('history.fields.defaultFastModelId'), value: globalAi?.defaultFastModelId },
          { label: t('history.fields.agentModelId'), value: globalAi?.agentModelId },
          { label: t('history.fields.streamIdleTimeoutSecs'), value: globalAi?.streamIdleTimeoutSecs },
          { label: t('history.fields.toolExecutionTimeoutSecs'), value: globalAi?.toolExecutionTimeoutSecs },
          { label: t('history.fields.toolConfirmationTimeoutSecs'), value: globalAi?.toolConfirmationTimeoutSecs },
          { label: t('history.fields.skipToolConfirmation'), value: formatBoolean(globalAi?.skipToolConfirmation, t) },
          { label: t('history.fields.proxyEnabled'), value: formatBoolean(globalAi?.proxyEnabled, t) },
          { label: t('history.fields.computerUseEnabled'), value: formatBoolean(globalAi?.computerUseEnabled, t) },
          { label: t('history.fields.workspaceAutoMemoryEnabled'), value: formatBoolean(globalAi?.workspaceAutoMemoryEnabled, t) },
          { label: t('history.fields.globalAutoMemoryEnabled'), value: formatBoolean(globalAi?.globalAutoMemoryEnabled, t) },
        ]} />
      </div>
      <section className="prompt-library-prompt-block">
        <h4>{t('history.sections.promptText')}</h4>
        <pre className="prompt-library-pre">{item.text}</pre>
      </section>
      {item.originalText && (
        <section className="prompt-library-prompt-block">
          <h4>{t('history.sections.originalText')}</h4>
          <pre className="prompt-library-pre prompt-library-pre--muted">{item.originalText}</pre>
        </section>
      )}
    </div>
  );
}

function PromptValuePanel({ assessment, onRequestLlmAssessment, llmAssessmentRequesting, t }: {
  assessment: PromptValueAssessment;
  onRequestLlmAssessment?: () => void;
  llmAssessmentRequesting?: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const llm = assessment.llmAssessment;
  const canRequestLlm = Boolean(onRequestLlmAssessment)
    && !llmAssessmentRequesting
    && (!llm || llm.status === 'failed' || llm.status === 'skipped');
  const recommendedActionLabel = llm?.recommendedAction
    ? formatLlmRecommendedAction(llm.recommendedAction, t)
    : undefined;
  return (
    <section className={`prompt-library-value-panel prompt-library-value-panel--${assessment.tier}`}>
      <div className="prompt-library-value-panel__summary">
        <div>
          <h4>{t('value.title')}</h4>
          <p>{t('value.subtitle')}</p>
        </div>
        <div className="prompt-library-value-score">
          <strong>{assessment.score}</strong>
          <span>{t(`value.tiers.${assessment.tier}`)} · {t(`value.confidence.${assessment.confidence}`)}</span>
        </div>
      </div>
      <div className="prompt-library-llm-reference">
        <div className="prompt-library-llm-reference__head">
          <div>
            <h5>{t('value.llm.title')}</h5>
            <p>{llm ? t(`value.llm.status.${llm.status}`) : t('value.llm.notRequested')}</p>
          </div>
          {onRequestLlmAssessment && (
            <button
              type="button"
              className="prompt-library-btn"
              onClick={onRequestLlmAssessment}
              disabled={!canRequestLlm}
            >
              <Sparkles size={14} />
              {llmAssessmentRequesting || llm?.status === 'running' ? t('value.llm.requesting') : t('value.llm.request')}
            </button>
          )}
        </div>
        {llm && (
          <div className="prompt-library-llm-reference__body">
            <div className="prompt-library-llm-score">
              <strong>{llm.llmScore ?? '-'}</strong>
              <span>{llm.confidence ? t(`value.confidence.${llm.confidence}`) : t(`value.llm.status.${llm.status}`)}</span>
            </div>
            <div>
              {llm.model && <p className="prompt-library-llm-muted">{llm.model}</p>}
              {llm.attempts > 0 && <p className="prompt-library-llm-muted">{t('value.llm.attempts', { count: llm.attempts })}</p>}
              {llm.impactSummary && <p>{llm.impactSummary}</p>}
              {recommendedActionLabel && <p className="prompt-library-llm-muted">{t('value.llm.recommendedAction', { action: recommendedActionLabel })}</p>}
              {llm.error && <p className="prompt-library-llm-error">{llm.error}</p>}
            </div>
          </div>
        )}
        {llm && llm.rationale.length > 0 && (
          <ul className="prompt-library-llm-list">
            {llm.rationale.slice(0, 3).map((item) => <li key={item}>{item}</li>)}
          </ul>
        )}
      </div>
      <div className="prompt-library-value-panel__body">
        {assessment.reasons.length > 0 && (
          <div>
            <h5>{t('value.reasons')}</h5>
            <ul>
              {assessment.reasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          </div>
        )}
        {assessment.warnings.length > 0 && (
          <div>
            <h5>{t('value.warnings')}</h5>
            <ul>
              {assessment.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          </div>
        )}
        {assessment.commitLinks.length > 0 && (
          <div>
            <h5>{t('value.commitContext')}</h5>
            <ul>
              {assessment.commitLinks.slice(0, 4).map((commit) => (
                <li key={commit.hash}>
                  <code>{commit.shortHash}</code> {commit.subject || commit.hash} · {t(`value.commitSources.${commit.source}`)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function formatLlmRecommendedAction(
  action: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const normalized = action.trim();
  if (['save', 'promote', 'revise', 'ignore', 'watch'].includes(normalized)) {
    return t(`value.llm.actions.${normalized}`);
  }
  return normalized;
}

function GitPromptDetail({ commit, assessments, t }: {
  commit: GitPromptHistoryCommit | null;
  assessments: Map<string, PromptValueAssessment>;
  t: (key: string, options?: Record<string, unknown>) => string;
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
          {commit.prompts.map((prompt) => {
            const assessment = assessments.get(prompt.id) ?? defaultPromptValueAssessment(prompt);
            return (
            <section key={prompt.id} className={`prompt-library-git-prompt prompt-library-git-prompt--value-${assessment.tier}`}>
              <div className="prompt-library-git-prompt__head">
                <div>
                  <h4>{firstLine(prompt.text)}</h4>
                  <p>{prompt.agentType} - {formatDate(prompt.createdAt)}</p>
                  {assessment.tier !== 'normal' && (
                    <span className={`prompt-library-value-badge prompt-library-value-badge--${assessment.tier}`}>
                      {t(`value.tiers.${assessment.tier}`)} · {assessment.score} · {t(`value.confidence.${assessment.confidence}`)}
                    </span>
                  )}
                </div>
                <code>{prompt.id}</code>
              </div>
              <pre className="prompt-library-pre">{prompt.text}</pre>
            </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface HistoryDetailRow {
  label: string;
  value?: React.ReactNode;
}

function HistoryInfoSection({ title, rows }: { title: string; rows: HistoryDetailRow[] }) {
  const visibleRows = rows.filter((row) => row.value !== undefined && row.value !== null && row.value !== '');
  if (visibleRows.length === 0) return null;
  return (
    <section className="prompt-library-info-section">
      <h4>{title}</h4>
      <dl>
        {visibleRows.map((row) => (
          <React.Fragment key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </React.Fragment>
        ))}
      </dl>
    </section>
  );
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

function AssetEditor({ editor, validation, onChange, onCancel, onSave, onValidate, t }: {
  editor: EditorState;
  validation: PromptValidationReport | null;
  onChange: (state: EditorState) => void;
  onCancel: () => void;
  onSave: () => void;
  onValidate: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const update = <K extends keyof EditorState>(key: K, value: EditorState[K]) => onChange({ ...editor, [key]: value });
  return (
    <div className="prompt-library-panel prompt-library-editor">
      <div className="prompt-library-panel__head"><div><h3>{t('editor.title')}</h3><p>{t('editor.subtitle')}</p></div></div>
      <div className="prompt-library-form-grid">
        <label>{t('fields.id')}<input value={editor.id} onChange={(e) => update('id', e.target.value)} /></label>
        <label>{t('fields.name')}<input value={editor.name} onChange={(e) => update('name', e.target.value)} /></label>
        <label>{t('fields.kind')}<select value={editor.kind} onChange={(e) => update('kind', e.target.value as PromptAssetKind)}>{KINDS.map((v) => <option key={v} value={v}>{t(`kinds.${v}`)}</option>)}</select></label>
        <label>{t('fields.status')}<select value={editor.status} onChange={(e) => update('status', e.target.value as PromptAssetStatus)}>{STATUSES.map((v) => <option key={v} value={v}>{t(`status.${v}`)}</option>)}</select></label>
      </div>
      <label className="prompt-library-full-field">{t('fields.description')}<input value={editor.description} onChange={(e) => update('description', e.target.value)} /></label>
      <label className="prompt-library-full-field">{t('fields.body')}<textarea value={editor.body} onChange={(e) => update('body', e.target.value)} /></label>
      {validation && <div className={`prompt-library-validation${validation.valid ? ' is-valid' : ' is-invalid'}`}>{validation.valid ? t('validation.valid') : validation.issues.map((issue) => issue.message).join('\n')}</div>}
      <div className="prompt-library-editor__actions">
        <button type="button" className="prompt-library-btn" onClick={onCancel}>{t('actions.cancel')}</button>
        <button type="button" className="prompt-library-btn" onClick={onValidate}>{t('actions.validate')}</button>
        <button type="button" className="prompt-library-btn prompt-library-btn--primary" onClick={onSave}>{t('actions.save')}</button>
      </div>
    </div>
  );
}

function promptValueRecordsToAssessments(
  records: PromptValueRecord[],
  t: (key: string, options?: Record<string, unknown>) => string,
): Map<string, PromptValueAssessment> {
  const assessments = new Map<string, PromptValueAssessment>();
  for (const record of records) {
    const assetNames = record.signals
      .filter((signal) => signal.kind === 'savedAsAsset')
      .map((signal) => stringFromMetadata(signal.metadata, 'assetName'))
      .filter((name): name is string => Boolean(name));
    const commitSignals = record.signals.filter((signal) => signal.kind === 'commitWindow');
    const commitLinks = record.signals
      .filter((signal) => signal.kind === 'commitWindow')
      .map((signal) => {
        const metadata = signal.metadata ?? {};
        return {
          hash: typeof metadata.commitHash === 'string' ? metadata.commitHash : signal.id,
          shortHash: typeof metadata.shortHash === 'string' ? metadata.shortHash : signal.id.slice(0, 8),
          subject: typeof metadata.subject === 'string' ? metadata.subject : signal.reason,
          source: metadata.source === 'headMarker' ? 'headMarker' as const : 'timeWindow' as const,
          confidence: 'inferred' as const,
        };
      });
    const messages = localizedPromptValueMessages(record, assetNames, commitSignals.length, t);

    assessments.set(record.promptHistoryEventId, {
      score: record.score,
      tier: record.tier,
      confidence: record.confidence,
      reuseCount: record.reuseCount,
      reasons: messages.reasons,
      warnings: messages.warnings,
      assetNames,
      commitLinks,
      llmAssessment: record.llmAssessment,
    });
  }
  return assessments;
}

function localizedPromptValueMessages(
  record: PromptValueRecord,
  assetNames: string[],
  commitContextCount: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): { reasons: string[]; warnings: string[] } {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const hasSignal = (kind: string) => record.signals.some((signal) => signal.kind === kind);
  const countSignals = (kind: string) => record.signals.filter((signal) => signal.kind === kind).length;

  if (assetNames.length > 0) {
    reasons.push(t('value.reason.savedAsAsset', { count: assetNames.length, names: assetNames.join(', ') }));
  }
  if (record.reuseCount >= 2) {
    reasons.push(t('value.reason.reused', { count: record.reuseCount }));
  }
  if (hasSignal('userPinned')) {
    reasons.push(t('value.reason.pinned'));
  }
  if (hasSignal('userFeedback')) {
    reasons.push(t('value.reason.userFeedback'));
  }
  if (hasSignal('turnCompleted')) {
    reasons.push(t('value.reason.turnCompleted', { count: countSignals('turnCompleted') }));
  }
  if (hasSignal('assetUsed')) {
    reasons.push(t('value.reason.assetUsed', { count: countSignals('assetUsed') }));
  }
  if (commitContextCount > 0) {
    reasons.push(t('value.reason.commitContext', { count: commitContextCount }));
  }
  if (hasSignal('structuredPrompt')) {
    reasons.push(t('value.reason.structured'));
  }
  if (hasSignal('imageContext')) {
    reasons.push(t('value.reason.hasImages'));
  }
  if (hasSignal('toolSucceeded')) {
    reasons.push(t('value.reason.toolSucceeded', { count: countSignals('toolSucceeded') }));
  }

  if (hasSignal('turnFailed')) {
    warnings.push(t('value.warning.turnFailed'));
  }
  if (hasSignal('turnCancelled')) {
    warnings.push(t('value.warning.turnCancelled'));
  }
  if (hasSignal('retry')) {
    warnings.push(t('value.warning.retry'));
  }
  if (hasSignal('correctionPrompt')) {
    warnings.push(t('value.warning.correction'));
  }
  if (hasSignal('toolFailed')) {
    warnings.push(t('value.warning.toolFailed', { count: countSignals('toolFailed') }));
  }
  if (hasSignal('rollback')) {
    warnings.push(t('value.warning.rollback'));
  }
  if (record.signals.some((signal) => signal.kind === 'structuredPrompt' && signal.weight < 0)) {
    warnings.push(t('value.warning.tooShort'));
  }

  dedupeStringList(reasons);
  dedupeStringList(warnings);
  if (reasons.length === 0 && warnings.length === 0) {
    reasons.push(t('value.reason.noStrongSignal'));
  }
  return { reasons, warnings };
}

function dedupeStringList(values: string[]): void {
  const seen = new Set<string>();
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (seen.has(value)) values.splice(index, 1);
    else seen.add(value);
  }
}

function stringFromMetadata(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function assessPromptValues(
  history: PromptHistoryEvent[],
  gitPromptHistory: GitPromptHistoryCommit[],
  assets: PromptAssetSummary[],
  t: (key: string, options?: Record<string, unknown>) => string,
): Map<string, PromptValueAssessment> {
  const eventsById = new Map<string, PromptHistoryEvent>();
  for (const event of history) eventsById.set(event.id, event);
  for (const commit of gitPromptHistory) {
    for (const prompt of commit.prompts) eventsById.set(prompt.id, prompt);
  }

  const promptHashCounts = new Map<string, number>();
  for (const event of eventsById.values()) {
    promptHashCounts.set(event.promptHash, (promptHashCounts.get(event.promptHash) ?? 0) + 1);
  }

  const assetsByHistoryId = new Map<string, PromptAssetSummary[]>();
  for (const asset of assets) {
    if (!asset.sourceHistoryEventId) continue;
    const current = assetsByHistoryId.get(asset.sourceHistoryEventId) ?? [];
    current.push(asset);
    assetsByHistoryId.set(asset.sourceHistoryEventId, current);
  }

  const commitLinksByPromptId = new Map<string, PromptValueCommitLink[]>();
  for (const commit of gitPromptHistory) {
    const source = commit.trace?.source ?? 'timeWindow';
    const confidence = commit.trace?.confidence ?? 'inferred';
    for (const prompt of commit.prompts) {
      const current = commitLinksByPromptId.get(prompt.id) ?? [];
      current.push({
        hash: commit.hash,
        shortHash: commit.shortHash,
        subject: commit.subject,
        source,
        confidence,
      });
      commitLinksByPromptId.set(prompt.id, current);
    }
  }

  const assessments = new Map<string, PromptValueAssessment>();
  for (const event of eventsById.values()) {
    assessments.set(event.id, assessPromptValue(event, {
      reuseCount: promptHashCounts.get(event.promptHash) ?? 1,
      assets: assetsByHistoryId.get(event.id) ?? [],
      commitLinks: commitLinksByPromptId.get(event.id) ?? [],
      t,
    }));
  }
  return assessments;
}

function assessPromptValue(
  event: PromptHistoryEvent,
  context: {
    reuseCount: number;
    assets: PromptAssetSummary[];
    commitLinks: PromptValueCommitLink[];
    t: (key: string, options?: Record<string, unknown>) => string;
  },
): PromptValueAssessment {
  const { reuseCount, assets, commitLinks, t } = context;
  const reasons: string[] = [];
  const warnings: string[] = [];
  const text = event.text.trim();
  let score = 20;

  if (assets.length > 0) {
    score += 35;
    const assetNames = assets.map((asset) => asset.name).join(', ');
    reasons.push(t('value.reason.savedAsAsset', { count: assets.length, names: assetNames }));
    if (assets.some((asset) => asset.status === 'production')) score += 8;
    else if (assets.some((asset) => asset.status === 'staging')) score += 5;
  }

  if (event.pinned) {
    score += 25;
    reasons.push(t('value.reason.pinned'));
  }

  if (reuseCount >= 5) {
    score += 24;
    reasons.push(t('value.reason.reused', { count: reuseCount }));
  } else if (reuseCount >= 3) {
    score += 18;
    reasons.push(t('value.reason.reused', { count: reuseCount }));
  } else if (reuseCount >= 2) {
    score += 11;
    reasons.push(t('value.reason.reused', { count: reuseCount }));
  }

  if (commitLinks.length > 0) {
    const hasHeadMarker = commitLinks.some((link) => link.source === 'headMarker');
    score += hasHeadMarker ? 14 : 10;
    score += Math.min((commitLinks.length - 1) * 2, 6);
    reasons.push(t('value.reason.commitContext', { count: commitLinks.length }));
  }

  if (hasPromptStructure(text)) {
    score += 8;
    reasons.push(t('value.reason.structured'));
  }

  if (text.length >= 120 && text.length <= 5000) {
    score += 5;
  } else if (text.length < 40) {
    score -= 8;
    warnings.push(t('value.warning.tooShort'));
  }

  if ((event.context?.runtime.imageContextCount ?? 0) > 0) {
    score += 4;
    reasons.push(t('value.reason.hasImages'));
  }

  if (event.source === 'retry') {
    score -= 18;
    warnings.push(t('value.warning.retry'));
  }

  if (looksLikeCorrectionPrompt(text)) {
    score -= 10;
    warnings.push(t('value.warning.correction'));
  }

  score = clampScore(score);
  const hasStrongSignal = assets.length > 0 || event.pinned || reuseCount >= 2;
  const confidence = promptValueConfidence(score, hasStrongSignal, assets.length > 0, event.pinned, reuseCount, commitLinks.length);
  const tier = promptValueTier(score, hasStrongSignal, commitLinks.length > 0, warnings.length > 0);

  if (reasons.length === 0 && warnings.length === 0) {
    reasons.push(t('value.reason.noStrongSignal'));
  }

  return {
    score,
    tier,
    confidence,
    reuseCount,
    reasons,
    warnings,
    assetNames: assets.map((asset) => asset.name),
    commitLinks,
    llmAssessment: undefined,
  };
}

function defaultPromptValueAssessment(event: PromptHistoryEvent): PromptValueAssessment {
  return {
    score: event.source === 'retry' ? 10 : 20,
    tier: event.source === 'retry' ? 'risk' : 'normal',
    confidence: 'low',
    reuseCount: 1,
    reasons: [],
    warnings: [],
    assetNames: [],
    commitLinks: [],
    llmAssessment: undefined,
  };
}

function promptValueTier(score: number, hasStrongSignal: boolean, hasCommitContext: boolean, hasWarning: boolean): PromptValueTier {
  if (score < 20 && hasWarning) return 'risk';
  if (score >= 80) return 'excellent';
  if (score >= 65) return 'high';
  if (score >= 45) return 'potential';
  if (hasCommitContext && !hasStrongSignal) return 'context';
  if (score < 25 && hasWarning) return 'risk';
  return 'normal';
}

function promptValueConfidence(
  score: number,
  hasStrongSignal: boolean,
  savedAsAsset: boolean,
  pinned: boolean,
  reuseCount: number,
  commitLinkCount: number,
): PromptValueConfidence {
  if (savedAsAsset || pinned || reuseCount >= 3) return 'high';
  if (hasStrongSignal || score >= 55 || (commitLinkCount > 0 && score >= 40)) return 'medium';
  return 'low';
}

function hasPromptStructure(text: string): boolean {
  const lineCount = text.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
  const structuredMarkers = /(目标|要求|约束|输出|验收|步骤|背景|不要|请先|plan|steps|requirements|constraints|acceptance|output|goal|context)/i;
  return lineCount >= 4 || structuredMarkers.test(text);
}

function looksLikeCorrectionPrompt(text: string): boolean {
  return /(不是|不对|重做|重新来|你理解错|修复刚才|刚才的问题|wrong|not what i meant|redo|try again|fix the previous)/i.test(text);
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function assetToEditor(asset: PromptAsset): EditorState {
  return {
    id: asset.metadata.id,
    name: asset.metadata.name,
    description: asset.metadata.description ?? '',
    kind: asset.metadata.kind,
    scope: asset.metadata.scope,
    status: asset.metadata.status,
    body: asset.body,
  };
}

function editorToMetadata(editor: EditorState): PromptAssetMetadata {
  return {
    schemaVersion: 1,
    id: editor.id.trim(),
    kind: editor.kind,
    scope: editor.scope,
    name: editor.name.trim(),
    description: editor.description.trim() || undefined,
    tools: [],
    status: editor.status,
    tags: [],
  };
}

function editorToMarkdown(editor: EditorState): string {
  const metadata = editorToMetadata(editor);
  return `---\nschemaVersion: ${metadata.schemaVersion}\nid: ${metadata.id}\nkind: ${metadata.kind}\nscope: ${metadata.scope}\nname: ${metadata.name}\nstatus: ${metadata.status}\n---\n\n${editor.body}`;
}

function promptGitPath(relativePath: string): string { return `.sparo_os/prompts/${relativePath}`; }
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
function modelDisplay(model?: PromptHistoryModelSnapshot): string | undefined {
  if (!model) return undefined;
  const name = model.modelName || model.name || model.resolvedModelId || model.requestedModelId;
  if (!name) return undefined;
  return model.provider ? `${model.provider} - ${name}` : name;
}
function sourceLabel(source: PromptHistoryEvent['source'], t: (key: string) => string): string {
  return t(`history.sources.${source}`);
}
function formatBoolean(value: boolean | undefined, t: (key: string) => string): string | undefined {
  if (value === undefined) return undefined;
  return value ? t('common.yes') : t('common.no');
}
function formatList(value: string[] | undefined): string | undefined {
  return value && value.length > 0 ? value.join(', ') : undefined;
}
function formatPercent(value: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  return `${Math.round(value * 100)}%`;
}
function formatDate(value: string): string { return new Date(value).toLocaleString(); }
function formatError(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export default PromptLibraryScene;
