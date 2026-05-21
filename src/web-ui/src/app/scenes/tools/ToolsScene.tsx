import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  FileJson,
  Server,
  AlertTriangle,
  Play,
  Square,
  RotateCw,
  Trash2,
  Plug,
  Wrench,
  Settings2,
} from 'lucide-react';
import {
  ActionListRow,
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogFooter,
  EmptyState,
  IconButton,
  Panel,
  PanelBody,
  Search,
  SegmentedControl,
  SelectableRow,
  StatusDot,
  StatusPill,
  Textarea,
  Toolbar,
  ToolbarGroup,
  type StatusTone,
} from '@/design-system';
import {
  SceneCompactNav,
  SceneCompactNavCategory,
  SceneCompactNavItem,
} from '@/app/scenes/shared/SceneCompactNav';
import { useNotification } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import MCPAPI, { type MCPServerInfo } from '@/infrastructure/api/service-api/MCPAPI';
import { toolAPI } from '@/infrastructure/api/service-api/ToolAPI';
import {
  BUILTIN_TOOLS,
  CATEGORY_ORDER,
  countByCategory,
  type BuiltinToolMeta,
  type ToolCategory,
  type ToolPermission,
} from './data/builtinTools';
import './ToolsScene.scss';

const log = createLogger('ToolsScene');

type DetailLang = 'zh' | 'en';

const MCP_TOOL_PREFIX = 'mcp__';
const MCP_LOCAL_PROCESS_EXAMPLE = `{
  "mcpServers": {
    "zai-mcp-server": {
      "command": "npx",
      "args": ["-y", "@z_ai/mcp-server"],
      "env": { "Z_AI_API_KEY": "your_api_key" }
    }
  }
}`;
const MCP_REMOTE_SERVICE_EXAMPLE = `{
  "mcpServers": {
    "remote-mcp": {
      "url": "http://localhost:3000/sse"
    }
  }
}`;

interface RegisteredTool {
  name: string;
  description?: string;
}

interface McpToolEntry extends RegisteredTool {
  serverId: string;
  shortName: string;
}

type UnifiedTool =
  | { kind: 'builtin'; meta: BuiltinToolMeta }
  | { kind: 'mcp'; mcp: McpToolEntry };

/** Sidebar selection model. */
type Selection =
  | { kind: 'all' }
  | { kind: 'builtin-category'; category: ToolCategory }
  | { kind: 'mcp-all' }
  | { kind: 'mcp-server'; serverId: string };

const SEL_ALL: Selection = { kind: 'all' };

function isSameTool(a: UnifiedTool, b: UnifiedTool | null): boolean {
  if (!b || a.kind !== b.kind) return false;
  if (a.kind === 'builtin' && b.kind === 'builtin') return a.meta.name === b.meta.name;
  if (a.kind === 'mcp' && b.kind === 'mcp') return a.mcp.name === b.mcp.name;
  return false;
}

// Row + badges

const PermissionBadge: React.FC<{ level: ToolPermission }> = ({ level }) => {
  const { t } = useTranslation('scenes/tools');
  return (
    <Badge variant="neutral" className={`tools-permission-badge tools-permission-badge--${level}`}>
      {t(`permissions.${level}`)}
    </Badge>
  );
};

// MCP status dot (used in both sidebar tree and manager modal)

const getMcpStatusTone = (status: string): StatusTone => {
  if (/Connected|Healthy/.test(status)) return 'success';
  if (/Starting|Reconnecting|Stopping|NeedsAuth/.test(status)) return 'warning';
  if (/Fail|Error/.test(status)) return 'error';
  return 'neutral';
};

const McpStatusDot: React.FC<{ status: string }> = ({ status }) => (
  <StatusDot tone={getMcpStatusTone(status)} size="small" label={status} />
);

const LangToggle: React.FC<{
  lang: DetailLang;
  onChange: (l: DetailLang) => void;
}> = ({ lang, onChange }) => {
  const { t } = useTranslation('scenes/tools');
  return (
    <SegmentedControl
      ariaLabel={t('detail.languageToggle')}
      size="small"
      value={lang}
      onChange={(nextLang) => onChange(nextLang as DetailLang)}
      options={[
        { value: 'en', label: t('detail.langToggleEn') },
        { value: 'zh', label: t('detail.langToggleZh') },
      ]}
    />
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="tools-detail__section">
    <h3 className="tools-detail__section-title">{title}</h3>
    <div className="tools-detail__section-body">{children}</div>
  </section>
);

// Category tree

const CategoryTree: React.FC<{
  selection: Selection;
  onSelect: (s: Selection) => void;
  counts: Record<ToolCategory, number>;
  totalBuiltin: number;
  totalMcp: number;
  servers: MCPServerInfo[];
  mcpToolsByServer: Map<string, McpToolEntry[]>;
}> = ({ selection, onSelect, counts, totalBuiltin, totalMcp, servers, mcpToolsByServer }) => {
  const { t } = useTranslation('scenes/tools');

  const isActive = (pred: (s: Selection) => boolean): boolean => pred(selection);

  return (
    <SceneCompactNav title={t('page.title')}>
      <SceneCompactNavCategory>
        <SceneCompactNavItem
          label={t('categories.all')}
          meta={totalBuiltin + totalMcp}
          active={isActive((s) => s.kind === 'all')}
          onClick={() => onSelect({ kind: 'all' })}
        />
      </SceneCompactNavCategory>

      <SceneCompactNavCategory label={t('sidebar.builtin')}>
        {CATEGORY_ORDER.map((c) => (
          <SceneCompactNavItem
            key={c}
            label={t(`categories.${c}`)}
            meta={counts[c]}
            active={isActive((s) => s.kind === 'builtin-category' && s.category === c)}
            onClick={() => onSelect({ kind: 'builtin-category', category: c })}
          />
        ))}
      </SceneCompactNavCategory>

      <SceneCompactNavCategory label={t('sidebar.mcp')}>
        <SceneCompactNavItem
          label={t('sidebar.mcp')}
          meta={totalMcp}
          active={isActive((s) => s.kind === 'mcp-all')}
          onClick={() => onSelect({ kind: 'mcp-all' })}
        />
        {servers.length === 0 ? (
          <p className="tools-tree__empty">{t('sidebar.noServers')}</p>
        ) : (
          servers.map((s) => {
            const n = mcpToolsByServer.get(s.id)?.length ?? 0;
            return (
              <SceneCompactNavItem
                key={s.id}
                label={(
                  <span className="tools-tree__server-label">
                    <McpStatusDot status={s.status} />
                    <span>{s.name || s.id}</span>
                  </span>
                )}
                meta={n}
                nested
                active={isActive((sel) => sel.kind === 'mcp-server' && sel.serverId === s.id)}
                onClick={() => onSelect({ kind: 'mcp-server', serverId: s.id })}
              />
            );
          })
        )}
      </SceneCompactNavCategory>
    </SceneCompactNav>
  );
};

const ToolRow: React.FC<{
  tool: UnifiedTool;
  active: boolean;
  onClick: () => void;
}> = ({ tool, active, onClick }) => {
  const { t } = useTranslation('scenes/tools');

  if (tool.kind === 'builtin') {
    const Icon = tool.meta.Icon;
    return (
      <SelectableRow
        selected={active}
        onClick={onClick}
        leading={<Icon size={15} strokeWidth={1.6} />}
        title={tool.meta.name}
        description={t(`builtin.${tool.meta.name}.summary`)}
        meta={<PermissionBadge level={tool.meta.permission} />}
      />
    );
  }

  const mcp = tool.mcp;
  return (
    <SelectableRow
      selected={active}
      onClick={onClick}
      leading={<Plug size={14} strokeWidth={1.6} />}
      title={mcp.shortName}
      description={mcp.description || mcp.serverId}
      meta={<Badge variant="neutral">{mcp.serverId}</Badge>}
    />
  );
};

// Detail views

const BuiltinToolDetail: React.FC<{ tool: BuiltinToolMeta }> = ({ tool }) => {
  const { i18n, t } = useTranslation('scenes/tools');
  const defaultLang: DetailLang = i18n.language?.startsWith('zh') ? 'zh' : 'en';
  const [lang, setLang] = useState<DetailLang>(defaultLang);

  useEffect(() => {
    setLang(i18n.language?.startsWith('zh') ? 'zh' : 'en');
  }, [tool.name, i18n.language]);

  const Icon = tool.Icon;

  const localized = useCallback(
    (key: string, options?: Record<string, unknown>): string =>
      t(key, { ...(options ?? {}), lng: lang === 'zh' ? 'zh-CN' : 'en-US' }) as string,
    [t, lang],
  );

  const getList = useCallback((key: string): string[] => {
    const raw = i18n.getResource(lang === 'zh' ? 'zh-CN' : 'en-US', 'scenes/tools', key);
    return Array.isArray(raw) ? (raw as string[]) : [];
  }, [i18n, lang]);

  const getRelated = useCallback((): Array<{ name: string; note: string }> => {
    const raw = i18n.getResource(
      lang === 'zh' ? 'zh-CN' : 'en-US', 'scenes/tools',
      `builtin.${tool.name}.related`,
    );
    return Array.isArray(raw) ? (raw as Array<{ name: string; note: string }>) : [];
  }, [i18n, lang, tool.name]);

  const whenList = getList(`builtin.${tool.name}.when`);
  const whenNotList = getList(`builtin.${tool.name}.whenNot`);
  const relatedList = getRelated();
  const notes = localized(`builtin.${tool.name}.notes`);
  const hasNotes = notes && !notes.endsWith(`.notes`);

  return (
    <div className="tools-detail">
      <header className="tools-detail__head">
        <span className="tools-detail__icon"><Icon size={20} strokeWidth={1.5} /></span>
        <div className="tools-detail__identity">
          <div className="tools-detail__title-row">
            <h2 className="tools-detail__title">{tool.name}</h2>
            <Badge variant="neutral">{t('detail.sourceBuiltin')}</Badge>
            <PermissionBadge level={tool.permission} />
          </div>
          <p className="tools-detail__summary">{localized(`builtin.${tool.name}.summary`)}</p>
        </div>
        <LangToggle lang={lang} onChange={setLang} />
      </header>

      <div className="tools-detail__body">
        <Section title={t('detail.sections.what')}>
          <p>{localized(`builtin.${tool.name}.what`)}</p>
        </Section>

        {whenList.length > 0 && (
          <Section title={t('detail.sections.when')}>
            <ul className="tools-detail__bullets">
              {whenList.map((item, i) => <li key={i}>{item}</li>)}
            </ul>
          </Section>
        )}

        {whenNotList.length > 0 && (
          <Section title={t('detail.sections.whenNot')}>
            <ul className="tools-detail__bullets tools-detail__bullets--warn">
              {whenNotList.map((item, i) => <li key={i}>{item}</li>)}
            </ul>
          </Section>
        )}

        <Section title={t('detail.sections.related')}>
          {relatedList.length === 0 ? (
            <p className="tools-detail__muted">{t('detail.relatedNone')}</p>
          ) : (
            <ul className="tools-detail__related">
              {relatedList.map(r => (
                <li key={r.name}><code>{r.name}</code><span> - {r.note}</span></li>
              ))}
            </ul>
          )}
        </Section>

        {hasNotes && (
          <Section title={t('detail.sections.notes')}>
            <p className="tools-detail__notes">
              <AlertTriangle size={13} strokeWidth={1.6} />
              <span>{notes}</span>
            </p>
          </Section>
        )}
      </div>
    </div>
  );
};

const McpToolDetail: React.FC<{
  tool: McpToolEntry;
  server: MCPServerInfo | null;
}> = ({ tool, server }) => {
  const { t } = useTranslation('scenes/tools');

  return (
    <div className="tools-detail">
      <header className="tools-detail__head">
        <span className="tools-detail__icon"><Plug size={20} strokeWidth={1.5} /></span>
        <div className="tools-detail__identity">
          <div className="tools-detail__title-row">
            <h2 className="tools-detail__title">{tool.shortName}</h2>
            <Badge variant="neutral">{t('detail.sourceMcp', { server: tool.serverId })}</Badge>
            {server && (
              <StatusPill tone={getMcpStatusTone(server.status)} size="small">
                {server.status}
              </StatusPill>
            )}
          </div>
          <p className="tools-detail__summary">
            <code>{tool.name}</code>
          </p>
        </div>
      </header>

      <div className="tools-detail__body">
        <Section title={t('detail.sections.what')}>
          {tool.description
            ? <p>{tool.description}</p>
            : <p className="tools-detail__muted">{t('detail.outputsNone')}</p>}
        </Section>

        {server && (
          <Section title={t('mcp.server.configSection')}>
            <dl className="tools-mcp__kv">
              <dt>{t('mcp.server.transport')}</dt>
              <dd>{server.transport}</dd>
              {server.url && (<><dt>{t('mcp.server.url')}</dt><dd><code>{server.url}</code></dd></>)}
              {server.command && (<><dt>{t('mcp.server.command')}</dt><dd><code>{server.command}</code></dd></>)}
            </dl>
          </Section>
        )}
      </div>
    </div>
  );
};

// JSON config editor

const McpConfigEditor: React.FC<{
  open: boolean;
  initialValue: string;
  onCancel: () => void;
  onSave: (raw: string) => Promise<void> | void;
}> = ({ open, initialValue, onCancel, onSave }) => {
  const { t } = useTranslation('scenes/tools');
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (open) setValue(initialValue); }, [open, initialValue]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onCancel();
        }
      }}
      title={t('mcp.editor.title')}
      size="large"
      initialFocusRef={textareaRef}
    >
      <DialogBody className="tools-mcp__editor">
        <p className="tools-mcp__editor-hint">{t('mcp.editor.hint')}</p>
        <div className="tools-mcp__editor-examples">
          <div className="tools-mcp__editor-example">
            <h4>{t('mcp.editor.examples.localProcess')}</h4>
            <pre>{MCP_LOCAL_PROCESS_EXAMPLE}</pre>
          </div>
          <div className="tools-mcp__editor-example">
            <h4>{t('mcp.editor.examples.remoteService')}</h4>
            <pre>{MCP_REMOTE_SERVICE_EXAMPLE}</pre>
          </div>
        </div>
        <Textarea
          ref={textareaRef}
          className="tools-mcp__editor-area"
          spellCheck={false}
          value={value}
          onChange={e => setValue(e.target.value)}
          rows={20}
          variant="filled"
        />
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" size="small" onClick={onCancel} disabled={busy}>
          {t('mcp.editor.cancel')}
        </Button>
        <Button
          variant="primary"
          size="small"
          disabled={busy}
          isLoading={busy}
          onClick={async () => {
            setBusy(true);
            try { await onSave(value); } finally { setBusy(false); }
          }}
        >
          {t('mcp.editor.save')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
};

// MCP manager modal: add / start / stop / restart / delete / edit JSON.

const McpManagerModal: React.FC<{
  open: boolean;
  onClose: () => void;
  servers: MCPServerInfo[];
  onRefresh: () => Promise<void>;
}> = ({ open, onClose, servers, onRefresh }) => {
  const { t } = useTranslation('scenes/tools');
  const notification = useNotification();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorInitial, setEditorInitial] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<MCPServerInfo | null>(null);

  const errorCount = useMemo(
    () => servers.filter(s => /Fail|Error|NeedsAuth/i.test(s.status)).length,
    [servers],
  );

  const handleOpenEditor = useCallback(async () => {
    try {
      const config = await MCPAPI.loadMCPJsonConfig();
      setEditorInitial(config ?? '');
      setEditorOpen(true);
    } catch (error) {
      notification.error(t('mcp.editor.loadFailed', { error: String(error) }));
    }
  }, [notification, t]);

  const handleSaveEditor = useCallback(async (raw: string) => {
    try {
      await MCPAPI.saveMCPJsonConfig(raw);
      notification.success(t('mcp.editor.saveSuccess'));
      setEditorOpen(false);
      await onRefresh();
    } catch (error) {
      notification.error(t('mcp.editor.saveFailed', { error: String(error) }));
    }
  }, [onRefresh, notification, t]);

  const handleAction = useCallback(async (action: 'start' | 'stop' | 'restart', serverId: string) => {
    try {
      if (action === 'start') await MCPAPI.startServer(serverId);
      else if (action === 'stop') await MCPAPI.stopServer(serverId);
      else await MCPAPI.restartServer(serverId);
      await onRefresh();
    } catch (error) {
      log.error('MCP action failed', { action, serverId, error });
      notification.error(String(error));
    }
  }, [onRefresh, notification]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await MCPAPI.deleteServer({ serverId: deleteTarget.id });
      setDeleteTarget(null);
      await onRefresh();
    } catch (error) {
      notification.error(String(error));
    }
  }, [deleteTarget, onRefresh, notification]);

  return (
    <>
      <Dialog
        open={open && !editorOpen && !deleteTarget}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            onClose();
          }
        }}
        title={t('sidebar.manageServers')}
        size="large"
        contentInset
        contentClassName="ds-dialog__body--fill-flex"
      >
        <div className="tools-mcp__manager">
          <Toolbar className="tools-mcp__manager-stats" density="compact">
            <ToolbarGroup>
              <span>{t('mcp.header.serversTotal', { count: servers.length })}</span>
              {errorCount > 0 && (
                <StatusPill tone="error" size="small">
                  {t('mcp.header.errors', { count: errorCount })}
                </StatusPill>
              )}
            </ToolbarGroup>
            <ToolbarGroup align="end">
              <Button variant="primary" size="small" onClick={() => void handleOpenEditor()}>
                <FileJson size={13} />
                <span>{t('mcp.actions.editConfig')}</span>
              </Button>
            </ToolbarGroup>
          </Toolbar>

          {servers.length === 0 ? (
            <div className="tools-mcp__empty">
              <Server size={36} strokeWidth={1.3} />
              <h3>{t('mcp.empty.title')}</h3>
              <p>{t('mcp.empty.hint')}</p>
              <Button variant="primary" onClick={() => void handleOpenEditor()}>
                <Plus size={14} />
                <span>{t('mcp.empty.cta')}</span>
              </Button>
            </div>
          ) : (
            <ul className="tools-mcp__manager-list">
              {servers.map(s => {
                const isRunning = /Connected|Healthy|Starting|Reconnecting/.test(s.status);
                return (
                  <li key={s.id}>
                    <ActionListRow
                      leading={<McpStatusDot status={s.status} />}
                      title={s.name || s.id}
                      description={(
                        <span className="tools-mcp__manager-meta">
                          <code>{s.id}</code>
                          <span>{s.transport}</span>
                        </span>
                      )}
                      meta={(
                        <StatusPill tone={getMcpStatusTone(s.status)} size="small">
                          {s.status}
                        </StatusPill>
                      )}
                      actions={(
                        <>
                          {isRunning ? (
                            <IconButton size="xs" variant="ghost" onClick={() => void handleAction('stop', s.id)} aria-label={t('mcp.server.stop')} tooltip={t('mcp.server.stop')}>
                              <Square size={13} />
                            </IconButton>
                          ) : (
                            <IconButton size="xs" variant="ghost" onClick={() => void handleAction('start', s.id)} aria-label={t('mcp.server.start')} tooltip={t('mcp.server.start')} disabled={!s.startSupported}>
                              <Play size={13} />
                            </IconButton>
                          )}
                          <IconButton size="xs" variant="ghost" onClick={() => void handleAction('restart', s.id)} aria-label={t('mcp.server.restart')} tooltip={t('mcp.server.restart')}>
                            <RotateCw size={13} />
                          </IconButton>
                          <IconButton size="xs" variant="danger" onClick={() => setDeleteTarget(s)} aria-label={t('mcp.server.delete')} tooltip={t('mcp.server.delete')}>
                            <Trash2 size={13} />
                          </IconButton>
                        </>
                      )}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Dialog>

      <McpConfigEditor
        open={editorOpen}
        initialValue={editorInitial}
        onCancel={() => setEditorOpen(false)}
        onSave={handleSaveEditor}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setDeleteTarget(null);
          }
        }}
        onConfirm={handleDelete}
        title={t('mcp.server.deleteConfirmTitle')}
        message={t('mcp.server.deleteConfirmMessage', { id: deleteTarget?.id ?? '' })}
        type="warning"
        confirmDanger
      />
    </>
  );
};

// Root scene

const ToolsScene: React.FC = () => {
  const { t } = useTranslation('scenes/tools');
  const [selection, setSelection] = useState<Selection>(SEL_ALL);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<UnifiedTool | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);

  // Data: MCP servers and registered tools.
  const [servers, setServers] = useState<MCPServerInfo[]>([]);
  const [registeredTools, setRegisteredTools] = useState<RegisteredTool[]>([]);

  const loadMcp = useCallback(async () => {
    try {
      const [serverList, toolList] = await Promise.all([
        MCPAPI.getServers(),
        toolAPI.getAllToolsInfo().catch(() => [] as RegisteredTool[]),
      ]);
      setServers(serverList);
      setRegisteredTools((toolList as RegisteredTool[]) ?? []);
    } catch (error) {
      log.error('Failed to load MCP data', error);
    }
  }, []);

  useEffect(() => { void loadMcp(); }, [loadMcp]);

  // Derived: MCP tool entries grouped by server.
  const mcpToolsByServer = useMemo(() => {
    const map = new Map<string, McpToolEntry[]>();
    for (const tool of registeredTools) {
      if (!tool.name.startsWith(MCP_TOOL_PREFIX)) continue;
      const rest = tool.name.slice(MCP_TOOL_PREFIX.length);
      const sepIdx = rest.indexOf('__');
      if (sepIdx < 0) continue;
      const serverId = rest.slice(0, sepIdx);
      const shortName = rest.slice(sepIdx + 2);
      const entry: McpToolEntry = { ...tool, serverId, shortName };
      const arr = map.get(serverId);
      if (arr) arr.push(entry); else map.set(serverId, [entry]);
    }
    return map;
  }, [registeredTools]);

  const totalMcpTools = useMemo(
    () => Array.from(mcpToolsByServer.values()).reduce((n, arr) => n + arr.length, 0),
    [mcpToolsByServer],
  );

  // Filtered tool list for the center pane.
  const visibleTools: UnifiedTool[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items: UnifiedTool[] = [];

    const pushBuiltin = (pred: (m: BuiltinToolMeta) => boolean) => {
      for (const m of BUILTIN_TOOLS) {
        if (!pred(m)) continue;
        if (q && !m.name.toLowerCase().includes(q)) continue;
        items.push({ kind: 'builtin', meta: m });
      }
    };
    const pushMcp = (pred: (e: McpToolEntry) => boolean) => {
      mcpToolsByServer.forEach((arr) => {
        for (const e of arr) {
          if (!pred(e)) continue;
          const hay = `${e.shortName} ${e.name}`.toLowerCase();
          if (q && !hay.includes(q)) continue;
          items.push({ kind: 'mcp', mcp: e });
        }
      });
    };

    switch (selection.kind) {
      case 'all':
        pushBuiltin(() => true);
        pushMcp(() => true);
        break;
      case 'builtin-category':
        pushBuiltin((m) => m.category === selection.category);
        break;
      case 'mcp-all':
        pushMcp(() => true);
        break;
      case 'mcp-server':
        pushMcp((e) => e.serverId === selection.serverId);
        break;
    }
    return items;
  }, [selection, query, mcpToolsByServer]);

  // Keep the selected detail in sync when the underlying list changes.
  useEffect(() => {
    if (!selected) return;
    if (selected.kind === 'mcp') {
      const stillThere = mcpToolsByServer.get(selected.mcp.serverId)?.some(e => e.name === selected.mcp.name);
      if (!stillThere) setSelected(null);
    }
  }, [mcpToolsByServer, selected]);

  const counts = useMemo(() => countByCategory(), []);

  return (
    <div className="sparo-tools-scene">
      <header className="sparo-tools-scene__header">
        <div className="sparo-tools-scene__identity">
          <h1 className="sparo-tools-scene__title">{t('page.title')}</h1>
          <div className="sparo-tools-scene__subline">
            <p className="sparo-tools-scene__subtitle">{t('page.subtitle')}</p>
            <div className="sparo-tools-scene__actions">
              <Search
                className="sparo-tools-scene__search"
                value={query}
                onChange={setQuery}
                onSearch={setQuery}
                onClear={() => setQuery('')}
                placeholder={t('search.placeholder')}
                size="small"
                clearable
              />
              <Button
                variant="secondary"
                size="small"
                className="sparo-tools-scene__manage"
                onClick={() => setManagerOpen(true)}
              >
                <Settings2 size={13} />
                <span>{t('sidebar.manageServers')}</span>
                {servers.length > 0 && (
                  <Badge variant="neutral">{servers.length}</Badge>
                )}
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="sparo-tools-scene__body">
        <div className="tools-split">
          {/* Left: category tree */}
          <aside className="tools-split__sidebar">
            <CategoryTree
              selection={selection}
              onSelect={setSelection}
              counts={counts}
              totalBuiltin={BUILTIN_TOOLS.length}
              totalMcp={totalMcpTools}
              servers={servers}
              mcpToolsByServer={mcpToolsByServer}
            />
          </aside>

          {/* Middle: list */}
          <Panel className="tools-split__list">
            <PanelBody className="tools-split__rows">
              {visibleTools.length === 0 ? (
                <EmptyState description={t('list.emptyAll')} />
              ) : (
                visibleTools.map(tool => (
                  <ToolRow
                    key={tool.kind === 'builtin' ? `b:${tool.meta.name}` : `m:${tool.mcp.name}`}
                    tool={tool}
                    active={isSameTool(tool, selected)}
                    onClick={() => setSelected(tool)}
                  />
                ))
              )}
            </PanelBody>
          </Panel>

          {/* Right: detail */}
          <Panel className="tools-split__detail">
            {selected ? (
              selected.kind === 'builtin'
                ? <BuiltinToolDetail tool={selected.meta} />
                : <McpToolDetail
                    tool={selected.mcp}
                    server={servers.find(s => s.id === selected.mcp.serverId) ?? null}
                  />
            ) : (
              <div className="tools-split__detail-empty">
                <Wrench size={32} strokeWidth={1.4} />
                <span>{t('detail.selectHint')}</span>
              </div>
            )}
          </Panel>
        </div>
      </div>

      <McpManagerModal
        open={managerOpen}
        onClose={() => setManagerOpen(false)}
        servers={servers}
        onRefresh={loadMcp}
      />
    </div>
  );
};

export default ToolsScene;
