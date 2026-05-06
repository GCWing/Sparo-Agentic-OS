import React, { useEffect, useRef, useCallback, useState } from 'react';
import LanguageToggleButton from '../components/LanguageToggleButton';
import { useI18n } from '../i18n';
import { RemoteSessionManager, type RecentWorkspaceEntry } from '../services/RemoteSessionManager';
import { useMobileStore } from '../services/store';
import { useTheme } from '../theme';
import logoMarkDarkUi from '../assets/logo-dark-transparent.png';
import logoMarkLightUi from '../assets/logo-light-transparent.png';

const PAGE_SIZE = 30;

interface SessionListPageProps {
  sessionMgr: RemoteSessionManager;
  onSelectSession: (sessionId: string, sessionName?: string, isNew?: boolean) => void;
}

function formatTime(
  unixStr: string,
  language: string,
  t: (key: string, params?: Record<string, string | number>) => string,
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

function agentLabel(agentType: string, t: (key: string) => string): string {
  switch (agentType) {
    case 'code':
    case 'agentic':
      return t('sessions.agentCode');
    case 'cowork':
    case 'Cowork':
      return t('sessions.agentCowork');
    default:
      return agentType || t('sessions.agentDefault');
  }
}

function isCoworkAgent(agentType: string): boolean {
  return agentType === 'cowork' || agentType === 'Cowork';
}

function pickFirstWorkspace(list: RecentWorkspaceEntry[]): RecentWorkspaceEntry | undefined {
  return list[0];
}

function truncateMiddle(str: string, maxLen: number): string {
  if (!str || str.length <= maxLen) return str;
  const keep = maxLen - 3;
  const head = Math.ceil(keep * 0.6);
  const tail = keep - head;
  return str.slice(0, head) + '...' + str.slice(-tail);
}

function SessionTypeIcon({ agentType }: { agentType: string }) {
  if (isCoworkAgent(agentType)) {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    );
  }

  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

const WorkspaceIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2" />
  </svg>
);

const ThemeToggleIcon: React.FC<{ isDark: boolean }> = ({ isDark }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    {isDark ? (
      <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM3 8a5 5 0 0 1 5-5v10a5 5 0 0 1-5-5Z" fill="currentColor" />
    ) : (
      <path d="M8 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0v-1A.5.5 0 0 1 8 1Zm0 11a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0v-1A.5.5 0 0 1 8 12Zm7-4a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1 0-1h1A.5.5 0 0 1 15 8ZM3 8a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1 0-1h1A.5.5 0 0 1 3 8Zm9.95-3.54a.5.5 0 0 1 0 .71l-.71.7a.5.5 0 1 1-.7-.7l.7-.71a.5.5 0 0 1 .71 0ZM5.46 11.24a.5.5 0 0 1 0 .71l-.7.71a.5.5 0 0 1-.71-.71l.7-.71a.5.5 0 0 1 .71 0Zm7.08 1.42a.5.5 0 0 1-.7 0l-.71-.71a.5.5 0 0 1 .7-.7l.71.7a.5.5 0 0 1 0 .71ZM5.46 4.76a.5.5 0 0 1-.71 0l-.71-.7a.5.5 0 0 1 .71-.71l.7.7a.5.5 0 0 1 0 .71ZM8 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z" fill="currentColor" />
    )}
  </svg>
);

const SessionListPage: React.FC<SessionListPageProps> = ({ sessionMgr, onSelectSession }) => {
  const { t, language } = useI18n();
  const {
    sessions,
    setSessions,
    appendSessions,
    setError,
    selectedWorkspace,
    setSelectedWorkspace,
    authenticatedUserId,
  } = useMobileStore();
  const { isDark, toggleTheme } = useTheme();
  const logoSrc = isDark ? logoMarkDarkUi : logoMarkLightUi;
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [workspaceList, setWorkspaceList] = useState<Array<{ path: string; name: string; last_opened: string }>>([]);
  const [showWorkspacePicker, setShowWorkspacePicker] = useState(false);

  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const offsetRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);
  const isPulling = useRef(false);

  const loadFirstPage = useCallback(async (workspacePath: string | undefined) => {
    setLoading(true);
    offsetRef.current = 0;
    try {
      const resp = await sessionMgr.listSessions(workspacePath, PAGE_SIZE, 0);
      setSessions(resp.sessions);
      setHasMore(resp.has_more);
      offsetRef.current = resp.sessions.length;
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [sessionMgr, setSessions, setError]);

  const loadWorkspaceList = useCallback(async () => {
    try {
      const workspaces = await sessionMgr.listRecentWorkspaces();
      setWorkspaceList(workspaces);
    } catch (e: any) {
      setError(e.message);
    }
  }, [sessionMgr, setError]);

  const handleSelectWorkspace = useCallback(async (workspace: { path: string; name: string }) => {
    try {
      const result = await sessionMgr.setWorkspace(workspace.path);
      if (result.success) {
        const nextPath = result.path || workspace.path;
        setSelectedWorkspace({
          has_workspace: true,
          path: nextPath,
          project_name: result.project_name || workspace.name,
        });
        setShowWorkspacePicker(false);
        await loadFirstPage(nextPath);
      } else {
        setError(result.error || 'Failed to set workspace');
      }
    } catch (e: any) {
      setError(e.message);
    }
  }, [sessionMgr, setSelectedWorkspace, setError, loadFirstPage]);

  const trySelectFirstWorkspace = useCallback(async (): Promise<boolean> => {
    try {
      const list = await sessionMgr.listRecentWorkspaces();
      const candidate = pickFirstWorkspace(list);
      if (!candidate) return false;
      const result = await sessionMgr.setWorkspace(candidate.path);
      if (result.success) {
        const nextPath = result.path || candidate.path;
        setSelectedWorkspace({
          has_workspace: true,
          path: nextPath,
          project_name: result.project_name || candidate.name,
        });
        await loadFirstPage(nextPath);
        return true;
      }
      setError(result.error || t('workspace.failedToSetWorkspace'));
      return false;
    } catch (e: any) {
      setError(e.message);
      return false;
    }
  }, [sessionMgr, setSelectedWorkspace, setError, loadFirstPage, t]);

  const loadNextPage = useCallback(async (workspacePath: string | undefined) => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const resp = await sessionMgr.listSessions(workspacePath, PAGE_SIZE, offsetRef.current);
      appendSessions(resp.sessions);
      setHasMore(resp.has_more);
      offsetRef.current += resp.sessions.length;
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingMore(false);
    }
  }, [sessionMgr, appendSessions, setError, loadingMore, hasMore]);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        const info = await sessionMgr.getWorkspaceInfo();
        if (cancelled) return;
        const ws = info.has_workspace ? info : null;
        setSelectedWorkspace(ws);
        if (ws?.path) {
          await loadFirstPage(ws.path);
        } else {
          await trySelectFirstWorkspace();
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      }
    };
    void init();
    return () => {
      cancelled = true;
    };
  }, [loadFirstPage, sessionMgr, setSelectedWorkspace, setError, trySelectFirstWorkspace]);

  const refreshData = useCallback(async () => {
    try {
      const info = await sessionMgr.getWorkspaceInfo();
      const ws = info.has_workspace ? info : null;
      setSelectedWorkspace(ws);
      const resp = await sessionMgr.listSessions(ws?.path, PAGE_SIZE, 0);
      setSessions(resp.sessions);
      setHasMore(resp.has_more);
      offsetRef.current = resp.sessions.length;
    } catch {
      // Ignore transient refresh failures.
    }
  }, [sessionMgr, setSessions, setSelectedWorkspace]);

  useEffect(() => {
    const poll = setInterval(refreshData, 10000);
    return () => clearInterval(poll);
  }, [refreshData]);

  const PULL_THRESHOLD = 60;

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const el = listRef.current;
    if (!el || el.scrollTop > 0 || refreshing) return;
    touchStartY.current = e.touches[0].clientY;
    isPulling.current = true;
  }, [refreshing]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isPulling.current) return;
    const delta = e.touches[0].clientY - touchStartY.current;
    if (delta > 0) {
      setPullDistance(Math.min(delta * 0.5, 80));
    } else {
      isPulling.current = false;
      setPullDistance(0);
    }
  }, []);

  const handleTouchEnd = useCallback(async () => {
    if (!isPulling.current) return;
    isPulling.current = false;
    if (pullDistance >= PULL_THRESHOLD) {
      setRefreshing(true);
      setPullDistance(PULL_THRESHOLD);
      await refreshData();
      setRefreshing(false);
    }
    setPullDistance(0);
  }, [pullDistance, refreshData]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 150) {
      loadNextPage(selectedWorkspace?.path);
    }
  }, [selectedWorkspace?.path, loadNextPage]);

  const handleCreate = useCallback(async (agentType: string) => {
    if (creating) return;
    setCreating(true);
    try {
      const workspacePath = selectedWorkspace?.path;
      const id = await sessionMgr.createSession(agentType, undefined, workspacePath);
      await loadFirstPage(workspacePath);
      const label = isCoworkAgent(agentType)
        ? t('sessions.remoteCoworkSession')
        : t('sessions.remoteCodeSession');
      onSelectSession(id, label, true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }, [creating, selectedWorkspace?.path, loadFirstPage, onSelectSession, sessionMgr, setError, t]);

  const workspaceDisplayName = selectedWorkspace?.project_name || t('sessions.noWorkspaceSelected');

  return (
    <div className="session-list">
      <div className="session-list__header">
        <div className="session-list__header-brand">
          <img src={logoSrc} alt={t('common.appName')} className="session-list__logo" />
          <div className="session-list__header-copy">
            <h1>{t('common.appName')}</h1>
            {authenticatedUserId && (
              <span className="session-list__header-user-id">{authenticatedUserId}</span>
            )}
          </div>
        </div>
        <div className="session-list__header-actions">
          <LanguageToggleButton />
          <button className="session-list__theme-btn" onClick={toggleTheme} aria-label={t('common.toggleTheme')}>
            <ThemeToggleIcon isDark={isDark} />
          </button>
        </div>
      </div>

      <div
        className="session-list__items"
        ref={listRef}
        onScroll={handleScroll}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {(pullDistance > 0 || refreshing) && (
          <div
            className="session-list__pull-indicator"
            style={{ height: refreshing ? PULL_THRESHOLD : pullDistance }}
          >
            <div className={`session-list__pull-spinner${refreshing || pullDistance >= PULL_THRESHOLD ? ' is-active' : ''}`}>
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                fill="none"
                style={{ transform: `rotate(${pullDistance * 4}deg)`, transition: refreshing ? 'transform 0s' : undefined }}
              >
                <path
                  d="M9 2V5M9 13V16M2 9H5M13 9H16M4.22 4.22L6.34 6.34M11.66 11.66L13.78 13.78M13.78 4.22L11.66 6.34M6.34 11.66L4.22 13.78"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          </div>
        )}

        <div
          className="session-list__workspace-bar"
          onClick={() => {
            void loadWorkspaceList();
            setShowWorkspacePicker(true);
          }}
        >
          <span className="session-list__workspace-icon">
            <WorkspaceIcon />
          </span>
          <div className="session-list__workspace-copy">
            <span className="session-list__workspace-label">{t('sessions.workspace')}</span>
            <span className="session-list__workspace-name" title={workspaceDisplayName}>{truncateMiddle(workspaceDisplayName, 24)}</span>
          </div>
          {selectedWorkspace?.git_branch && (
            <span className="session-list__workspace-branch">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="6" x2="6" y1="3" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></svg>
              {truncateMiddle(selectedWorkspace.git_branch, 20)}
            </span>
          )}
          <span className="session-list__workspace-switch" aria-label={t('sessions.switchWorkspace')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7 15 5 5 5-5" /><path d="m7 9 5-5 5 5" /></svg>
          </span>
        </div>

        {showWorkspacePicker && (
          <div className="session-list__picker-overlay" onClick={() => setShowWorkspacePicker(false)}>
            <div className="session-list__picker-modal session-list__picker-modal--workspace" onClick={e => e.stopPropagation()}>
              <div className="session-list__picker-header">
                <h3>{t('sessions.selectWorkspace')}</h3>
                <button className="session-list__picker-close" onClick={() => setShowWorkspacePicker(false)}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>
              <div className="session-list__picker-list">
                {workspaceList.length === 0 ? (
                  <div className="session-list__picker-empty">{t('sessions.noWorkspaces')}</div>
                ) : (
                  workspaceList.map((workspace, index) => (
                    <button
                      key={workspace.path || index}
                      className={`session-list__picker-item session-list__picker-item--workspace ${selectedWorkspace?.path === workspace.path ? 'is-selected' : ''}`}
                      onClick={() => void handleSelectWorkspace(workspace)}
                    >
                      <span className="session-list__picker-item-icon">
                        <WorkspaceIcon />
                      </span>
                      <span className="session-list__picker-item-name">{workspace.name}</span>
                      {selectedWorkspace?.path === workspace.path && (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        <section className="session-list__panel">
          <div className="session-list__section-head">
            <div>
              <div className="session-list__section-kicker">{t('sessions.launch')}</div>
              <div className="session-list__section-title">{t('sessions.startRemoteFlow')}</div>
            </div>
          </div>

          {selectedWorkspace ? (
            <div className="session-list__create-row">
              <button
                className="session-list__create-btn session-list__create-btn--code"
                onClick={() => void handleCreate('code')}
                disabled={creating}
              >
                <div className="session-list__create-icon">
                  <SessionTypeIcon agentType="code" />
                </div>
                <div className="session-list__create-copy">
                  <span className="session-list__create-title">{t('sessions.codeSession')}</span>
                  <span className="session-list__create-desc">{t('sessions.codeSessionDesc')}</span>
                </div>
                <span className="session-list__create-arrow">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
                </span>
              </button>
              <button
                className="session-list__create-btn session-list__create-btn--cowork"
                onClick={() => void handleCreate('cowork')}
                disabled={creating}
              >
                <div className="session-list__create-icon">
                  <SessionTypeIcon agentType="cowork" />
                </div>
                <div className="session-list__create-copy">
                  <span className="session-list__create-title">{t('sessions.coworkSession')}</span>
                  <span className="session-list__create-desc">{t('sessions.coworkSessionDesc')}</span>
                </div>
                <span className="session-list__create-arrow">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
                </span>
              </button>
            </div>
          ) : null}
        </section>

        <section className="session-list__panel session-list__panel--sessions">
          <div className="session-list__section-head">
            <div>
              <div className="session-list__section-kicker">{t('sessions.recent')}</div>
              <div className="session-list__section-title">{t('sessions.sessionHistory')}</div>
            </div>
            <div className="session-list__section-meta">{t('common.itemCount', { count: sessions.length })}</div>
          </div>

          {loading && sessions.length === 0 && (
            <div className="session-list__empty">{t('sessions.loadingSessions')}</div>
          )}
          {!loading && sessions.length === 0 && (
            <div className="session-list__empty">{t('sessions.noSessions')}</div>
          )}

          <div className="session-list__cards">
            {sessions.map((s) => (
              <div
                key={s.session_id}
                className="session-list__item"
                onClick={() => onSelectSession(s.session_id, s.name)}
              >
                <div className={`session-list__item-icon session-list__item-icon--${s.agent_type}`}>
                  <SessionTypeIcon agentType={s.agent_type} />
                </div>
                <div className="session-list__item-body">
                  <div className="session-list__item-top">
                    <div className="session-list__item-name">{s.name || t('sessions.untitledSession')}</div>
                    <span className={`session-list__agent-badge session-list__agent-badge--${s.agent_type}`}>
                      {agentLabel(s.agent_type, t)}
                    </span>
                  </div>
                  <div className="session-list__item-time">{formatTime(s.updated_at, language, t)}</div>
                </div>
              </div>
            ))}
          </div>

          {loadingMore && (
            <div className="session-list__load-more">{t('sessions.loadingMore')}</div>
          )}
        </section>
      </div>
    </div>
  );
};

export default SessionListPage;
