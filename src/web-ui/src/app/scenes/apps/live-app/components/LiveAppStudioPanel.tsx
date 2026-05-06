import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertTriangle,
  AppWindow,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  ScrollText,
  Send,
  Trash2,
} from 'lucide-react';
import { liveAppAPI } from '@/infrastructure/api/service-api/LiveAppAPI';
import { api } from '@/infrastructure/api/service-api/ApiClient';
import type { LiveApp } from '@/infrastructure/api/service-api/LiveAppAPI';
import { useLastUsedWorkspace } from '@/infrastructure/contexts/WorkspaceContext';
import { useTheme } from '@/infrastructure/theme/hooks/useTheme';
import { useI18n } from '@/infrastructure/i18n';
import { useOverlayManager } from '@/app/hooks/useOverlayManager';
import type { OverlaySceneId } from '@/app/overlay/types';
import {
  Alert,
  Button,
  DropdownMenu,
  Empty,
  FilterPill,
  FilterPillGroup,
  IconButton,
  Search,
} from '@/component-library';
import type { DropdownMenuEntry } from '@/component-library';
import { flowChatManager } from '@/flow_chat/services/FlowChatManager';
import { notificationService } from '@/shared/notification-system';
import { useLiveAppStore } from '../liveAppStore';
import { useLiveAppActions } from '../hooks/useLiveAppActions';
import {
  buildLiveAppRuntimeSummary,
  formatRuntimeTimestamp,
  inferRuntimeHint,
  summarizeLiveAppPermissions,
} from '../liveAppRuntimeModel';
import LiveAppRunner from './LiveAppRunner';
import './LiveAppStudioPanel.scss';

interface RuntimeIssue {
  appId: string;
  severity: 'fatal' | 'warning' | 'noise';
  message: string;
  source?: string;
  stack?: string;
  category?: string;
  timestampMs: number;
}

interface RuntimeLog {
  appId: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  category: string;
  message: string;
  source?: string;
  stack?: string;
  details?: unknown;
  timestampMs: number;
}

interface LiveAppStudioPanelProps {
  sessionId: string | null;
  appId?: string;
}

type LogLevel = 'all' | 'error' | 'warn' | 'info';
type DockState = 'collapsed' | 'open';

const MAX_VISIBLE_ISSUES = 20;
const MAX_VISIBLE_LOGS = 100;

function stringifyDiagnostic(parts: unknown[]): string {
  return parts
    .filter((part) => part != null && part !== '')
    .map((part) => (typeof part === 'string' ? part : JSON.stringify(part, null, 2)))
    .join('\n');
}

// ─── Issue Row ────────────────────────────────────────────────────────────────

interface IssueRowProps {
  issue: RuntimeIssue;
  t: (key: string, opts?: Record<string, unknown>) => string;
  onCopy: (text: string) => void;
  onRecompile: () => void;
  onRestart: () => void;
  onFixWithAi: (text: string) => void;
  currentLanguage: string;
}

const IssueRow: React.FC<IssueRowProps> = ({
  issue, t, onCopy, onRecompile, onRestart, onFixWithAi, currentLanguage,
}) => {
  const [expanded, setExpanded] = useState(issue.severity === 'fatal');
  const hintKey = inferRuntimeHint(issue.message, issue.category);
  const detailText = stringifyDiagnostic([issue.source, issue.stack]);
  const diagText = stringifyDiagnostic([issue.message, detailText]);

  return (
    <div className={`studio-issue is-${issue.severity}`}>
      <button
        type="button"
        className="studio-issue__summary"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="studio-issue__severity-dot" />
        <span className="studio-issue__message">{issue.message}</span>
        <span className="studio-issue__meta">
          {issue.category ? <span className="studio-issue__category">{issue.category}</span> : null}
          <span>{formatRuntimeTimestamp(issue.timestampMs, currentLanguage)}</span>
        </span>
        <span className="studio-issue__chevron">
          {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </span>
      </button>

      {expanded ? (
        <div className="studio-issue__detail">
          {hintKey ? (
            <div className="studio-issue__hint">
              {t(`liveAppStudio.diagnostics.hints.${hintKey}`)}
            </div>
          ) : null}
          {detailText ? <pre className="studio-issue__pre">{detailText}</pre> : null}
          <div className="studio-issue__actions">
            {issue.severity === 'fatal' ? (
              <button
                type="button"
                className="studio-issue__action is-primary"
                onClick={() => onFixWithAi(diagText)}
              >
                {t('liveAppStudio.diagnostics.fixWithAi')}
              </button>
            ) : null}
            {issue.severity === 'fatal' ? (
              <button type="button" className="studio-issue__action" onClick={onRecompile}>
                {t('liveAppStudio.panel.menu.recompile')}
              </button>
            ) : null}
            {issue.severity === 'fatal' ? (
              <button type="button" className="studio-issue__action" onClick={onRestart}>
                {t('liveApp.actions.restartWorker')}
              </button>
            ) : null}
            <button
              type="button"
              className="studio-issue__action"
              onClick={() => onCopy(diagText)}
              aria-label={t('liveAppStudio.diagnostics.copy')}
            >
              <Copy size={11} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

// ─── Log Row ──────────────────────────────────────────────────────────────────

interface LogRowProps {
  entry: RuntimeLog;
  onCopy: (text: string) => void;
  currentLanguage: string;
  copyAriaLabel: string;
}

const LogRow: React.FC<LogRowProps> = ({ entry, onCopy, currentLanguage, copyAriaLabel }) => {
  const [expanded, setExpanded] = useState(false);
  const detailText = stringifyDiagnostic([
    entry.source,
    entry.details != null ? entry.details : undefined,
    entry.stack,
  ]);
  const diagText = stringifyDiagnostic([entry.message, detailText]);
  const hasDetail = Boolean(detailText);

  return (
    <div className={`studio-log is-${entry.level}`}>
      <button
        type="button"
        className="studio-log__summary"
        onClick={() => hasDetail && setExpanded((v) => !v)}
        aria-expanded={hasDetail ? expanded : undefined}
        style={{ cursor: hasDetail ? 'pointer' : 'default' }}
      >
        <span className="studio-log__level-bar" />
        <span className="studio-log__message">{entry.message}</span>
        <span className="studio-log__meta">
          <span className="studio-log__category">{entry.level}/{entry.category}</span>
          <span>{formatRuntimeTimestamp(entry.timestampMs, currentLanguage)}</span>
        </span>
        {hasDetail ? (
          <span className="studio-log__chevron">
            {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </span>
        ) : null}
      </button>

      {expanded && detailText ? (
        <div className="studio-log__detail">
          <pre className="studio-log__pre">{detailText}</pre>
          <div className="studio-log__actions">
            <IconButton
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => onCopy(diagText)}
              tooltip={copyAriaLabel}
              aria-label={copyAriaLabel}
            >
              <Copy size={11} />
            </IconButton>
          </div>
        </div>
      ) : null}
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

const LiveAppStudioPanel: React.FC<LiveAppStudioPanelProps> = ({ sessionId, appId }) => {
  const { workspacePath } = useLastUsedWorkspace();
  const { themeType } = useTheme();
  const { currentLanguage, t } = useI18n('common');
  const { t: tApps } = useI18n('scenes/apps');
  const { openOverlay } = useOverlayManager();
  const runningWorkerIds = useLiveAppStore((state) => state.runningWorkerIds);
  const runtimeStatus = useLiveAppStore((state) => state.runtimeStatus);

  const [app, setApp] = useState<LiveApp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [issues, setIssues] = useState<RuntimeIssue[]>([]);
  const [logs, setLogs] = useState<RuntimeLog[]>([]);
  const [runtimeView, setRuntimeView] = useState<'issues' | 'logs'>('issues');
  const [dockState, setDockState] = useState<DockState>('collapsed');
  const [sendingIssues, setSendingIssues] = useState(false);
  const [clearingIssues, setClearingIssues] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [logFilter, setLogFilter] = useState<LogLevel>('all');
  const [logSearch, setLogSearch] = useState('');
  const [followTail, setFollowTail] = useState(true);
  const [newLogCount, setNewLogCount] = useState(0);

  const menuAnchorRef = useRef<HTMLButtonElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsScrollRef = useRef<HTMLDivElement>(null);

  const actions = useLiveAppActions(appId);

  const load = useCallback(async () => {
    if (!appId) return;
    setLoading(true);
    try {
      const loaded = await liveAppAPI.getLiveApp(appId, themeType ?? 'dark', workspacePath || undefined);
      setApp(loaded);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      void liveAppAPI
        .reportRuntimeLog({ appId, level: 'error', category: 'studio:preview', message: `Failed to load Live App preview: ${message}` })
        .catch(() => undefined);
    } finally {
      setLoading(false);
    }
  }, [appId, themeType, workspacePath]);

  useEffect(() => {
    setIssues([]);
    setLogs([]);
    if (appId) void load();
  }, [appId, load]);

  useEffect(() => {
    if (!appId) return;
    const shouldHandle = (payload?: { id?: string }) => payload?.id === appId;
    const reload = (payload?: { id?: string }) => {
      if (shouldHandle(payload)) void load();
    };
    const reloadAfterRecompile = (payload?: { id?: string }) => {
      if (!shouldHandle(payload)) return;
      setIssues([]);
      reload(payload);
    };
    const unlistenUpdated = api.listen<{ id?: string }>('liveapp-updated', reload);
    const unlistenRecompiled = api.listen<{ id?: string }>('liveapp-recompiled', reloadAfterRecompile);
    const unlistenIssue = api.listen<RuntimeIssue>('liveapp-runtime-error', (payload) => {
      if (payload?.appId !== appId || payload.severity === 'noise') return;
      setIssues((current) => [payload, ...current].slice(0, MAX_VISIBLE_ISSUES));
      if (payload.severity === 'fatal') setDockState('open');
    });
    const unlistenLog = api.listen<RuntimeLog>('liveapp-runtime-log', (payload) => {
      if (payload?.appId !== appId) return;
      setLogs((current) => [...current, payload].slice(-MAX_VISIBLE_LOGS));
      setNewLogCount((n) => (followTail ? 0 : n + 1));
    });
    const unlistenCleared = api.listen<{ appId?: string }>('liveapp-runtime-errors-cleared', (payload) => {
      if (payload?.appId !== appId) return;
      setIssues([]);
      setLogs([]);
      setNewLogCount(0);
    });

    return () => {
      unlistenUpdated();
      unlistenRecompiled();
      unlistenIssue();
      unlistenLog();
      unlistenCleared();
    };
  }, [appId, followTail, load]);

  // Auto-scroll logs to bottom when following tail
  useEffect(() => {
    if (followTail && runtimeView === 'logs') {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      setNewLogCount(0);
    }
  }, [logs, followTail, runtimeView]);

  const handleLogsScroll = useCallback(() => {
    const el = logsScrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (atBottom && !followTail) {
      setFollowTail(true);
      setNewLogCount(0);
    } else if (!atBottom && followTail) {
      setFollowTail(false);
    }
  }, [followTail]);

  const handleResumeFollow = useCallback(() => {
    setFollowTail(true);
    setNewLogCount(0);
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const issueCounts = useMemo(
    () =>
      issues.reduce(
        (acc, issue) => {
          if (issue.severity === 'fatal') acc.fatal += 1;
          if (issue.severity === 'warning') acc.warning += 1;
          acc.total += 1;
          return acc;
        },
        { fatal: 0, warning: 0, total: 0 },
      ),
    [issues],
  );

  const filteredLogs = useMemo(() => {
    let result = logs.filter((e) => e.level !== 'debug');
    if (logFilter !== 'all') {
      const levels = logFilter === 'error' ? ['error'] : logFilter === 'warn' ? ['warn'] : ['info'];
      result = result.filter((e) => levels.includes(e.level));
    }
    if (logSearch.trim()) {
      const q = logSearch.toLowerCase();
      result = result.filter(
        (e) =>
          e.message.toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q) ||
          (e.source ?? '').toLowerCase().includes(q),
      );
    }
    return result;
  }, [logFilter, logSearch, logs]);

  const isRunning = Boolean(appId && runningWorkerIds.includes(appId));
  const runtimeSummary = useMemo(() => {
    if (!app) return null;
    return buildLiveAppRuntimeSummary(app, { isOpen: false, isRunning, runtimeStatus });
  }, [app, isRunning, runtimeStatus]);
  const permissionSummary = useMemo(() => (app ? summarizeLiveAppPermissions(app.permissions) : null), [app]);

  const runnerKey = useMemo(
    () =>
      app
        ? `${app.id}:${app.runtime?.source_revision ?? 'runtime'}:${themeType ?? 'dark'}:${workspacePath ?? ''}:${reloadNonce}`
        : `loading:${appId ?? 'none'}:${reloadNonce}`,
    [app, appId, reloadNonce, themeType, workspacePath],
  );

  const handleOpenInApps = useCallback(() => {
    if (appId) openOverlay(`live-app:${appId}` as OverlaySceneId);
  }, [appId, openOverlay]);

  const handleReloadUi = useCallback(() => {
    setReloadNonce((v) => v + 1);
    void load();
  }, [load]);

  const handleClearIssues = useCallback(async () => {
    if (!appId || clearingIssues) return;
    setClearingIssues(true);
    try {
      await liveAppAPI.clearRuntimeIssues(appId);
      setIssues([]);
      setLogs([]);
      setNewLogCount(0);
    } catch (err) {
      notificationService.error(err instanceof Error ? err.message : String(err), { duration: 4000 });
    } finally {
      setClearingIssues(false);
    }
  }, [appId, clearingIssues]);

  const copyDiagnostic = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        notificationService.success(t('liveAppStudio.diagnostics.copied'), { duration: 1800 });
      } catch (err) {
        notificationService.error(err instanceof Error ? err.message : String(err));
      }
    },
    [t],
  );

  const buildIssuePrompt = useCallback(
    (singleIssueText?: string) => {
      if (singleIssueText) {
        return `Fix the following Live App runtime issue (App: ${app?.name ?? appId ?? 'unknown'}):\n\n${singleIssueText}`;
      }
      const appLabel = app ? `${app.name} (${app.id})` : appId ?? 'current Live App';
      const issueLines = issues.slice(0, MAX_VISIBLE_ISSUES).map((issue, index) => {
        const detail = stringifyDiagnostic([issue.source, issue.stack]);
        return [`#${index + 1} [${issue.severity}] ${issue.category ?? 'runtime'}`, `Message: ${issue.message}`, detail]
          .filter(Boolean)
          .join('\n');
      });
      const logLines = filteredLogs.slice(-40).map((entry, index) => {
        const detail = stringifyDiagnostic([
          entry.source,
          entry.details != null ? entry.details : undefined,
          entry.stack,
        ]);
        return [`#${index + 1} [${entry.level}] ${entry.category}`, `Message: ${entry.message}`, detail]
          .filter(Boolean)
          .join('\n');
      });
      return [
        `Fix the current Live App based on its Studio diagnostics. App: ${appLabel}`,
        '',
        'Recent issues:',
        issueLines.length > 0 ? issueLines.join('\n\n---\n\n') : 'No fatal/warning issues.',
        '',
        'Recent logs:',
        logLines.length > 0 ? logLines.join('\n\n---\n\n') : 'No runtime logs.',
      ].join('\n');
    },
    [app, appId, filteredLogs, issues],
  );

  const handleSendIssuesToAi = useCallback(
    async (singleIssueText?: string) => {
      if (!sessionId || sendingIssues) return;
      if (!singleIssueText && issues.length === 0 && filteredLogs.length === 0) return;
      setSendingIssues(true);
      try {
        await flowChatManager.sendMessage(
          buildIssuePrompt(singleIssueText),
          sessionId,
          t('liveAppStudio.diagnostics.sendDisplay'),
        );
        notificationService.success(t('liveAppStudio.diagnostics.sent'), { duration: 2000 });
      } catch (err) {
        notificationService.error(err instanceof Error ? err.message : String(err), { duration: 4000 });
      } finally {
        setSendingIssues(false);
      }
    },
    [buildIssuePrompt, filteredLogs.length, issues.length, sendingIssues, sessionId, t],
  );

  // ── Permissions submenu entries ────────────────────────────────────────────
  const permissionSubmenu = useMemo((): DropdownMenuEntry[] => {
    if (!permissionSummary) return [];
    const row = (id: string, label: string): DropdownMenuEntry => ({
      type: 'item', id, label, disabled: true,
    });
    return [
      row('read',  permissionSummary.readsWorkspace  ? tApps('liveApp.permissions.readWorkspace')  : tApps('liveApp.permissions.noWorkspaceRead')),
      row('write', permissionSummary.writesWorkspace ? tApps('liveApp.permissions.writeWorkspace') : tApps('liveApp.permissions.noWorkspaceWrite')),
      row('shell', permissionSummary.shellEnabled    ? tApps('liveApp.permissions.shellEnabled')   : tApps('liveApp.permissions.shellDisabled')),
      row('net',   permissionSummary.netEnabled      ? tApps('liveApp.permissions.netEnabled')     : tApps('liveApp.permissions.netDisabled')),
      row('ai',    permissionSummary.aiEnabled       ? tApps('liveApp.permissions.aiEnabled')      : tApps('liveApp.permissions.aiDisabled')),
      row('node',  permissionSummary.nodeEnabled     ? tApps('liveApp.permissions.nodeEnabled')    : tApps('liveApp.permissions.nodeDisabled')),
    ];
  }, [permissionSummary, tApps]);

  // ── Action menu items ──────────────────────────────────────────────────────
  const menuItems = useMemo((): DropdownMenuEntry[] => [
    {
      type: 'item',
      id: 'recompile',
      label: t('liveAppStudio.panel.menu.recompile'),
      onClick: () => void actions.recompile(),
      disabled: actions.state.recompiling,
    },
    {
      type: 'item',
      id: 'sync',
      label: t('liveAppStudio.panel.menu.syncFromFs'),
      onClick: () => void actions.syncFromFs((synced) => setApp(synced)),
      disabled: actions.state.syncing,
    },
    {
      type: 'item',
      id: 'install',
      label: t('liveAppStudio.panel.menu.installDeps'),
      onClick: () => void actions.installDeps(() => void load()),
      disabled: actions.state.installingDeps,
    },
    { type: 'separator', id: 'sep1' },
    {
      type: 'item',
      id: 'open-in-apps',
      label: t('liveAppStudio.panel.menu.openInApps'),
      onClick: handleOpenInApps,
      disabled: !appId,
    },
    {
      type: 'item',
      id: 'reload',
      label: t('liveAppStudio.panel.menu.reload'),
      onClick: handleReloadUi,
      disabled: !appId || loading,
    },
    ...(permissionSummary
      ? [{
          type: 'item' as const,
          id: 'permissions',
          label: t('liveAppStudio.panel.menu.viewPermissions'),
          submenu: permissionSubmenu,
        }]
      : []),
    { type: 'separator', id: 'sep2' },
    {
      type: 'item',
      id: 'copy-id',
      label: t('liveAppStudio.panel.menu.copyAppId'),
      onClick: () => void (async () => {
        if (!appId) return;
        try {
          await navigator.clipboard.writeText(appId);
          notificationService.success(t('liveAppStudio.diagnostics.copyAppId'), { duration: 1800 });
        } catch { /* noop */ }
      })(),
      disabled: !appId,
    },
    {
      type: 'label',
      id: 'meta',
      content: [
        t('liveAppStudio.panel.menu.theme', { theme: themeType ?? 'dark' }),
        t('liveAppStudio.panel.menu.language', { lang: currentLanguage }),
      ],
    },
  ], [actions, appId, currentLanguage, handleOpenInApps, handleReloadUi, load, loading, permissionSubmenu, permissionSummary, t, themeType]);

  // ── Dock status ────────────────────────────────────────────────────────────
  const dockStatusLabel = useMemo(() => {
    if (issueCounts.fatal > 0) return t('liveAppStudio.diagnostics.fatalCount', { count: issueCounts.fatal });
    if (issueCounts.warning > 0) return t('liveAppStudio.diagnostics.warningCount', { count: issueCounts.warning });
    return t('liveAppStudio.diagnostics.ok');
  }, [issueCounts, t]);
  const dockStatusClass = issueCounts.fatal > 0 ? 'is-fatal' : issueCounts.warning > 0 ? 'is-warning' : 'is-ok';

  // ── Runtime dot state ──────────────────────────────────────────────────────
  const runtimeDotClass = useMemo(() => {
    if (issueCounts.fatal > 0) return 'is-error';
    if (isRunning) return 'is-running';
    if (runtimeSummary?.depsDirty || runtimeSummary?.workerRestartRequired) return 'is-warning';
    // Apps without a node worker are "running" as soon as they are loaded with no issues
    if (app && runtimeSummary && !runtimeSummary.nodeEnabled) return 'is-running';
    return 'is-idle';
  }, [app, isRunning, issueCounts.fatal, runtimeSummary]);

  return (
    <div className={`live-app-studio-panel${dockState === 'collapsed' ? ' is-dock-collapsed' : ''}`}>
      {/* ── Status Bar ─────────────────────────────────────────────────── */}
      <div className="studio-statusbar">
        <div className="studio-statusbar__left">
          <span className={`studio-statusbar__dot ${runtimeDotClass}`} />
          <span className="studio-statusbar__name">{app?.name || t('liveAppStudio.panel.title')}</span>
          {runtimeSummary?.runtimeLabel ? (
            <span className="studio-statusbar__runtime-label">{runtimeSummary.runtimeLabel}</span>
          ) : null}
        </div>

        <div className="studio-statusbar__ctas">
          {runtimeSummary?.depsDirty ? (
            <button
              type="button"
              className="studio-statusbar__cta is-warning"
              onClick={() => void actions.installDeps(() => void load())}
              disabled={actions.state.installingDeps}
            >
              {actions.state.installingDeps ? <Loader2 size={11} className="studio-spin" /> : null}
              {tApps('liveApp.actions.installDeps')}
            </button>
          ) : null}
          {runtimeSummary?.workerRestartRequired && !isRunning ? (
            <button
              type="button"
              className="studio-statusbar__cta is-warning"
              onClick={() => void actions.stopWorker(() => void load())}
              disabled={actions.state.restartingWorker}
            >
              {actions.state.restartingWorker ? <Loader2 size={11} className="studio-spin" /> : null}
              {tApps('liveApp.actions.restartWorker')}
            </button>
          ) : null}
          {isRunning ? (
            <button
              type="button"
              className="studio-statusbar__cta is-running"
              onClick={() => void actions.stopWorker()}
              disabled={actions.state.restartingWorker}
            >
              {tApps('liveApp.detail.stop')}
            </button>
          ) : null}
        </div>

        <div className="studio-statusbar__actions">
          <IconButton
            variant="ghost"
            size="xs"
            onClick={handleReloadUi}
            disabled={!appId || loading}
            tooltip={t('liveAppStudio.panel.menu.reload')}
            aria-label={t('liveAppStudio.panel.menu.reload')}
          >
            {loading ? <Loader2 size={13} className="studio-spin" /> : <RefreshCw size={13} />}
          </IconButton>
          <IconButton
            variant="ghost"
            size="xs"
            onClick={handleOpenInApps}
            disabled={!appId}
            tooltip={t('liveAppStudio.panel.menu.openInApps')}
            aria-label={t('liveAppStudio.panel.menu.openInApps')}
          >
            <ExternalLink size={13} />
          </IconButton>
          {/* ⋯ Action menu (permissions is a submenu inside) */}
          <IconButton
            ref={menuAnchorRef}
            variant="ghost"
            size="xs"
            onClick={() => setMenuOpen((v) => !v)}
            disabled={!appId}
            tooltip="More actions"
            aria-label="More actions"
            aria-haspopup="true"
            aria-expanded={menuOpen}
          >
            <MoreHorizontal size={13} />
          </IconButton>
          <DropdownMenu
            open={menuOpen}
            anchorRef={menuAnchorRef}
            items={menuItems}
            onClose={() => setMenuOpen(false)}
            align="right"
            minWidth={180}
          />
        </div>
      </div>

      {/* ── Preview ──────────────────────────────────────────────────────── */}
      <div className="studio-preview">
        {!appId ? (
          <div className="studio-preview__empty">
            <AppWindow size={34} strokeWidth={1.5} />
            <div>{t('liveAppStudio.panel.emptyTitle')}</div>
            <p>{t('liveAppStudio.panel.emptyDescription')}</p>
          </div>
        ) : null}
        {appId && loading && !app ? (
          <div className="studio-preview__empty">
            <Loader2 size={28} className="studio-spin" />
            <div>{t('liveAppStudio.panel.loading')}</div>
          </div>
        ) : null}
        {error && !app ? (
          <div className="studio-preview__empty is-error">
            <AlertTriangle size={28} strokeWidth={1.5} />
            <div>{t('liveAppStudio.panel.loadFailed')}</div>
            <p>{error}</p>
            <Button variant="secondary" size="small" onClick={() => void load()}>
              {t('liveAppStudio.panel.retry')}
            </Button>
          </div>
        ) : null}
        {app ? (
          <React.Suspense fallback={null}>
            <LiveAppRunner key={runnerKey} app={app} />
          </React.Suspense>
        ) : null}
        {loading && app ? (
          <div className="studio-preview__updating" role="status" aria-live="polite">
            <Loader2 size={14} className="studio-spin" />
            <span>{t('liveAppStudio.panel.updating')}</span>
          </div>
        ) : null}
      </div>

      {/* ── Diagnostics Dock ─────────────────────────────────────────────── */}
      <div className="studio-dock">
        {/* Header — always visible */}
        <div className="studio-dock__header">
          <button
            type="button"
            className="studio-dock__toggle"
            onClick={() => setDockState((s) => (s === 'collapsed' ? 'open' : 'collapsed'))}
            aria-expanded={dockState === 'open'}
          >
            <span className="studio-dock__title">{t('liveAppStudio.diagnostics.title')}</span>
            <span className={`studio-dock__status ${dockStatusClass}`}>{dockStatusLabel}</span>
            <span className="studio-dock__chevron">
              {dockState === 'open' ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
            </span>
          </button>

          <div className="studio-dock__header-actions">
            <IconButton
              variant="ghost"
              size="xs"
              onClick={() => void handleSendIssuesToAi()}
              disabled={!sessionId || (issues.length === 0 && filteredLogs.length === 0) || sendingIssues}
              tooltip={t('liveAppStudio.diagnostics.sendToAi')}
              aria-label={t('liveAppStudio.diagnostics.sendToAi')}
            >
              {sendingIssues ? <Loader2 size={12} className="studio-spin" /> : <Send size={12} />}
            </IconButton>
            <IconButton
              variant="ghost"
              size="xs"
              onClick={() => void handleClearIssues()}
              disabled={!appId || (issues.length === 0 && logs.length === 0) || clearingIssues}
              tooltip={t('liveAppStudio.diagnostics.clear')}
              aria-label={t('liveAppStudio.diagnostics.clear')}
            >
              {clearingIssues ? <Loader2 size={12} className="studio-spin" /> : <Trash2 size={12} />}
            </IconButton>
          </div>
        </div>

        {/* Body — only when open */}
        {dockState === 'open' ? (
          <div className="studio-dock__body">
            {/* Tabs */}
            <div className="studio-dock__tabs">
              <button
                type="button"
                className={`studio-dock__tab${runtimeView === 'issues' ? ' is-active' : ''}`}
                onClick={() => setRuntimeView('issues')}
              >
                {t('liveAppStudio.diagnostics.issuesTab')}
                {issueCounts.total > 0 ? (
                  <span className={`studio-dock__tab-badge ${issueCounts.fatal > 0 ? 'is-fatal' : 'is-warning'}`}>
                    {issueCounts.total > 99 ? '99+' : issueCounts.total}
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                className={`studio-dock__tab${runtimeView === 'logs' ? ' is-active' : ''}`}
                onClick={() => setRuntimeView('logs')}
              >
                {t('liveAppStudio.diagnostics.logsTab')}
                {filteredLogs.length > 0 ? (
                  <span className="studio-dock__tab-badge is-neutral">
                    {filteredLogs.length > 99 ? '99+' : filteredLogs.length}
                  </span>
                ) : null}
              </button>

              {runtimeView === 'logs' ? (
                <div className="studio-dock__log-controls">
                  <FilterPillGroup className="studio-dock__log-filter-group">
                    {(['all', 'error', 'warn', 'info'] as LogLevel[]).map((level) => (
                      <FilterPill
                        key={level}
                        label={t(`liveAppStudio.diagnostics.filter${level.charAt(0).toUpperCase()}${level.slice(1)}`)}
                        active={logFilter === level}
                        onClick={() => setLogFilter(level)}
                      />
                    ))}
                  </FilterPillGroup>
                  <Search
                    className="studio-dock__log-search-field"
                    value={logSearch}
                    onChange={setLogSearch}
                    placeholder={t('liveAppStudio.diagnostics.searchPlaceholder')}
                    size="small"
                    enterToSearch={false}
                  />
                </div>
              ) : null}
            </div>

            {/* List */}
            <div
              className="studio-dock__list"
              ref={logsScrollRef}
              onScroll={runtimeView === 'logs' ? handleLogsScroll : undefined}
            >
              {runtimeView === 'issues' ? (
                issues.length === 0 ? (
                  <div className="studio-dock__empty">{t('liveAppStudio.diagnostics.empty')}</div>
                ) : (
                  issues.map((issue, index) => (
                    <IssueRow
                      key={`${issue.severity}-${issue.timestampMs}-${index}`}
                      issue={issue}
                      t={t}
                      onCopy={(text) => void copyDiagnostic(text)}
                      onRecompile={() => void actions.recompile()}
                      onRestart={() => void actions.stopWorker(() => void load())}
                      onFixWithAi={(text) => void handleSendIssuesToAi(text)}
                      currentLanguage={currentLanguage}
                    />
                  ))
                )
              ) : filteredLogs.length === 0 ? (
                <Empty
                  className="studio-dock__logs-empty"
                  image={<ScrollText size={28} strokeWidth={1.5} aria-hidden />}
                  imageSize={28}
                  description={t('liveAppStudio.diagnostics.logsEmpty')}
                />
              ) : (
                <>
                  {logs.length >= MAX_VISIBLE_LOGS ? (
                    <Alert
                      type="info"
                      className="studio-dock__truncated-alert"
                      message={t('liveAppStudio.diagnostics.truncatedHint', {
                        max: MAX_VISIBLE_LOGS,
                        path: `${workspacePath ?? ''}/.sparo_os/debug.log`,
                      })}
                    />
                  ) : null}
                  {filteredLogs.map((entry, index) => (
                    <LogRow
                      key={`${entry.timestampMs}-${index}`}
                      entry={entry}
                      onCopy={(text) => void copyDiagnostic(text)}
                      currentLanguage={currentLanguage}
                      copyAriaLabel={t('liveAppStudio.diagnostics.copy')}
                    />
                  ))}
                  <div ref={logsEndRef} />
                </>
              )}
            </div>

            {/* New-logs banner */}
            {runtimeView === 'logs' && !followTail && newLogCount > 0 ? (
              <Button
                type="button"
                variant="accent"
                size="small"
                className="studio-dock__new-logs-banner"
                onClick={handleResumeFollow}
              >
                {t('liveAppStudio.diagnostics.newMessages', { count: newLogCount })}
                <ChevronDown size={12} />
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default LiveAppStudioPanel;
