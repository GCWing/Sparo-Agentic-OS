/**
 * ComponentStudioPanel — right-side preview for Component Studio sessions.
 *
 * Shows the latest component package the studio has produced (or any package
 * passed via `componentId`), with a hero summary plus tabbed views for the prompt,
 * tools and examples. The panel listens to `component-updated` window events
 * emitted by the Component Studio tool cards so it auto-refreshes after
 * Create/Update.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AppWindow,
  Check,
  Copy,
  ExternalLink,
  Lock,
  Sparkles,
  Tag,
  Wrench,
} from 'lucide-react';
import { agentComponentAPI } from '@/infrastructure/api/service-api/AgentComponentAPI';
import type { AgentComponentPackage } from '@/infrastructure/api/service-api/AgentComponentAPI';
import { useI18n } from '@/infrastructure/i18n';
import { openWorkspaceScene } from '@/app/navigation/workspaceNavigation';
import { Badge, Button, DotMatrixLoader, EmptyState, IconButton, SegmentedControl, SparoAgentIcon } from '@/design-system';
import { MarkdownEditor } from '@/tools/markdown';
import { notificationService } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import {
  appScopeIdentity,
  normalizeAppScope,
  systemAppScope,
  type AppScope,
  workspacePathFromAppScope,
} from '@/shared/types/app-scope';
import { getAppCategoryLabel } from '../../appsUtils';
import './ComponentStudioPanel.scss';

const log = createLogger('ComponentStudioPanel');

interface ComponentStudioPanelProps {
  sessionId: string | null;
  componentId?: string;
  scope?: AppScope | null;
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
    <div className="component-studio-panel__meta-row">
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
  <div className="component-studio-panel__section-header">
    <div className="component-studio-panel__section-title">
      <h3>{title}</h3>
      {meta ? <span className="component-studio-panel__section-meta">{meta}</span> : null}
    </div>
    {actions ? <div className="component-studio-panel__section-actions">{actions}</div> : null}
  </div>
);

const ComponentStudioPanel: React.FC<ComponentStudioPanelProps> = ({ sessionId: _sessionId, componentId, scope }) => {
  const effectiveScope = useMemo(() => normalizeAppScope(scope || systemAppScope()), [scope]);
  const scopeIdentity = appScopeIdentity(effectiveScope);
  const workspacePath = workspacePathFromAppScope(effectiveScope);
  const { t } = useI18n('scenes/apps');

  const [pkg, setPkg] = useState<AgentComponentPackage | null>(null);
  const [activeId, setActiveId] = useState<string | undefined>(componentId);
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
    if (componentId && componentId !== activeId) {
      setActiveId(componentId);
    }
  }, [componentId, activeId]);

  useEffect(() => {
    if (tab !== 'prompt') {
      setPromptModeToolbarHost(null);
    }
  }, [tab]);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const next = await agentComponentAPI.getAgentComponent(id, workspacePath, 'user');
      setPkg(next);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn('Failed to load Agent Component', { id, message });
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


  // Listen for Component Studio tool events to auto-refresh.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ componentId?: string; scope?: AppScope } | undefined>).detail;
      if (detail?.scope && appScopeIdentity(detail.scope) !== scopeIdentity) {
        return;
      }
      const nextId = detail?.componentId;
      if (nextId) {
        setActiveId(nextId);
        setReloadNonce((n) => n + 1);
      } else if (activeId) {
        setReloadNonce((n) => n + 1);
      }
    };
    window.addEventListener('component-updated', handler as EventListener);
    return () => window.removeEventListener('component-updated', handler as EventListener);
  }, [activeId, scopeIdentity]);

  const manifest = pkg?.manifest;
  const prompt = pkg?.prompt ?? '';
  const tools = manifest?.tools ?? [];
  const examples = manifest?.examples ?? [];
  const tags = manifest?.tags ?? [];

  const promptDisplayValue = promptDraft ?? prompt;
  const promptCharCount = promptDisplayValue.length;
  const promptReadonly = manifest?.readonly ?? false;
  const categoryLabel = getAppCategoryLabel(manifest?.category, t);

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
      notificationService.error(t('componentStudio.panel.copyFailed', { defaultValue: 'Copy failed' }));
      log.warn('Copy failed', { err });
    }
  }, [t]);

  const handleSavePrompt = useCallback(async (draftToSave?: string) => {
    if (!manifest) return;
    const content = draftToSave ?? promptDraft;
    if (content === null) return;
    setPromptSaving(true);
    try {
      await agentComponentAPI.updateAgentComponent(manifest, content, workspacePath);
      setPromptDraft(null);
      setPromptDirty(false);
      setReloadNonce((n) => n + 1);
      notificationService.success(t('componentStudio.panel.promptSaved', { defaultValue: 'Prompt saved' }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('Failed to save prompt', { id: manifest.id, message });
      notificationService.error(t('componentStudio.panel.promptSaveFailed', { defaultValue: 'Failed to save prompt' }));
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
    openWorkspaceScene('apps');
  }, []);

  const tabs = useMemo(() => TAB_ORDER.map((id) => ({
    id,
    label: t(`componentStudio.panel.tabs.${id}`, {
      defaultValue: id.charAt(0).toUpperCase() + id.slice(1),
    }),
  })), [t]);

  // ── Empty state ────────────────────────────────────────────────────────────
  if (!activeId) {
    return (
      <div className="component-studio-panel is-empty">
        <div className="component-studio-panel__empty">
          <div className="component-studio-panel__empty-art" aria-hidden>
            <AppWindow size={26} />
          </div>
          <div className="component-studio-panel__empty-title">
            {t('componentStudio.panel.empty.title', { defaultValue: 'No Agent Component yet' })}
          </div>
          <div className="component-studio-panel__empty-desc">
            {t('componentStudio.panel.empty.description', {
              defaultValue: 'Tell the studio what you want to build. The latest component package will appear here as soon as it is created.',
            })}
          </div>
        </div>
      </div>
    );
  }

  const glyph = avatarGlyph(manifest?.name ?? activeId);

  return (
    <div className="component-studio-panel">
      {/* Hero ─────────────────────────────────────────────────────────────── */}
      <header className="component-studio-panel__hero">
        <div className="component-studio-panel__hero-row">
          <div className="component-studio-panel__avatar" aria-hidden>
            {glyph ? <span className="component-studio-panel__avatar-glyph">{glyph}</span> : <SparoAgentIcon size={20} />}
          </div>
          <div className="component-studio-panel__hero-text">
            <div className="component-studio-panel__hero-title-row">
              <h2 className="component-studio-panel__name" title={manifest?.name ?? activeId}>
                {manifest?.name ?? activeId}
              </h2>
              {manifest?.readonly ? (
                <span className="component-studio-panel__readonly-pill" title={t('componentStudio.panel.readonly', { defaultValue: 'Read-only' })}>
                  <Lock size={10} />
                  {t('componentStudio.panel.readonly', { defaultValue: 'Read-only' })}
                </span>
              ) : null}
            </div>
            {manifest?.id ? (
              <Button
                type="button"
                variant="ghost"
                size="small"
                className="component-studio-panel__id"
                onClick={() => handleCopy('id', manifest.id)}
                title={t('componentStudio.panel.copyId', { defaultValue: 'Copy id' })}
              >
                <span className="component-studio-panel__id-text">{manifest.id}</span>
                {copied === 'id' ? <Check size={11} /> : <Copy size={11} />}
              </Button>
            ) : null}
            {manifest?.description ? (
              <p className="component-studio-panel__desc">{manifest.description}</p>
            ) : null}
          </div>
          <div className="component-studio-panel__hero-actions">
            <IconButton
              variant="ghost"
              size="xs"
              onClick={handleOpenCatalog}
              tooltip={t('componentStudio.panel.openCatalog', { defaultValue: 'Open Component Center' })}
              aria-label={t('componentStudio.panel.openCatalog', { defaultValue: 'Open Component Center' })}
            >
              <ExternalLink size={13} />
            </IconButton>
          </div>
        </div>

        <div className="component-studio-panel__chip-row is-hero">
          {manifest?.model ? (
            <span
              className="component-studio-panel__chip is-meta"
              title={t('componentStudio.panel.fields.model', { defaultValue: 'Model' })}
            >
              <Sparkles size={10} />
              {manifest.model}
            </span>
          ) : null}
          {manifest?.category ? (
            <span
              className="component-studio-panel__chip is-meta"
              title={t('componentStudio.panel.fields.category', { defaultValue: 'Category' })}
            >
              {categoryLabel}
            </span>
          ) : null}
          {tags.slice(0, 4).map((tag) => (
            <span className="component-studio-panel__chip is-tag" key={tag}>
              <Tag size={10} />
              {tag}
            </span>
          ))}
          {tags.length > 4 ? (
            <span className="component-studio-panel__chip is-tag-more">+{tags.length - 4}</span>
          ) : null}

          <div className="component-studio-panel__chip-metrics" role="group" aria-label={t('componentStudio.panel.stats.groupLabel', { defaultValue: 'Quick counts' })}>
            <Button
              type="button"
              variant="ghost"
              size="small"
              className={`component-studio-panel__metric${tools.length ? ' is-clickable' : ''}`}
              onClick={tools.length ? () => setTab('tools') : undefined}
              disabled={!tools.length}
              title={t('componentStudio.panel.stats.tools', { defaultValue: 'Tools' })}
            >
              <Wrench size={10} aria-hidden />
              <span className="component-studio-panel__metric-value">{tools.length}</span>
              <span className="component-studio-panel__metric-label">{t('componentStudio.panel.stats.toolsShort', { defaultValue: 'tools' })}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="small"
              className={`component-studio-panel__metric${examples.length ? ' is-clickable' : ''}`}
              onClick={examples.length ? () => setTab('examples') : undefined}
              disabled={!examples.length}
              title={t('componentStudio.panel.stats.examples', { defaultValue: 'Examples' })}
            >
              <Sparkles size={10} aria-hidden />
              <span className="component-studio-panel__metric-value">{examples.length}</span>
              <span className="component-studio-panel__metric-label">{t('componentStudio.panel.stats.examplesShort', { defaultValue: 'ex.' })}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="small"
              className={`component-studio-panel__metric${prompt.length ? ' is-clickable' : ''}`}
              onClick={prompt.length ? () => setTab('prompt') : undefined}
              disabled={!prompt.length}
              title={t('componentStudio.panel.stats.promptChars', { defaultValue: 'Prompt' })}
            >
              <SparoAgentIcon size={10} aria-hidden />
              <span className="component-studio-panel__metric-value">
                {prompt.length ? `${(prompt.length / 1000).toFixed(prompt.length >= 10000 ? 0 : 1)}k` : '0'}
              </span>
              <span className="component-studio-panel__metric-label">{t('componentStudio.panel.stats.charsSuffix', { defaultValue: 'chars' })}</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Tabs + Prompt toolbar ─────────────────────────────────────────── */}
      <div className="component-studio-panel__tabs">
        <div className="component-studio-panel__tabs-leading">
          <SegmentedControl
            className="component-studio-panel__tab-control"
            size="small"
            value={tab}
            onChange={(nextTab) => setTab(nextTab as StudioTab)}
            ariaLabel={t('componentStudio.panel.tablistLabel', { defaultValue: 'Preview sections' })}
            options={tabs.map((entry) => {
              const count = entry.id === 'tools'
                ? tools.length
                : entry.id === 'examples'
                  ? examples.length
                  : null;
              return {
                value: entry.id,
                label: (
                  <>
                    <span className="component-studio-panel__tab-label">{entry.label}</span>
                    {count !== null && count > 0 ? (
                      <Badge className="component-studio-panel__tab-count" variant="neutral">{count}</Badge>
                    ) : null}
                  </>
                ),
              };
            })}
          />
        </div>
        {tab === 'prompt' && !error ? (
          <div
            className="component-studio-panel__tabs-prompt-actions"
            role="toolbar"
            aria-label={t('componentStudio.panel.promptToolbarLabel', { defaultValue: 'Prompt actions' })}
          >
            <div
              className="component-studio-panel__tabs-prompt-mode-host"
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
                  {t('componentStudio.panel.cancelEdit', { defaultValue: 'Cancel' })}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="small"
                  isLoading={promptSaving}
                  onClick={() => void handleSavePrompt()}
                >
                  {t('componentStudio.panel.savePrompt', { defaultValue: 'Save' })}
                </Button>
              </>
            ) : null}
            <IconButton
              variant="ghost"
              size="xs"
              tooltip={copied === 'prompt'
                ? t('componentStudio.panel.copied', { defaultValue: 'Copied' })
                : t('componentStudio.panel.copyPrompt', { defaultValue: 'Copy prompt' })}
              aria-label={t('componentStudio.panel.copyPrompt', { defaultValue: 'Copy prompt' })}
              onClick={() => handleCopy('prompt', promptDisplayValue)}
              disabled={!promptDisplayValue}
            >
              {copied === 'prompt' ? <Check size={13} /> : <Copy size={13} />}
            </IconButton>
          </div>
        ) : null}
      </div>

      {/* Body ─────────────────────────────────────────────────────────────── */}
      <div className={`component-studio-panel__body${tab === 'prompt' && !error ? ' is-prompt-tab' : ''}`}>
        {error ? (
          <div className="component-studio-panel__error" role="alert">
            <AlertCircle size={14} />
            <span>{error}</span>
            <Button variant="secondary" size="small" onClick={handleRefresh}>
              {t('componentStudio.panel.retry', { defaultValue: 'Retry' })}
            </Button>
          </div>
        ) : null}

        {!error && manifest && tab === 'overview' ? (
          <div className="component-studio-panel__section">
            <SectionHeader
              title={t('componentStudio.panel.sections.about', { defaultValue: 'About this app' })}
            />
            <div className="component-studio-panel__meta-card">
              <MetaRow
                label={t('componentStudio.panel.fields.model', { defaultValue: 'Model' })}
                value={manifest.model}
              />
              <MetaRow
                label={t('componentStudio.panel.fields.category', { defaultValue: 'Category' })}
                value={categoryLabel}
              />
              <MetaRow
                label={t('componentStudio.panel.fields.level', { defaultValue: 'Level' })}
                value={manifest.level}
              />
              <MetaRow
                label={t('componentStudio.panel.fields.readonly', { defaultValue: 'Read-only' })}
                value={manifest.readonly ? t('componentStudio.panel.yes', { defaultValue: 'Yes' }) : t('componentStudio.panel.no', { defaultValue: 'No' })}
              />
              {tags.length ? (
                <MetaRow
                  label={t('componentStudio.panel.fields.tags', { defaultValue: 'Tags' })}
                  valueNode={
                    <span className="component-studio-panel__chip-row">
                      {tags.map((tag) => (
                        <span className="component-studio-panel__chip is-tag" key={tag}>{tag}</span>
                      ))}
                    </span>
                  }
                />
              ) : null}
              {pkg?.path ? (
                <MetaRow
                  label={t('componentStudio.panel.fields.path', { defaultValue: 'Path' })}
                  value={pkg.path}
                  mono
                />
              ) : null}
            </div>
          </div>
        ) : null}

        {!error && tab === 'prompt' ? (
          <div className="component-studio-panel__section is-prompt">
            <SectionHeader
              title={t('componentStudio.panel.sections.prompt', { defaultValue: 'System prompt' })}
              meta={promptCharCount
                ? t('componentStudio.panel.promptLength', { count: promptCharCount, defaultValue: '{{count}} chars' })
                : undefined}
            />
            <div className="component-studio-panel__prompt-editor">
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
          <div className="component-studio-panel__section">
            <SectionHeader
              title={t('componentStudio.panel.sections.tools', { defaultValue: 'Tools' })}
              meta={tools.length
                ? t('componentStudio.panel.toolsCount', { count: tools.length, defaultValue: '{{count}} selected' })
                : undefined}
            />
            {tools.length ? (
              <ul
                className="component-studio-panel__tools-grid"
                aria-label={t('componentStudio.panel.sections.tools', { defaultValue: 'Tools' })}
              >
                {tools.map((tool) => (
                  <li className="component-studio-panel__tool-pill" key={tool}>
                    <span className="component-studio-panel__tool-dot" aria-hidden />
                    <span className="component-studio-panel__tool-name">{tool}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState description={t('componentStudio.panel.tools.empty', { defaultValue: 'No tools selected' })} />
            )}
          </div>
        ) : null}

        {!error && tab === 'examples' ? (
          <div className="component-studio-panel__section is-examples">
            <SectionHeader
              title={t('componentStudio.panel.sections.examples', { defaultValue: 'Starter prompts' })}
              meta={examples.length
                ? t('componentStudio.panel.examplesCount', { count: examples.length, defaultValue: '{{count}} starter prompts' })
                : undefined}
            />
            {examples.length ? (
              <div className="component-studio-panel__examples-list">
                {examples.map((example, index) => (
                  <article
                    className="component-studio-panel__example"
                    key={`${example.title}-${index}`}
                  >
                    <header>
                      <span className="component-studio-panel__example-bullet" aria-hidden>{index + 1}</span>
                      <h3 className="component-studio-panel__example-title">{example.title}</h3>
                      <IconButton
                        variant="ghost"
                        size="xs"
                        tooltip={copied === `ex-${index}`
                          ? t('componentStudio.panel.copied', { defaultValue: 'Copied' })
                          : t('componentStudio.panel.copyExample', { defaultValue: 'Copy prompt' })}
                        aria-label={t('componentStudio.panel.copyExample', { defaultValue: 'Copy prompt' })}
                        onClick={() => handleCopy(`ex-${index}`, example.prompt)}
                      >
                        {copied === `ex-${index}` ? <Check size={13} /> : <Copy size={13} />}
                      </IconButton>
                    </header>
                    <pre className="component-studio-panel__example-prompt">{example.prompt}</pre>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState description={t('componentStudio.panel.examples.empty', { defaultValue: 'No examples yet' })} />
            )}
          </div>
        ) : null}

        {!error && !manifest && loading ? (
          <div className="component-studio-panel__loading">
            <DotMatrixLoader size="tiny" />
            <span>{t('componentStudio.panel.loading', { defaultValue: 'Loading…' })}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default ComponentStudioPanel;
