/**
 * Compact display for SessionHistory (read another session's transcript, analogous to Read file).
 * Resolves the target session display name from:
 * 1) FlowChatStore (in-memory title)
 * 2) Persisted metadata on disk (list_sessions / metadata.json) via sessionAPI.loadSessionMetadata
 *
 * useSyncExternalStore getSnapshot must return stable string primitives (Object.is equality).
 */

import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { ToolCardProps } from '../types/flow-chat';
import { CompactToolTemplate } from './templates';
import { FlowChatStore } from '../store/FlowChatStore';
import { sessionAPI } from '@/infrastructure/api';

/** Internal sentinels — must not collide with real session titles. */
const SNAP_PARSE = '\u2060bf:sessionHistory:parse\u2060';
const SNAP_MISS = '\u2060bf:sessionHistory:missing\u2060';
const SNAP_UNTITLED = '\u2060bf:sessionHistory:untitled\u2060';

function readSessionNameSnapshotString(targetSessionId: string | undefined): string {
  if (!targetSessionId?.trim()) {
    return SNAP_PARSE;
  }
  const session = FlowChatStore.getInstance().getState().sessions.get(targetSessionId.trim());
  if (!session) {
    return SNAP_MISS;
  }
  const title = session.title?.trim();
  if (!title) {
    return SNAP_UNTITLED;
  }
  return title;
}

export const SessionHistoryDisplay: React.FC<ToolCardProps> = React.memo(({
  toolItem,
  sessionId: _hostSessionId,
}) => {
  const { t } = useTranslation('flow-chat');
  const { toolCall, status } = toolItem;

  const targetSessionId = useMemo(() => {
    const sid = toolCall?.input?.session_id ?? toolCall?.input?.sessionId;
    return typeof sid === 'string' && sid.trim() ? sid.trim() : undefined;
  }, [toolCall?.input]);

  const toolWorkspace = useMemo(() => {
    const w = toolCall?.input?.workspace;
    return typeof w === 'string' && w.trim() ? w.trim() : undefined;
  }, [toolCall?.input]);

  const nameSnap = useSyncExternalStore(
    (onChange) => FlowChatStore.getInstance().subscribe(onChange),
    () => readSessionNameSnapshotString(targetSessionId),
    () => readSessionNameSnapshotString(targetSessionId)
  );

  const [persistedName, setPersistedName] = useState<string | null>(null);

  useEffect(() => {
    setPersistedName(null);
  }, [targetSessionId, toolWorkspace]);

  useEffect(() => {
    if (!targetSessionId || !toolWorkspace) {
      return;
    }
    if (nameSnap !== SNAP_MISS && nameSnap !== SNAP_UNTITLED) {
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const meta = await sessionAPI.loadSessionMetadata(targetSessionId, toolWorkspace);
        if (!cancelled && meta?.sessionName?.trim()) {
          setPersistedName(meta.sessionName.trim());
        }
      } catch {
        // Metadata unavailable (e.g. path mismatch); keep sentinel-based label.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [targetSessionId, toolWorkspace, nameSnap]);

  const displaySessionName = useMemo(() => {
    if (nameSnap === SNAP_PARSE) {
      return t('toolCards.sessionHistory.parsingParams');
    }
    if (nameSnap !== SNAP_PARSE && nameSnap !== SNAP_MISS && nameSnap !== SNAP_UNTITLED) {
      return nameSnap;
    }
    if (persistedName) {
      return persistedName;
    }
    if (nameSnap === SNAP_UNTITLED) {
      return t('session.untitled');
    }
    if (nameSnap === SNAP_MISS) {
      return t('toolCards.sessionHistory.fallbackDisplayName');
    }
    return t('session.untitled');
  }, [nameSnap, persistedName, t]);

  const renderContent = () => {
    if (nameSnap === SNAP_PARSE) {
      return displaySessionName;
    }
    if (status === 'completed') {
      return t('toolCards.sessionHistory.lineCompleted', { name: displaySessionName });
    }
    if (status === 'running' || status === 'streaming') {
      return (
        <>
          {t('toolCards.sessionHistory.lineRunning', { name: displaySessionName })}
          ...
        </>
      );
    }
    return t('toolCards.sessionHistory.linePending', { name: displaySessionName });
  };

  if (status === 'error') {
    return null;
  }

  return (
    <CompactToolTemplate
      toolId={toolItem.id ?? toolCall?.id}
      toolName={toolItem.toolName}
      status={status}
      className="session-history-card"
      summary={renderContent()}
    />
  );
});
