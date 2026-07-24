/**
 * Compact display for SessionHistory (read another session's transcript, analogous to Read file).
 * Resolves the target session display name from:
 * 1) FlowChatStore (in-memory title)
 *
 * useSyncExternalStore getSnapshot must return stable string primitives (Object.is equality).
 */

import React, { useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { ToolCardProps } from '../types/flow-chat';
import { DefaultToolCardTemplate } from './templates';
import { FlowChatStore } from '../store/FlowChatStore';
import type { FlowChatState } from '../types/flow-chat';
import { getToolViewState } from '../runtime/toolViewState';

/** Internal sentinels — must not collide with real session titles. */
const SNAP_PARSE = '\u2060bf:sessionHistory:parse\u2060';
const SNAP_MISS = '\u2060bf:sessionHistory:missing\u2060';
const SNAP_UNTITLED = '\u2060bf:sessionHistory:untitled\u2060';

function readSessionNameSnapshotStringFromState(
  targetSessionId: string | undefined,
  state: FlowChatState
): string {
  if (!targetSessionId?.trim()) {
    return SNAP_PARSE;
  }
  const session = state.sessions.get(targetSessionId.trim());
  if (!session) {
    return SNAP_MISS;
  }
  const title = session.title?.trim();
  if (!title) {
    return SNAP_UNTITLED;
  }
  return title;
}

function readSessionNameSnapshotString(targetSessionId: string | undefined): string {
  return readSessionNameSnapshotStringFromState(targetSessionId, FlowChatStore.getInstance().getState());
}

export const SessionHistoryDisplay: React.FC<ToolCardProps> = React.memo(({
  toolItem,
  sessionId: _hostSessionId,
}) => {
  const { t } = useTranslation('flow-chat');
  const { toolCall, status } = toolItem;
  const viewState = useMemo(() => getToolViewState(toolItem), [toolItem]);
  const isCompleted = viewState.phase === 'result';

  const targetSessionId = useMemo(() => {
    const sid = toolCall?.input?.session_id ?? toolCall?.input?.sessionId;
    return typeof sid === 'string' && sid.trim() ? sid.trim() : undefined;
  }, [toolCall?.input]);

  const nameSnap = useSyncExternalStore(
    (onChange) => FlowChatStore.getInstance().subscribeSelector(
      state => readSessionNameSnapshotStringFromState(targetSessionId, state),
      () => onChange(),
    ),
    () => readSessionNameSnapshotString(targetSessionId),
    () => readSessionNameSnapshotString(targetSessionId)
  );

  const displaySessionName = useMemo(() => {
    if (nameSnap === SNAP_PARSE) {
      return t('toolCards.sessionHistory.parsingParams');
    }
    if (nameSnap !== SNAP_PARSE && nameSnap !== SNAP_MISS && nameSnap !== SNAP_UNTITLED) {
      return nameSnap;
    }
    if (nameSnap === SNAP_UNTITLED) {
      return t('session.untitled');
    }
    if (nameSnap === SNAP_MISS) {
      return t('toolCards.sessionHistory.fallbackDisplayName');
    }
    return t('session.untitled');
  }, [nameSnap, t]);

  const renderContent = () => {
    if (nameSnap === SNAP_PARSE) {
      return displaySessionName;
    }
    if (isCompleted) {
      return t('toolCards.sessionHistory.lineCompleted', { name: displaySessionName });
    }
    if (viewState.phase === 'running' || viewState.phase === 'receiving_input') {
      return (
        <>
          {t('toolCards.sessionHistory.lineRunning', { name: displaySessionName })}
          ...
        </>
      );
    }
    return t('toolCards.sessionHistory.linePending', { name: displaySessionName });
  };

  if (viewState.phase === 'error') {
    return null;
  }

  return (
    <DefaultToolCardTemplate
      toolId={toolItem.id ?? toolCall?.id}
      toolName={toolItem.toolName}
      status={status}
      className="session-history-card"
      summary={renderContent()}
    />
  );
});
