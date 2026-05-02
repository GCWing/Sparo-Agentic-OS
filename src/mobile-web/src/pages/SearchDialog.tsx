import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { RemoteSessionManager } from '../services/RemoteSessionManager';
import { useMobileStore } from '../services/store';
import EyebrowLabel from '../components/EyebrowLabel';
import HairlineDivider from '../components/HairlineDivider';
import './SearchDialog.scss';

interface SearchDialogProps {
  sessionMgr: RemoteSessionManager;
  onSelectSession: (sessionId: string, sessionName?: string, sessionMode?: string) => void;
}

function truncate(str: string, max: number): string {
  if (!str || str.length <= max) return str;
  return `${str.slice(0, max)}…`;
}

const SearchDialog: React.FC<SearchDialogProps> = ({ sessionMgr: _sessionMgr, onSelectSession }) => {
  const { t } = useI18n();
  const { sessions, currentWorkspace } = useMobileStore();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const workspaceNames = useMemo(() => {
    const map: Record<string, string> = {};
    if (currentWorkspace?.path && currentWorkspace.project_name) {
      map[currentWorkspace.path] = currentWorkspace.project_name;
    }
    return map;
  }, [currentWorkspace]);

  const matchedSessions = useMemo(() => {
    if (!query.trim()) return sessions.slice(0, 20);
    const q = query.toLowerCase();
    return sessions.filter((s) =>
      s.name?.toLowerCase().includes(q)
      || s.agent_type?.toLowerCase().includes(q)
      || workspaceNames[s.workspace_path ?? '']?.toLowerCase().includes(q)
    ).slice(0, 20);
  }, [query, sessions, workspaceNames]);

  const handleSelect = useCallback((sessionId: string, name?: string, agentType?: string) => {
    onSelectSession(sessionId, name, agentType);
  }, [onSelectSession]);

  return (
    <div className="search-dialog">
      {/* Search input */}
      <div className="search-dialog__input-wrap">
        <svg className="search-dialog__input-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          className="search-dialog__input"
          placeholder={t('search.placeholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
        />
        {query && (
          <button
            type="button"
            className="search-dialog__clear"
            onClick={() => { setQuery(''); inputRef.current?.focus(); }}
            aria-label="Clear"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      <HairlineDivider />

      <div className="search-dialog__results">
        {matchedSessions.length === 0 && query.trim() ? (
          <div className="search-dialog__empty">{t('search.noResults')}</div>
        ) : (
          <>
            {matchedSessions.length > 0 && (
              <div className="search-dialog__section-head">
                <EyebrowLabel>{t('search.sessions')}</EyebrowLabel>
              </div>
            )}
            {matchedSessions.map((s, idx) => (
              <React.Fragment key={s.session_id}>
                <button
                  type="button"
                  className="search-dialog__row"
                  onClick={() => handleSelect(s.session_id, s.name, s.agent_type)}
                >
                  <span className="search-dialog__row-num">{String(idx + 1).padStart(2, '0')}</span>
                  <div className="search-dialog__row-body">
                    <span className="search-dialog__row-name">
                      {truncate(s.name || t('sessions.untitledSession'), 40)}
                    </span>
                    <span className="search-dialog__row-meta">{s.agent_type}</span>
                  </div>
                </button>
                <HairlineDivider />
              </React.Fragment>
            ))}
          </>
        )}
      </div>
    </div>
  );
};

export default SearchDialog;
