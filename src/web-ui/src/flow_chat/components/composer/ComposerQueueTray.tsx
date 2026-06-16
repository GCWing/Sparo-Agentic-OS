import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, CornerDownRight, FileImage, ListOrdered, Pencil, Play, Trash2, X } from 'lucide-react';
import { IconButton, Tooltip } from '@/design-system';
import { agentAPI, type QueuedDialogTurn } from '@/infrastructure/api/service-api/AgentAPI';
import { notificationService } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import { useSessionTurnQueueStore } from '../../store/sessionTurnQueueStore';

const log = createLogger('ComposerQueueTray');
const EMPTY_QUEUE: QueuedDialogTurn[] = [];

interface ComposerQueueTrayProps {
  sessionId?: string | null;
}

function queuePreview(item: QueuedDialogTurn): string {
  return item.originalUserInput?.trim() || item.userInput.trim();
}

export function ComposerQueueTray({ sessionId }: ComposerQueueTrayProps) {
  const { t } = useTranslation('flow-chat');
  const items = useSessionTurnQueueStore(state =>
    sessionId ? state.queuesBySession[sessionId] ?? EMPTY_QUEUE : EMPTY_QUEUE
  );
  const pause = useSessionTurnQueueStore(state =>
    sessionId ? state.pauseBySession[sessionId] : undefined
  );
  const refreshQueue = useSessionTurnQueueStore(state => state.refreshQueue);
  const removeTurn = useSessionTurnQueueStore(state => state.removeTurn);
  const clearPause = useSessionTurnQueueStore(state => state.clearPause);
  const [editingTurnId, setEditingTurnId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [submittingTurnId, setSubmittingTurnId] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    void refreshQueue(sessionId);
  }, [refreshQueue, sessionId]);

  const editingItem = useMemo(
    () => items.find(item => item.turnId === editingTurnId) ?? null,
    [editingTurnId, items]
  );

  const beginEdit = useCallback((item: QueuedDialogTurn) => {
    setEditingTurnId(item.turnId);
    setDraft(queuePreview(item));
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingTurnId(null);
    setDraft('');
  }, []);

  const saveEdit = useCallback(async () => {
    if (!sessionId || !editingItem) return;
    const next = draft.trim();
    if (!next) return;

    setSubmittingTurnId(editingItem.turnId);
    try {
      await agentAPI.updateQueuedDialogTurn({
        sessionId,
        turnId: editingItem.turnId,
        userInput: next,
        originalUserInput: next,
      });
      cancelEdit();
      await refreshQueue(sessionId);
    } catch (error) {
      log.error('Failed to update queued dialog turn', { sessionId, turnId: editingItem.turnId, error });
      notificationService.error(t('inputQueue.updateFailed'));
    } finally {
      setSubmittingTurnId(null);
    }
  }, [cancelEdit, draft, editingItem, refreshQueue, sessionId, t]);

  const deleteItem = useCallback(async (item: QueuedDialogTurn) => {
    if (!sessionId) return;
    setSubmittingTurnId(item.turnId);
    try {
      const deleted = await agentAPI.deleteQueuedDialogTurn(sessionId, item.turnId);
      if (deleted) {
        removeTurn(sessionId, item.turnId);
      }
      if (editingTurnId === item.turnId) {
        cancelEdit();
      }
    } catch (error) {
      log.error('Failed to delete queued dialog turn', { sessionId, turnId: item.turnId, error });
      notificationService.error(t('inputQueue.deleteFailed'));
    } finally {
      setSubmittingTurnId(null);
    }
  }, [cancelEdit, editingTurnId, removeTurn, sessionId, t]);

  const guideItem = useCallback(async (item: QueuedDialogTurn) => {
    if (!sessionId) return;
    setSubmittingTurnId(item.turnId);
    try {
      await agentAPI.guideQueuedDialogTurn(sessionId, item.turnId);
      removeTurn(sessionId, item.turnId);
      await refreshQueue(sessionId);
    } catch (error) {
      log.error('Failed to guide dialog turn', { sessionId, turnId: item.turnId, error });
      notificationService.error(t('inputQueue.guideFailed'));
    } finally {
      setSubmittingTurnId(null);
    }
    if (editingTurnId === item.turnId) {
      cancelEdit();
    }
  }, [cancelEdit, editingTurnId, refreshQueue, removeTurn, sessionId, t]);

  const resumeQueue = useCallback(async () => {
    if (!sessionId) return;
    try {
      clearPause(sessionId);
      await agentAPI.resumeQueuedDialogTurns(sessionId);
      await refreshQueue(sessionId);
    } catch (error) {
      log.error('Failed to resume queued dialog turns', { sessionId, error });
      notificationService.error(t('inputQueue.resumeFailed'));
      await refreshQueue(sessionId);
    }
  }, [clearPause, refreshQueue, sessionId, t]);

  if (!sessionId || (items.length === 0 && !pause)) {
    return null;
  }

  const isPaused = Boolean(pause);

  return (
    <section className={`sparo-chat-input__queue ${isPaused ? 'sparo-chat-input__queue--paused' : ''}`}>
      <div className="sparo-chat-input__queue-head">
        <span className="sparo-chat-input__queue-icon" aria-hidden="true">
          <ListOrdered size={14} />
        </span>
        <span className="sparo-chat-input__queue-title">
          {t('inputQueue.title', { count: items.length })}
        </span>
        {isPaused && (
          <span className="sparo-chat-input__queue-paused">
            {t(`inputQueue.pauseReasons.${pause?.reason}`, { defaultValue: t('inputQueue.pauseReasons.default') })}
          </span>
        )}
        {isPaused && items.length > 0 && (
          <button
            type="button"
            className="sparo-chat-input__queue-resume"
            onClick={resumeQueue}
          >
            <Play size={12} aria-hidden="true" />
            <span>{t('inputQueue.resume')}</span>
          </button>
        )}
      </div>

      {items.length > 0 && (
        <div className="sparo-chat-input__queue-list">
          {items.map((item, index) => {
            const isEditing = editingTurnId === item.turnId;
            const isSubmitting = submittingTurnId === item.turnId;
            const isDispatching = item.status === 'dispatching';
            return (
              <div
                key={item.turnId}
                className={`sparo-chat-input__queue-item ${isDispatching ? 'sparo-chat-input__queue-item--dispatching' : ''}`}
              >
                <span className="sparo-chat-input__queue-index">{index + 1}</span>
                {isEditing ? (
                  <form
                    className="sparo-chat-input__queue-edit"
                    onSubmit={event => {
                      event.preventDefault();
                      void saveEdit();
                    }}
                  >
                    <textarea
                      className="sparo-chat-input__queue-editor"
                      value={draft}
                      onChange={event => setDraft(event.currentTarget.value)}
                      rows={2}
                      autoFocus
                      aria-label={t('inputQueue.editAriaLabel')}
                    />
                    <div className="sparo-chat-input__queue-edit-actions">
                      <Tooltip content={t('inputQueue.saveEdit')}>
                        <IconButton
                          type="submit"
                          size="xs"
                          shape="circle"
                          disabled={isSubmitting || !draft.trim()}
                          aria-label={t('inputQueue.saveEdit')}
                        >
                          <Check size={13} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip content={t('inputQueue.cancelEdit')}>
                        <IconButton
                          type="button"
                          size="xs"
                          shape="circle"
                          variant="ghost"
                          onClick={cancelEdit}
                          aria-label={t('inputQueue.cancelEdit')}
                        >
                          <X size={13} />
                        </IconButton>
                      </Tooltip>
                    </div>
                  </form>
                ) : (
                  <>
                    <span className="sparo-chat-input__queue-preview">
                      {queuePreview(item)}
                    </span>
                    {item.hasImages && (
                      <span className="sparo-chat-input__queue-media" title={t('inputQueue.imageCount', { count: item.imageCount })}>
                        <FileImage size={13} aria-hidden="true" />
                        <span>{item.imageCount}</span>
                      </span>
                    )}
                    {isDispatching && (
                      <span className="sparo-chat-input__queue-status">
                        {t('inputQueue.dispatching')}
                      </span>
                    )}
                    {!isDispatching && (
                      <div className="sparo-chat-input__queue-actions">
                        <Tooltip content={t('inputQueue.guide')}>
                          <IconButton
                            type="button"
                            size="xs"
                            shape="circle"
                            variant="ghost"
                            onClick={() => { void guideItem(item); }}
                            disabled={isSubmitting}
                            aria-label={t('inputQueue.guide')}
                          >
                            <CornerDownRight size={13} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip content={t('inputQueue.edit')}>
                          <IconButton
                            type="button"
                            size="xs"
                            shape="circle"
                            variant="ghost"
                            onClick={() => beginEdit(item)}
                            disabled={isSubmitting}
                            aria-label={t('inputQueue.edit')}
                          >
                            <Pencil size={13} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip content={t('inputQueue.delete')}>
                          <IconButton
                            type="button"
                            size="xs"
                            shape="circle"
                            variant="ghost"
                            onClick={() => {
                              void deleteItem(item);
                            }}
                            disabled={isSubmitting}
                            aria-label={t('inputQueue.delete')}
                          >
                            <Trash2 size={13} />
                          </IconButton>
                        </Tooltip>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
