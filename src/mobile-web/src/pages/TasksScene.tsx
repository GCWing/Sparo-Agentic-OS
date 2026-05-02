import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { RemoteSessionManager, type SessionInfo } from '../services/RemoteSessionManager';
import { useMobileStore } from '../services/store';
import EyebrowLabel from '../components/EyebrowLabel';
import IgnitionDot from '../components/IgnitionDot';
import BottomSheet from '../components/BottomSheet';
import HairlineDivider from '../components/HairlineDivider';
import './TasksScene.scss';

interface TasksSceneProps {
  sessionMgr: RemoteSessionManager;
  onSelectSession: (sessionId: string, sessionName?: string, sessionMode?: string) => void;
}

type DisplayMode = 'time' | 'workspace';

const PAGE_SIZE = 100;
const ALL = '__all__';

// Map Rust agent_type strings to display labels
const AGENT_TYPE_LABELS: Record<string, string> = {
  agentic: 'Code',
  Agentic: 'Code',
  code: 'Code',
  cowork: 'Cowork',
  Cowork: 'Cowork',
  design: 'Design',
  Design: 'Design',
  deepresearch: 'Deep Research',
  DeepResearch: 'Deep Research',
  liveappstudio: 'Live App',
  LiveAppStudio: 'Live App',
  plan: 'Plan',
  Plan: 'Plan',
  debug: 'Debug',
  dispatcher: 'Sparo OS',
  Dispatcher: 'Sparo OS',
};

// Agent type options for new session creation (matches desktop NewSessionDialog)
interface AgentTypeOption {
  type: string;
  labelKey: string;
  descKey: string;
  /** Short color badge abbreviation shown instead of emoji */
  badge: string;
  /** Badge background color token */
  badgeColor: string;
  needsWorkspace: boolean;
}

const NEW_SESSION_AGENT_TYPES: AgentTypeOption[] = [
  { type: 'agentic',       labelKey: 'sessions.agentCode',          descKey: 'sessions.agentCodeDesc',          badge: 'AI',   badgeColor: '#1E40AF', needsWorkspace: true  },
  { type: 'Cowork',        labelKey: 'sessions.agentCowork',        descKey: 'sessions.agentCoworkDesc',        badge: 'CW',   badgeColor: '#065F46', needsWorkspace: true  },
  { type: 'Design',        labelKey: 'sessions.agentDesign',        descKey: 'sessions.agentDesignDesc',        badge: 'DS',   badgeColor: '#6D28D9', needsWorkspace: true  },
  { type: 'DeepResearch',  labelKey: 'sessions.agentDeepResearch',  descKey: 'sessions.agentDeepResearchDesc',  badge: 'DR',   badgeColor: '#92400E', needsWorkspace: true  },
  { type: 'LiveAppStudio', labelKey: 'sessions.agentLiveAppStudio', descKey: 'sessions.agentLiveAppStudioDesc', badge: 'LA',   badgeColor: '#BE123C', needsWorkspace: false },
];

function agentLabel(agentType: string): string {
  return AGENT_TYPE_LABELS[agentType] ?? agentType;
}

function formatTime(
  unixStr: string,
  language: string,
  t: (k: string, p?: Record<string, string | number>) => string,
): string {
  const ts = parseInt(unixStr, 10);
  if (!ts || isNaN(ts)) return '';
  const date = new Date(ts * 1000);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return t('common.justNow');
  if (diffMin < 60) return t('common.minutesAgo', { count: diffMin });
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return t('common.hoursAgo', { count: diffHr });
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return t('common.daysAgo', { count: diffDay });
  return date.toLocaleDateString(language);
}

function isRunning(_s: SessionInfo): boolean {
  return false;
}

function workspaceLabel(s: SessionInfo, language: string): string {
  if (s.workspace_name) return s.workspace_name;
  if (s.workspace_path) {
    return s.workspace_path.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? s.workspace_path;
  }
  return language === 'zh-CN' ? '无工作区' : 'No Workspace';
}

const FilterIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
  </svg>
);
const ListIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
);
const FolderIcon: React.FC<{ size?: number }> = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const TasksScene: React.FC<TasksSceneProps> = ({ sessionMgr, onSelectSession }) => {
  const { t, language } = useI18n();
  const { sessions, setSessions, currentWorkspace } = useMobileStore();

  const [displayMode, setDisplayMode] = useState<DisplayMode>('time');
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);

  // Two-step new session: step 1 = pick agent type, step 2 = pick workspace
  const [pendingOption, setPendingOption] = useState<AgentTypeOption | null>(null);
  const [recentWorkspaces, setRecentWorkspaces] = useState<{ path: string; name: string }[]>([]);
  const [wsPickerOpen, setWsPickerOpen] = useState(false);

  // Filters
  const [filterWorkspace, setFilterWorkspace] = useState<string>(ALL);
  const [filterAgentType, setFilterAgentType] = useState<string>(ALL);

  // Action sheet
  const [longPressSession, setLongPressSession] = useState<SessionInfo | null>(null);
  const [actionSheet, setActionSheet] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout>>();

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      // Load all sessions (no workspace filter so we see all workspaces)
      const resp = await sessionMgr.listSessions(undefined, PAGE_SIZE, 0);
      setSessions(resp.sessions);
    } catch {
      // ignore transient errors
    } finally {
      setLoading(false);
    }
  }, [sessionMgr, setSessions]);

  useEffect(() => { void loadSessions(); }, [loadSessions]);
  useEffect(() => {
    const id = setInterval(() => { void loadSessions(); }, 10000);
    return () => clearInterval(id);
  }, [loadSessions]);

  // Distinct workspaces and agent types for filter chips
  const workspaces = useMemo(() => {
    const map: Record<string, string> = {};
    sessions.forEach((s) => {
      const key = s.workspace_path ?? '__none__';
      if (!map[key]) map[key] = workspaceLabel(s, language);
    });
    return map;
  }, [sessions, language]);

  const agentTypes = useMemo(() => {
    const types = new Set<string>();
    sessions.forEach((s) => { if (s.agent_type) types.add(s.agent_type); });
    return Array.from(types);
  }, [sessions]);

  // Apply filters
  const filtered = useMemo(() => {
    return sessions.filter((s) => {
      if (filterWorkspace !== ALL) {
        const key = s.workspace_path ?? '__none__';
        if (key !== filterWorkspace) return false;
      }
      if (filterAgentType !== ALL && s.agent_type !== filterAgentType) return false;
      return true;
    });
  }, [sessions, filterWorkspace, filterAgentType]);

  const hasFilters = filterWorkspace !== ALL || filterAgentType !== ALL;

  // Step 1: user picked an agent type from the FAB sheet
  const handlePickAgentType = useCallback(async (option: AgentTypeOption) => {
    if (!option.needsWorkspace) {
      // LiveAppStudio: no workspace needed, create directly
      setFabOpen(false);
      setCreating(true);
      try {
        const id = await sessionMgr.createSession(option.type, undefined, undefined);
        await loadSessions();
        onSelectSession(id, agentLabel(option.type), option.type);
      } catch { /* ignore */ } finally { setCreating(false); }
      return;
    }
    // Load recent workspaces for step 2
    setFabOpen(false);
    setPendingOption(option);
    try {
      const entries = await sessionMgr.listRecentWorkspaces();
      setRecentWorkspaces(entries.map(e => ({ path: e.path, name: e.name })));
    } catch {
      setRecentWorkspaces(currentWorkspace?.path
        ? [{ path: currentWorkspace.path, name: currentWorkspace.project_name ?? currentWorkspace.path }]
        : []);
    }
    setWsPickerOpen(true);
  }, [currentWorkspace, loadSessions, onSelectSession, sessionMgr]);

  // Step 2: user picked a workspace
  const handlePickWorkspace = useCallback(async (workspacePath: string) => {
    if (!pendingOption || creating) return;
    setWsPickerOpen(false);
    setPendingOption(null);
    setCreating(true);
    try {
      const id = await sessionMgr.createSession(pendingOption.type, undefined, workspacePath);
      await loadSessions();
      onSelectSession(id, agentLabel(pendingOption.type), pendingOption.type);
    } catch { /* ignore */ } finally { setCreating(false); }
  }, [creating, loadSessions, onSelectSession, pendingOption, sessionMgr]);

  const handleLongPressStart = (s: SessionInfo) => {
    longPressTimer.current = setTimeout(() => { setLongPressSession(s); setActionSheet(true); }, 500);
  };
  const handleLongPressEnd = () => { clearTimeout(longPressTimer.current); };

  const handleDelete = useCallback(async () => {
    if (!longPressSession) return;
    setActionSheet(false);
    try {
      await sessionMgr.deleteSession(longPressSession.session_id);
      await loadSessions();
    } catch { /* ignore */ }
  }, [longPressSession, sessionMgr, loadSessions]);

  const renderRow = (s: SessionInfo, index: number, pulsing: boolean) => (
    <React.Fragment key={s.session_id}>
      <div
        className="tasks-row"
        role="button"
        tabIndex={0}
        onClick={() => onSelectSession(s.session_id, s.name, s.agent_type)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSelectSession(s.session_id, s.name, s.agent_type); }}
        onTouchStart={() => handleLongPressStart(s)}
        onTouchEnd={handleLongPressEnd}
        onMouseDown={() => handleLongPressStart(s)}
        onMouseUp={handleLongPressEnd}
      >
        <div className="tasks-row__body">
          <span className="tasks-row__name">{s.name || t('sessions.untitledSession')}</span>
          <div className="tasks-row__meta-row">
            {s.agent_type && (
              <span className="tasks-row__tag">{agentLabel(s.agent_type)}</span>
            )}
            <span className="tasks-row__meta">{formatTime(s.updated_at, language, t)}</span>
            {displayMode === 'time' && s.workspace_path && (
              <>
                <span className="tasks-row__meta-sep">·</span>
                <span className="tasks-row__meta tasks-row__meta--ws">
                  <FolderIcon size={11} />
                  {workspaceLabel(s, language)}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="tasks-row__end">
          {pulsing && <IgnitionDot pulsing size="sm" />}
          <svg className="tasks-row__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </div>
      </div>
      <HairlineDivider />
    </React.Fragment>
  );

  // ── Time view (sorted by updated_at desc) ─────────────────────────────────
  const renderTimeView = () => {
    const sorted = [...filtered].sort((a, b) => {
      const ta = parseInt(a.updated_at, 10) || 0;
      const tb = parseInt(b.updated_at, 10) || 0;
      return tb - ta;
    });
    const active = sorted.filter(isRunning);
    const recent = sorted.filter((s) => !isRunning(s));

    return (
      <>
        {active.length > 0 && (
          <div className="tasks-scene__section">
            <div className="tasks-scene__section-head">
              <EyebrowLabel>{t('sessions.active')}</EyebrowLabel>
            </div>
            <HairlineDivider />
            {active.map((s, i) => renderRow(s, i, true))}
          </div>
        )}
        <div className="tasks-scene__section">
          {recent.length === 0 && !loading && (
            <div className="tasks-scene__empty">{t('tasks.noRecentSessions')}</div>
          )}
          {recent.map((s, i) => renderRow(s, active.length + i, false))}
        </div>
      </>
    );
  };

  // ── Workspace view (grouped) ──────────────────────────────────────────────
  const renderWorkspaceView = () => {
    const NO_WS = '__none__';
    const groups: Record<string, SessionInfo[]> = {};
    filtered.forEach((s) => {
      const key = s.workspace_path ?? NO_WS;
      if (!groups[key]) groups[key] = [];
      groups[key].push(s);
    });

    // Sort each group by updated_at desc
    Object.values(groups).forEach((arr) =>
      arr.sort((a, b) => (parseInt(b.updated_at, 10) || 0) - (parseInt(a.updated_at, 10) || 0)),
    );

    const groupKeys = Object.keys(groups).sort((a, b) => {
      if (a === NO_WS) return 1;
      if (b === NO_WS) return -1;
      return (workspaces[a] ?? a).localeCompare(workspaces[b] ?? b);
    });

    if (groupKeys.length === 0 && !loading) {
      return <div className="tasks-scene__empty">{t('tasks.noRecentSessions')}</div>;
    }

    let globalIdx = 0;
    return (
      <>
        {groupKeys.map((key) => {
          const items = groups[key];
          const groupName = workspaces[key] ?? (language === 'zh-CN' ? '无工作区' : 'No Workspace');
          return (
            <div className="tasks-scene__section" key={key}>
              <div className="tasks-scene__section-head tasks-scene__section-head--ws">
                <FolderIcon />
                <span className="tasks-scene__ws-label">{groupName}</span>
                <span className="tasks-scene__section-count">({items.length})</span>
              </div>
              <HairlineDivider />
              {items.map((s) => renderRow(s, globalIdx++, isRunning(s)))}
            </div>
          );
        })}
      </>
    );
  };

  return (
    <div className="tasks-scene">
      {/* Toolbar */}
      <div className="tasks-scene__toolbar">
        <span className="tasks-scene__title">
          {t('tasks.title')}
          {filtered.length > 0 && (
            <span className="tasks-scene__title-count"> ({filtered.length})</span>
          )}
        </span>
        <div className="tasks-scene__toolbar-right">
          <button
            type="button"
            className={`tasks-scene__mode-btn${displayMode === 'workspace' ? ' is-active' : ''}`}
            onClick={() => setDisplayMode((m) => m === 'time' ? 'workspace' : 'time')}
            aria-label={displayMode === 'time' ? 'Group by workspace' : 'Sort by time'}
            title={displayMode === 'time' ? 'Group by workspace' : 'Sort by time'}
          >
            {displayMode === 'time' ? <FolderIcon /> : <ListIcon />}
          </button>
          <button
            type="button"
            className={`tasks-scene__mode-btn${hasFilters ? ' is-active' : ''}`}
            onClick={() => setFilterOpen(true)}
            aria-label="Filter"
          >
            <FilterIcon />
            {hasFilters && <span className="tasks-scene__filter-badge" />}
          </button>
        </div>
      </div>

      <div className="tasks-scene__list">
        {loading && sessions.length === 0 && (
          <div className="tasks-scene__empty">{t('common.loading')}</div>
        )}
        {displayMode === 'time' ? renderTimeView() : renderWorkspaceView()}
      </div>

      {/* FAB */}
      <button
        type="button"
        className="tasks-scene__fab"
        onClick={() => setFabOpen(true)}
        disabled={creating}
        aria-label={t('sessions.newSession')}
      >
        <span className="tasks-scene__fab-dot" aria-hidden="true" />
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      {/* New session — step 1: pick agent type */}
      <BottomSheet open={fabOpen} onClose={() => setFabOpen(false)} title={t('sessions.newSession')}>
        {NEW_SESSION_AGENT_TYPES.map((option, idx) => (
          <React.Fragment key={option.type}>
            {idx > 0 && <HairlineDivider />}
            <button
              type="button"
              className="tasks-scene__sheet-item tasks-scene__sheet-item--agent"
              onClick={() => void handlePickAgentType(option)}
              disabled={creating}
            >
              <span
                className="tasks-scene__sheet-item-badge"
                style={{ background: option.badgeColor }}
                aria-hidden="true"
              >
                {option.badge}
              </span>
              <span className="tasks-scene__sheet-item-body">
                <span className="tasks-scene__sheet-item-label">{t(option.labelKey)}</span>
                <span className="tasks-scene__sheet-item-desc">{t(option.descKey)}</span>
              </span>
            </button>
          </React.Fragment>
        ))}
      </BottomSheet>

      {/* New session — step 2: pick workspace */}
      <BottomSheet
        open={wsPickerOpen}
        onClose={() => { setWsPickerOpen(false); setPendingOption(null); }}
        title={language === 'zh-CN' ? '选择工作区' : 'Select Workspace'}
      >
        {recentWorkspaces.length === 0 ? (
          <div className="tasks-scene__ws-empty">
            {language === 'zh-CN' ? '没有可用的工作区' : 'No workspaces available'}
          </div>
        ) : recentWorkspaces.map((ws, idx) => (
          <React.Fragment key={ws.path}>
            {idx > 0 && <HairlineDivider />}
            <button
              type="button"
              className="tasks-scene__sheet-item"
              onClick={() => void handlePickWorkspace(ws.path)}
              disabled={creating}
            >
              <span className="tasks-scene__sheet-item-label">{ws.name}</span>
              <span className="tasks-scene__sheet-item-desc tasks-scene__sheet-item-desc--path">{ws.path}</span>
            </button>
          </React.Fragment>
        ))}
      </BottomSheet>

      {/* Filter sheet */}
      <BottomSheet open={filterOpen} onClose={() => setFilterOpen(false)} title={language === 'zh-CN' ? '筛选' : 'Filter'}>
        <div className="tasks-scene__filter-section">
          <div className="tasks-scene__filter-label">
            <EyebrowLabel>{t('sessions.workspace')}</EyebrowLabel>
          </div>
          <div className="tasks-scene__filter-chips">
            <button
              type="button"
              className={`tasks-scene__chip${filterWorkspace === ALL ? ' is-active' : ''}`}
              onClick={() => setFilterWorkspace(ALL)}
            >
              {language === 'zh-CN' ? '全部' : 'All'}
            </button>
            {Object.entries(workspaces)
              .filter(([key]) => key !== '__none__')
              .map(([path, name]) => (
                <button
                  key={path}
                  type="button"
                  className={`tasks-scene__chip${filterWorkspace === path ? ' is-active' : ''}`}
                  onClick={() => setFilterWorkspace(path)}
                >
                  {name}
                </button>
              ))}
          </div>
        </div>
        <HairlineDivider />
        <div className="tasks-scene__filter-section">
          <div className="tasks-scene__filter-label">
            <EyebrowLabel>{language === 'zh-CN' ? 'Agent 类型' : 'Agent Type'}</EyebrowLabel>
          </div>
          <div className="tasks-scene__filter-chips">
            <button
              type="button"
              className={`tasks-scene__chip${filterAgentType === ALL ? ' is-active' : ''}`}
              onClick={() => setFilterAgentType(ALL)}
            >
              {language === 'zh-CN' ? '全部' : 'All'}
            </button>
            {agentTypes.map((type) => (
              <button
                key={type}
                type="button"
                className={`tasks-scene__chip${filterAgentType === type ? ' is-active' : ''}`}
                onClick={() => setFilterAgentType(type)}
              >
                {agentLabel(type)}
              </button>
            ))}
          </div>
        </div>
        {hasFilters && (
          <>
            <HairlineDivider />
            <button
              type="button"
              className="tasks-scene__sheet-item tasks-scene__sheet-item--danger"
              onClick={() => { setFilterWorkspace(ALL); setFilterAgentType(ALL); setFilterOpen(false); }}
            >
              <span className="tasks-scene__sheet-item-label">
                {language === 'zh-CN' ? '清除筛选' : 'Clear Filters'}
              </span>
            </button>
          </>
        )}
      </BottomSheet>

      {/* Long-press action sheet */}
      <BottomSheet open={actionSheet} onClose={() => setActionSheet(false)}>
        <button
          type="button"
          className="tasks-scene__sheet-item tasks-scene__sheet-item--danger"
          onClick={() => void handleDelete()}
        >
          <span className="tasks-scene__sheet-item-label">{t('sessions.deleteSession')}</span>
        </button>
        <HairlineDivider />
        <button type="button" className="tasks-scene__sheet-item" onClick={() => setActionSheet(false)}>
          <span className="tasks-scene__sheet-item-label">{t('common.cancel')}</span>
        </button>
      </BottomSheet>
    </div>
  );
};

export default TasksScene;
