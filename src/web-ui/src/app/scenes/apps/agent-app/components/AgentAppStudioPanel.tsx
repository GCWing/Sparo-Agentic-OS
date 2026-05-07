/**
 * AgentAppStudioPanel — right-side preview for Agent App Studio sessions.
 *
 * Shows the latest Agent App package the studio has produced (or any package
 * passed via `appId`), with a hero summary plus tabbed views for the prompt,
 * tools and examples. The panel listens to `agent-app-updated` window events
 * emitted by the Agent App Studio tool cards so it auto-refreshes after
 * Create/Update.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AppWindow,
  Bot,
  Check,
  Copy,
  ExternalLink,
  Lock,
  RefreshCw,
  Sparkles,
  Tag,
  Wrench,
} from 'lucide-react';
import { agentAppAPI } from '@/infrastructure/api/service-api/AgentAppAPI';
import type { AgentAppPackage } from '@/infrastructure/api/service-api/AgentAppAPI';
import { useLastUsedWorkspace } from '@/infrastructure/contexts/WorkspaceContext';
import { useI18n } from '@/infrastructure/i18n';
import { useOverlayManager } from '@/app/hooks/useOverlayManager';
import { Button, Empty, IconButton } from '@/component-library';
import { MarkdownEditor } from '@/tools/editor/components';
import { notificationService } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import './AgentAppStudioPanel.scss';

const log = createLogger('AgentAppStudioPanel');

interface AgentAppStudioPanelProps {
  sessionId: string | null;
  appId?: string;
}

type StudioTab = 'overview' | 'prompt' | 'tools' | 'examples';

const TAB_ORDER: StudioTab[] = ['overview', 'prompt', 'tools', 'examples'];

/** First grapheme of a name as the avatar glyph; falls back to a bot icon. */
function avatarGlyph(name?: string): string {
  if (!name) return '';
  const trimmed = name.trim();
  if (!trimmed) return '';
  return Array.from(trimmed)[0]?.toUpperCase() ?? '';
}

interface MetaRowProps {
  label: string;
  value?: string | null;
  valueNode?: React.ReactNode;
  mono?: boolean;
}

const MetaRow: React.FC<MetaRowProps> = ({ label, value, valueNode, mono }) => {
  if (!valueNode && !value) return null;
  return (
    <div className="agent-app-studio-panel__meta-row">
      <dt>{label}</dt>
      <dd className={mono ? 'is-mono' : ''} title={typeof value === 'string' ? value : undefined}>
        {valueNode ?? value}
      </dd>
    </div>
  );
};

interface SectionHeaderProps {
  title: string;
  meta?: string;
  actions?: React.ReactNode;
}

const SectionHeader: React.FC<SectionHeaderProps> = ({ title, meta, actions }) => (
  <div className="agent-app-studio-panel__section-header">
    <div className="agent-app-studio-panel__section-title">
      <h3>{title}</h3>
      {meta ? <span className="agent-app-studio-panel__section-meta">{meta}</span> : null}
    </div>
    {actions ? <div className="agent-app-studio-panel__section-actions">{actions}</div> : null}
  </div>
);

const AgentAppStudioPanel: React.FC<AgentAppStudioPanelProps> = ({ sessionId: _sessionId, appId }) => {
  const { workspacePath } = useLastUsedWorkspace();
  const { t } = useI18n('scenes/apps');
  const { openOverlay } = useOverlayManager();

  const [pkg, setPkg] = useState<AgentAppPackage | null>(null);
  const [activeId, setActiveId] = useState<string | undefined>(appId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<StudioTab>('overview');
  const [copied, setCopied] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [promptDraft, setPromptDraft] = useState<string | null>(null);
  const [promptDirty, setPromptDirty] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptModeToolbarHost, setPromptModeToolbarHost] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (appId && appId !== activeId) {
      setActiveId(appId);
    }
  }, [appId, activeId]);

  useEffect(() => {
    if (tab !== 'prompt') {
      setPromptModeToolbarHost(null);
    }
  }, [tab]);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const next = await agentAppAPI.getAgentApp(id, workspacePath || undefined, 'user');
      setPkg(next);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn('Failed to load Agent App', { id, message });
      setError(message);
      setPkg(null);
    } finally {
      setLoading(false);
    }
  }, [workspacePath]);

  useEffect(() => {
    if (!activeId) {
      setPkg(null);
      setError(null);
      return;
    }
    load(activeId);
  }, [activeId, reloadNonce, load]);

  // Reset prompt editor state whenever the loaded app or content changes.
  useEffect(() => {
    setPromptDraft(null);
    setPromptDirty(false);
  }, [activeId, reloadNonce]);


  // Listen for Agent App Studio tool events to auto-refresh.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ appId?: string } | undefined>).detail;
      const nextId = detail?.appId;
      if (nextId) {
        setActiveId(nextId);
        setReloadNonce((n) => n + 1);
      } else if (activeId) {
        setReloadNonce((n) => n + 1);
      }
    };
    window.addEventListener('agent-app-updated', handler as EventListener);
    return () => window.removeEventListener('agent-app-updated', handler as EventListener);
  }, [activeId]);

  const manifest = pkg?.manifest;
  const prompt = pkg?.prompt ?? '';
  const tools = manifest?.tools ?? [];
  const examples = manifest?.examples ?? [];
  const tags = manifest?.tags ?? [];

  const promptDisplayValue = promptDraft ?? prompt;
  const promptCharCount = promptDisplayValue.length;
  const promptReadonly = manifest?.readonly ?? false;

  const handleRefresh = useCallback(() => {
    if (!activeId) return;
    setReloadNonce((n) => n + 1);
  }, [activeId]);

  const handleCopy = useCallback(async (key: string, text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied((k) => (k === key ? null : k)), 1200);
    } catch (err) {
      notificationService.error(t('agentAppStudio.panel.copyFailed', { defaultValue: 'Copy failed' }));
      log.warn('Copy failed', { err });
    }
  }, [t]);

  const handleSavePrompt = useCallback(async (draftToSave?: string) => {
    if (!manifest) return;
    const content = draftToSave ?? promptDraft;
    if (content === null) return;
    setPromptSaving(true);
    try {
      await agentAppAPI.updateAgentApp(manifest, content, workspacePath || undefined);
      setPromptDraft(null);
      setPromptDirty(false);
      setReloadNonce((n) => n + 1);
      notificationService.success(t('agentAppStudio.panel.promptSaved', { defaultValue: 'Prompt saved' }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('Failed to save prompt', { id: manifest.id, message });
      notificationService.error(t('agentAppStudio.panel.promptSaveFailed', { defaultValue: 'Failed to save prompt' }));
    } finally {
      setPromptSaving(false);
    }
  }, [manifest, promptDraft, workspacePath, t]);

  const handleCancelPromptEdit = useCallback(() => {
    setPromptDraft(null);
    setPromptDirty(false);
    setReloadNonce((n) => n + 1);
  }, []);

  const handleOpenCatalog = useCallback(() => {
    openOverlay('apps');
  }, [openOverlay]);

  const tabs = useMemo(() => TAB_ORDER.map((id) => ({
    id,
    label: t(`agentAppStudio.panel.tabs.${id}`, {
      defaultValue: id.charAt(0).toUpperCase() + id.slice(1),
    }),
  })), [t]);

  // ── Empty state ────────────────────────────────────────────────────────────
  if (!activeId) {
    return (
      <div className="agent-app-studio-panel is-empty">
        <div className="agent-app-studio-panel__empty">
          <div className="agent-app-studio-panel__empty-art" aria-hidden>
            <AppWindow size={26} />
          </div>
          <div className="agent-app-studio-panel__empty-title">
            {t('agentAppStudio.panel.empty.title', { defaultValue: 'No Agent App yet' })}
          </div>
          <div className="agent-app-studio-panel__empty-desc">
            {t('agentAppStudio.panel.empty.description', {
              defaultValue: 'Tell the studio what you want to build. The latest Agent App package will appear here as soon as it is created.',
            })}
          </div>
        </div>
      </div>
    );
  }

  const glyph = avatarGlyph(manifest?.name ?? activeId);

  return (
    <div className="agent-app-studio-panel">
      {/* Hero ─────────────────────────────────────────────────────────────── */}
      <header className="agent-app-studio-panel__hero">
        <div className="agent-app-studio-panel__hero-row">
          <div className="agent-app-studio-panel__avatar" aria-hidden>
            {glyph ? <span className="agent-app-studio-panel__avatar-glyph">{glyph}</span> : <Bot size={20} />}
          </div>
          <div className="agent-app-studio-panel__hero-text">
            <div className="agent-app-studio-panel__hero-title-row">
              <h2 className="agent-app-studio-panel__name" title={manifest?.name ?? activeId}>
                {manifest?.name ?? activeId}
              </h2>
              {manifest?.readonly ? (
                <span className="agent-app-studio-panel__readonly-pill" title={t('agentAppStudio.panel.readonly', { defaultValue: 'Read-only' })}>
                  <Lock size={10} />
                  {t('agentAppStudio.panel.readonly', { defaultValue: 'Read-only' })}
                </span>
              ) : null}
            </div>
            {manifest?.id ? (
              <button
                type="button"
                className="agent-app-studio-panel__id"
                onClick={() => handleCopy('id', manifest.id)}
                title={t('agentAppStudio.panel.copyId', { defaultValue: 'Copy id' })}
              >
                <span className="agent-app-studio-panel__id-text">{manifest.id}</span>
                {copied === 'id' ? <Check size={11} /> : <Copy size={11} />}
              </button>
            ) : null}
            {manifest?.description ? (
              <p className="agent-app-studio-panel__desc">{manifest.description}</p>
            ) : null}
          </div>
          <div className="agent-app-studio-panel__hero-actions">
            <IconButton
              variant="ghost"
              size="xs"
              onClick={handleRefresh}
              tooltip={t('agentAppStudio.panel.refresh', { defaultValue: 'Refresh' })}
              aria-label={t('agentAppStudio.panel.refresh', { defaultValue: 'Refresh' })}
              disabled={loading}
            >
              <RefreshCw size={13} className={loading ? 'is-spinning' : ''} />
            </IconButton>
            <IconButton
              variant="ghost"
              size="xs"
              onClick={handleOpenCatalog}
              tooltip={t('agentAppStudio.panel.openCatalog', { defaultValue: 'Open Agent Apps catalog' })}
              aria-label={t('agentAppStudio.panel.openCatalog', { defaultValue: 'Open Agent Apps catalog' })}
            >
              <ExternalLink size={13} />
            </IconButton>
          </div>
        </div>

        <div className="agent-app-studio-panel__chip-row is-hero">
          {manifest?.model ? (
            <span className="agent-app-studio-panel__chip is-meta" title="model">
              <Sparkles size={10} />
              {manifest.model}
            </span>
          ) : null}
          {manifest?.category ? (
            <span className="agent-app-studio-panel__chip is-meta" title="category">{manifest.category}</span>
          ) : null}
          {tags.slice(0, 4).map((tag) => (
            <span className="agent-app-studio-panel__chip is-tag" key={tag}>
              <Tag size={10} />
              {tag}
            </span>
          ))}
          {tags.length > 4 ? (
            <span className="agent-app-studio-panel__chip is-tag-more">+{tags.length - 4}</span>
          ) : null}

          <div className="agent-app-studio-panel__chip-metrics" role="group" aria-label={t('agentAppStudio.panel.stats.groupLabel', { defaultValue: 'Quick counts' })}>
            <button
              type="button"
              className={`agent-app-studio-panel__metric${tools.length ? ' is-clickable' : ''}`}
              onClick={tools.length ? () => setTab('tools') : undefined}
              disabled={!tools.length}
              title={t('agentAppStudio.panel.stats.tools', { defaultValue: 'Tools' })}
            >
              <Wrench size={10} aria-hidden />
              <span className="agent-app-studio-panel__metric-value">{tools.length}</span>
              <span className="agent-app-studio-panel__metric-label">{t('agentAppStudio.panel.stats.toolsShort', { defaultValue: 'tools' })}</span>
            </button>
            <button
              type="button"
              className={`agent-app-studio-panel__metric${examples.length ? ' is-clickable' : ''}`}
              onClick={examples.length ? () => setTab('examples') : undefined}
              disabled={!examples.length}
              title={t('agentAppStudio.panel.stats.examples', { defaultValue: 'Examples' })}
            >
              <Sparkles size={10} aria-hidden />
              <span className="agent-app-studio-panel__metric-value">{examples.length}</span>
              <span className="agent-app-studio-panel__metric-label">{t('agentAppStudio.panel.stats.examplesShort', { defaultValue: 'ex.' })}</span>
            </button>
            <button
              type="button"
              className={`agent-app-studio-panel__metric${prompt.length ? ' is-clickable' : ''}`}
              onClick={prompt.length ? () => setTab('prompt') : undefined}
              disabled={!prompt.length}
              title={t('agentAppStudio.panel.stats.promptChars', { defaultValue: 'Prompt' })}
            >
              <Bot size={10} aria-hidden />
              <span className="agent-app-studio-panel__metric-value">
                {prompt.length ? `${(prompt.length / 1000).toFixed(prompt.length >= 10000 ? 0 : 1)}k` : '0'}
              </span>
              <span className="agent-app-studio-panel__metric-label">{t('agentAppStudio.panel.stats.charsSuffix', { defaultValue: 'chars' })}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Tabs + Prompt toolbar ─────────────────────────────────────────── */}
      <div className="agent-app-studio-panel__tabs">
        <div className="agent-app-studio-panel__tabs-leading" role="tablist" aria-label={t('agentAppStudio.panel.tablistLabel', { defaultValue: 'Preview sections' })}>
          {tabs.map((entry) => {
            const count = entry.id === 'tools'
              ? tools.length
              : entry.id === 'examples'
                ? examples.length
                : null;
            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={tab === entry.id}
                className={`agent-app-studio-panel__tab${tab === entry.id ? ' is-active' : ''}`}
                onClick={() => setTab(entry.id)}
              >
                <span className="agent-app-studio-panel__tab-label">{entry.label}</span>
                {count !== null && count > 0 ? (
                  <span className="agent-app-studio-panel__tab-count">{count}</span>
                ) : null}
              </button>
            );
          })}
        </div>
        {tab === 'prompt' && !error ? (
          <div
            className="agent-app-studio-panel__tabs-prompt-actions"
            role="toolbar"
            aria-label={t('agentAppStudio.panel.promptToolbarLabel', { defaultValue: 'Prompt actions' })}
          >
            <div
              className="agent-app-studio-panel__tabs-prompt-mode-host"
              ref={setPromptModeToolbarHost}
            />
            {promptDirty && !promptReadonly ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="small"
                  onClick={handleCancelPromptEdit}
                  disabled={promptSaving}
                >
                  {t('agentAppStudio.panel.cancelEdit', { defaultValue: 'Cancel' })}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="small"
                  isLoading={promptSaving}
                  onClick={() => void handleSavePrompt()}
                >
                  {t('agentAppStudio.panel.savePrompt', { defaultValue: 'Save' })}
                </Button>
              </>
            ) : null}
            <IconButton
              variant="ghost"
              size="xs"
              tooltip={copied === 'prompt'
                ? t('agentAppStudio.panel.copied', { defaultValue: 'Copied' })
                : t('agentAppStudio.panel.copyPrompt', { defaultValue: 'Copy prompt' })}
              aria-label={t('agentAppStudio.panel.copyPrompt', { defaultValue: 'Copy prompt' })}
              onClick={() => handleCopy('prompt', promptDisplayValue)}
              disabled={!promptDisplayValue}
            >
              {copied === 'prompt' ? <Check size={13} /> : <Copy size={13} />}
            </IconButton>
          </div>
        ) : null}
      </div>

      {/* Body ─────────────────────────────────────────────────────────────── */}
      <div className={`agent-app-studio-panel__body${tab === 'prompt' && !error ? ' is-prompt-tab' : ''}`}>
        {error ? (
          <div className="agent-app-studio-panel__error" role="alert">
            <AlertCircle size={14} />
            <span>{error}</span>
            <Button variant="secondary" size="small" onClick={handleRefresh}>
              {t('agentAppStudio.panel.retry', { defaultValue: 'Retry' })}
            </Button>
          </div>
        ) : null}

        {!error && manifest && tab === 'overview' ? (
          <div className="agent-app-studio-panel__section">
            <SectionHeader
              title={t('agentAppStudio.panel.sections.about', { defaultValue: 'About this app' })}
            />
            <div className="agent-app-studio-panel__meta-card">
              <MetaRow
                label={t('agentAppStudio.panel.fields.model', { defaultValue: 'Model' })}
                value={manifest.model}
              />
              <MetaRow
                label={t('agentAppStudio.panel.fields.category', { defaultValue: 'Category' })}
                value={manifest.category}
              />
              <MetaRow
                label={t('agentAppStudio.panel.fields.level', { defaultValue: 'Level' })}
                value={manifest.level}
              />
              <MetaRow
                label={t('agentAppStudio.panel.fields.readonly', { defaultValue: 'Read-only' })}
                value={manifest.readonly ? t('agentAppStudio.panel.yes', { defaultValue: 'Yes' }) : t('agentAppStudio.panel.no', { defaultValue: 'No' })}
              />
              {tags.length ? (
                <MetaRow
                  label={t('agentAppStudio.panel.fields.tags', { defaultValue: 'Tags' })}
                  valueNode={
                    <span className="agent-app-studio-panel__chip-row">
                      {tags.map((tag) => (
                        <span className="agent-app-studio-panel__chip is-tag" key={tag}>{tag}</span>
                      ))}
                    </span>
                  }
                />
              ) : null}
              {pkg?.path ? (
                <MetaRow
                  label={t('agentAppStudio.panel.fields.path', { defaultValue: 'Path' })}
                  value={pkg.path}
                  mono
                />
              ) : null}
            </div>
          </div>
        ) : null}

        {!error && tab === 'prompt' ? (
          <div className="agent-app-studio-panel__section is-prompt">
            <SectionHeader
              title={t('agentAppStudio.panel.sections.prompt', { defaultValue: 'System prompt' })}
              meta={promptCharCount
                ? t('agentAppStudio.panel.promptLength', { count: promptCharCount, defaultValue: '{{count}} chars' })
                : undefined}
            />
            <div className="agent-app-studio-panel__prompt-editor">
              <MarkdownEditor
                key={`${activeId ?? 'none'}-${reloadNonce}`}
                initialContent={prompt}
                readOnly={promptReadonly}
                modeToolbarHost={promptModeToolbarHost}
                onContentChange={(val, dirty) => {
                  setPromptDraft(val);
                  setPromptDirty(dirty);
                }}
                onSave={(val) => void handleSavePrompt(val)}
              />
            </div>
          </div>
        ) : null}

        {!error && tab === 'tools' ? (
          <div className="agent-app-studio-panel__section">
            <SectionHeader
              title={t('agentAppStudio.panel.sections.tools', { defaultValue: 'Tools' })}
              meta={tools.length
                ? t('agentAppStudio.panel.toolsCount', { count: tools.length, defaultValue: '{{count}} selected' })
                : undefined}
            />
            {tools.length ? (
              <ul className="agent-app-studio-panel__tools-grid" aria-label="tools">
                {tools.map((tool) => (
                  <li className="agent-app-studio-panel__tool-pill" key={tool}>
                    <span className="agent-app-studio-panel__tool-dot" aria-hidden />
                    <span className="agent-app-studio-panel__tool-name">{tool}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty description={t('agentAppStudio.panel.tools.empty', { defaultValue: 'No tools selected' })} />
            )}
          </div>
        ) : null}

        {!error && tab === 'examples' ? (
          <div className="agent-app-studio-panel__section is-examples">
            <SectionHeader
              title={t('agentAppStudio.panel.sections.examples', { defaultValue: 'Starter prompts' })}
              meta={examples.length
                ? t('agentAppStudio.panel.examplesCount', { count: examples.length, defaultValue: '{{count}} starter prompts' })
                : undefined}
            />
            {examples.length ? (
              <div className="agent-app-studio-panel__examples-list">
                {examples.map((example, index) => (
                  <article
                    className="agent-app-studio-panel__example"
                    key={`${example.title}-${index}`}
                  >
                    <header>
                      <span className="agent-app-studio-panel__example-bullet" aria-hidden>{index + 1}</span>
                      <h3 className="agent-app-studio-panel__example-title">{example.title}</h3>
                      <IconButton
                        variant="ghost"
                        size="xs"
                        tooltip={copied === `ex-${index}`
                          ? t('agentAppStudio.panel.copied', { defaultValue: 'Copied' })
                          : t('agentAppStudio.panel.copyExample', { defaultValue: 'Copy prompt' })}
                        aria-label={t('agentAppStudio.panel.copyExample', { defaultValue: 'Copy prompt' })}
                        onClick={() => handleCopy(`ex-${index}`, example.prompt)}
                      >
                        {copied === `ex-${index}` ? <Check size={13} /> : <Copy size={13} />}
                      </IconButton>
                    </header>
                    <pre className="agent-app-studio-panel__example-prompt">{example.prompt}</pre>
                  </article>
                ))}
              </div>
            ) : (
              <Empty description={t('agentAppStudio.panel.examples.empty', { defaultValue: 'No examples yet' })} />
            )}
          </div>
        ) : null}

        {!error && !manifest && loading ? (
          <div className="agent-app-studio-panel__loading">
            <RefreshCw size={14} className="is-spinning" />
            <span>{t('agentAppStudio.panel.loading', { defaultValue: 'Loading…' })}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default AgentAppStudioPanel;
