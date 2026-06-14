/**
 * User message item component.
 * Renders user input messages.
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Copy,
  Check,
  RotateCcw,
  ArrowDownToLine,
  X,
  User,
  Orbit,
  Pencil,
} from 'lucide-react';
import type { DialogTurn } from '../../types/flow-chat';
import type { TriggerSource } from '@/shared/types/session-history';
import { useFlowChatStaticContext, useFlowChatViewContext } from './FlowChatContext';
import { flowChatStore } from '../../store/FlowChatStore';
import { snapshotAPI } from '@/infrastructure/api';
import { notificationService } from '@/shared/notification-system';
import { globalEventBus } from '@/infrastructure/event-bus';
import { Badge, DotMatrixLoader, IconButton, confirmDanger } from '@/design-system';
import { ReproductionStepsBlock } from '@/shared/markdown';
import { Markdown } from '@/shared/markdown/Markdown';
import { createLogger } from '@/shared/utils/logger';
import { useMessageEditStore } from '../../store/messageEditStore';
import {
  describeUserMessageEditImpact,
  editAndRerunUserMessage,
} from '../../services/UserMessageEditService';
import { UserMessageEditComposer } from './UserMessageEditComposer';
import { incrementFlowChatCounter } from '../../performance/flowChatPerf';
import './UserMessageItem.scss';

const log = createLogger('UserMessageItem');

/** Returns true when the turn was triggered by a non-human source. */
function isSystemTrigger(triggerSource: TriggerSource | undefined): boolean {
  return !!triggerSource && triggerSource !== 'desktop_ui';
}

/** Maps a TriggerSource to a CSS modifier suffix. */
function triggerSourceModifier(triggerSource: TriggerSource | undefined): string {
  switch (triggerSource) {
    case 'agent_session': return 'agent-session';
    case 'scheduled_job': return 'scheduled-job';
    case 'bot': return 'bot';
    case 'cli': return 'cli';
    case 'desktop_api':
    case 'remote_relay': return 'remote';
    default: return '';
  }
}

/** Maps a TriggerSource to a tooltip label for system-triggered messages. */
function triggerSourceLabel(triggerSource: TriggerSource | undefined): string {
  switch (triggerSource) {
    case 'agent_session': return 'Agentic OS';
    case 'scheduled_job': return 'Scheduled';
    case 'bot': return 'Bot';
    case 'cli': return 'CLI';
    case 'desktop_api': return 'API';
    case 'remote_relay': return 'Remote';
    default: return 'System';
  }
}


interface UserMessageItemProps {
  message: DialogTurn['userMessage'];
  turnId: string;
  turnIndex: number;
  turnStatus: DialogTurn['status'];
  turnStartMs: number;
  sessionStartMs: number;
}

function formatRoundTimestamp(locale: string, ms: number): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(ms);
  } catch {
    return new Date(ms).toLocaleString();
  }
}

/** Splits text into segments and wraps matching parts with <mark>. */
function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const q = query.trim();
  const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  if (parts.length <= 1) return text;
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === q.toLowerCase() ? (
          <mark key={i} className="user-message-item__search-highlight">{part}</mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

export const UserMessageItem = React.memo<UserMessageItemProps>(
  ({ message, turnId, turnIndex, turnStatus, turnStartMs, sessionStartMs }) => {
    incrementFlowChatCounter('render.userMessageItem');
    const { t, i18n } = useTranslation('flow-chat');
    const { sessionId } = useFlowChatStaticContext();
    const { searchQuery } = useFlowChatViewContext();
    const [copied, setCopied] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const [isRollingBack, setIsRollingBack] = useState(false);
    const [lightboxImage, setLightboxImage] = useState<string | null>(null);
    const [showEditAttention, setShowEditAttention] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const editAttentionRafRef = useRef<number | null>(null);
    const editAttentionTimeoutRef = useRef<number | null>(null);
    const messageContent = typeof message?.content === 'string' ? message.content : String(message?.content || '');
    const messageImages = useMemo(() => message?.images ?? [], [message?.images]);

    const roundMarkerText = useMemo(() => {
      const locale = i18n.language || undefined;
      if (turnIndex === 0) {
        return t('message.sessionStartMarker', {
          time: formatRoundTimestamp(locale ?? 'en-US', sessionStartMs),
        });
      }
      return formatRoundTimestamp(locale ?? 'en-US', turnStartMs);
    }, [turnIndex, sessionStartMs, turnStartMs, t, i18n.language]);

    const roundMarkerIso = useMemo(() => {
      const ms = turnIndex === 0 ? sessionStartMs : turnStartMs;
      return new Date(ms).toISOString();
    }, [turnIndex, sessionStartMs, turnStartMs]);
    const isFailed = turnStatus === 'error';
    const isSystem = isSystemTrigger(message?.triggerSource);
    const canRollback = !!sessionId && turnIndex >= 0 && !isRollingBack && !isSystem;
    const editSessionId = sessionId ?? '';
    const editKey = useMemo(() => ({ sessionId: editSessionId, turnId }), [editSessionId, turnId]);
    const editStore = useMessageEditStore();
    const isEditing = editStore.isActive(editKey);
    const editDraft = editStore.getDraft(editKey) ?? '';
    const isSubmittingEdit = editStore.isSubmitting(editKey);

    // For agent_session triggered messages, look up the source session's name and agent type.
    const sourceSessionInfo = useMemo(() => {
      if (!isSystem) return null;
      const sourceSessionId = message?.metadata?.sourceSessionId as string | undefined;
      if (!sourceSessionId) return null;
      const session = flowChatStore.getState().sessions.get(sourceSessionId);
      if (!session) return null;
      return {
        sessionName: session.title || sourceSessionId.slice(0, 8),
        agentType: session.config?.agentType || session.descriptor.agentPolicy.activeAgentId,
      };
    }, [isSystem, message?.metadata?.sourceSessionId]);

    const { displayText, reproductionSteps } = useMemo(() => {
      const reproductionRegex = /<reproduction_steps>([\s\S]*?)<\/reproduction_steps\s*>?/g;
      const reproductionMatch = reproductionRegex.exec(messageContent);
      const reproduction = reproductionMatch ? reproductionMatch[1].trim() : null;

      let cleaned = messageContent.replace(reproductionRegex, '').trim();

      // Strip [Image: ...] context lines when images are shown as thumbnails.
      if (messageImages.length > 0) {
        cleaned = cleaned
          .replace(/\[Image:.*?\]\n(?:Path:.*?\n|Image ID:.*?\n)?/g, '')
          .trim();
      }

      return { displayText: cleaned, reproductionSteps: reproduction };
    }, [messageContent, messageImages]);

    /** Human user row: wrap preview in typographic double quotes. */
    const quotedDisplayText = useMemo(
      () => `\u201c${displayText}\u201d`,
      [displayText],
    );
    const editInitialContent = useMemo(
      () => displayText || messageContent,
      [displayText, messageContent],
    );
    const isEditDirty = editDraft !== editInitialContent;
    const isTruncated = displayText.length > 120;

    // Copy the user message.
    const handleCopy = useCallback(async (e: React.MouseEvent) => {
      e.stopPropagation(); // Prevent toggle via bubbling.
      try {
        await navigator.clipboard.writeText(messageContent);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (error) {
        log.error('Failed to copy', error);
      }
    }, [messageContent]);

    const handleRollback = useCallback(async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!canRollback || !sessionId) return;

      const index = turnIndex + 1;
      const confirmed = await confirmDanger(
        t('message.rollbackDialogTitle', { index }),
        (
          <>
            <p className="confirm-dialog__message-intro">{t('message.rollbackDialogIntro')}</p>
            <ul className="confirm-dialog__bullet-list">
              <li>{t('message.rollbackDialogBulletFiles')}</li>
              <li>{t('message.rollbackDialogBulletHistory')}</li>
            </ul>
          </>
        )
      );
      if (!confirmed) return;

      setIsRollingBack(true);
      try {
        const restoredFiles = await snapshotAPI.rollbackToTurn(sessionId, turnIndex, true);

        // 1) Truncate local dialog turns from this index.
        flowChatStore.truncateDialogTurnsFrom(sessionId, turnIndex);

        // 2) Refresh file tree and open editors.
        const { globalEventBus } = await import('@/infrastructure/event-bus');
        globalEventBus.emit('file-tree:refresh');
        restoredFiles.forEach(filePath => {
          globalEventBus.emit('editor:file-changed', { filePath });
        });

        // 3) Restore the original user input back into the chat input box,
        //    but only when the input is empty to avoid clobbering pending edits.
        if (messageContent.trim().length > 0) {
          globalEventBus.emit('fill-chat-input', {
            content: messageContent,
            onlyIfEmpty: true,
          });
        }

        notificationService.success(t('message.rollbackSuccess'));
      } catch (error) {
        log.error('Rollback failed', error);
        notificationService.error(`${t('message.rollbackFailed')}: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setIsRollingBack(false);
      }
    }, [canRollback, sessionId, t, turnIndex, messageContent]);

    const handleBeginEdit = useCallback((e: React.MouseEvent) => {
      e.stopPropagation();
      if (!sessionId || isSystem) return;
      editStore.beginEdit(editKey, editInitialContent);
    }, [editInitialContent, editKey, editStore, isSystem, sessionId]);

    const handleCancelEdit = useCallback(() => {
      editStore.cancelEdit(editKey);
    }, [editKey, editStore]);

    const handleEditDraftChange = useCallback((value: string) => {
      editStore.setDraft(editKey, value);
    }, [editKey, editStore]);

    const triggerEditAttention = useCallback(() => {
      if (editAttentionRafRef.current !== null) {
        window.cancelAnimationFrame(editAttentionRafRef.current);
        editAttentionRafRef.current = null;
      }
      if (editAttentionTimeoutRef.current !== null) {
        window.clearTimeout(editAttentionTimeoutRef.current);
        editAttentionTimeoutRef.current = null;
      }

      setShowEditAttention(false);
      editAttentionRafRef.current = window.requestAnimationFrame(() => {
        editAttentionRafRef.current = null;
        setShowEditAttention(true);
        editAttentionTimeoutRef.current = window.setTimeout(() => {
          editAttentionTimeoutRef.current = null;
          setShowEditAttention(false);
        }, 520);
      });
    }, []);

    const handleSubmitEdit = useCallback(async () => {
      if (!sessionId || isSubmittingEdit) return;
      const nextContent = (editStore.getDraft(editKey) ?? '').trim();
      if (!nextContent) return;

      try {
        const impact = describeUserMessageEditImpact(sessionId, turnId);
        const turnNumber = impact.turnIndex + 1;
        const needsConfirmation = impact.willCancelRunningTurn || !impact.isLatestTurn;

        if (needsConfirmation) {
          const confirmed = await confirmDanger(
            impact.willCancelRunningTurn
              ? t('message.editBusyDialogTitle', { index: turnNumber })
              : t('message.editHistoryDialogTitle', { index: turnNumber }),
            (
              <>
                <p className="confirm-dialog__message-intro">
                  {impact.willCancelRunningTurn
                    ? t('message.editBusyDialogIntro')
                    : t('message.editHistoryDialogIntro')}
                </p>
                <ul className="confirm-dialog__bullet-list">
                  {impact.willCancelRunningTurn && (
                    <li>{t('message.editDialogBulletStopRunning')}</li>
                  )}
                  <li>{t('message.editDialogBulletFiles')}</li>
                  <li>{t('message.editDialogBulletHistory')}</li>
                  <li>{t('message.editDialogBulletRerun')}</li>
                </ul>
              </>
            )
          );

          if (!confirmed) return;
        }

        editStore.setSubmitting(editKey, true);
        await editAndRerunUserMessage({
          sessionId,
          turnId,
          nextContent,
          imageDisplayData: messageImages,
        });
        editStore.cancelEdit(editKey);
        notificationService.success(t('message.editSuccess'));
      } catch (error) {
        log.error('Message edit failed', { sessionId, turnId, error });
      } finally {
        editStore.setSubmitting(editKey, false);
      }
    }, [editKey, editStore, isSubmittingEdit, messageImages, sessionId, t, turnId]);
    
    const handleToggleExpand = useCallback(() => {
      if (!isTruncated && !expanded) return;
      setExpanded(prev => !prev);
    }, [isTruncated, expanded]);
    
    // Fill content into the input (failed state only).
    const handleFillToInput = useCallback((e: React.MouseEvent) => {
      e.stopPropagation();
      globalEventBus.emit('fill-chat-input', {
        content: messageContent
      });
    }, [messageContent]);
    
    // Collapse when clicking outside.
    useEffect(() => {
      if (!expanded) return;
      
      const handleClickOutside = (e: MouseEvent) => {
        if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
          setExpanded(false);
        }
      };
      
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }, [expanded]);

    useEffect(() => {
      if (!isEditing || isSubmittingEdit) {
        return;
      }

      const handleClickOutside = (e: MouseEvent) => {
        if (!containerRef.current || containerRef.current.contains(e.target as Node)) {
          return;
        }

        if (isEditDirty) {
          triggerEditAttention();
        } else {
          editStore.cancelEdit(editKey);
        }
      };

      document.addEventListener('mousedown', handleClickOutside, true);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside, true);
      };
    }, [editKey, editStore, isEditDirty, isEditing, isSubmittingEdit, triggerEditAttention]);

    useEffect(() => {
      return () => {
        if (editAttentionRafRef.current !== null) {
          window.cancelAnimationFrame(editAttentionRafRef.current);
        }
        if (editAttentionTimeoutRef.current !== null) {
          window.clearTimeout(editAttentionTimeoutRef.current);
        }
      };
    }, []);

    // Avoid zero-size errors by rendering a placeholder instead of null.
    if (!message) {
      return <div style={{ minHeight: '1px' }} />;
    }
    
    const systemModifier = isSystem ? triggerSourceModifier(message.triggerSource) : '';
    const rootClassName = [
      'user-message-item',
      expanded ? 'user-message-item--expanded' : '',
      isFailed ? 'user-message-item--failed' : '',
      isSystem ? 'user-message-item--system' : 'user-message-item--human',
      isSystem && systemModifier ? `user-message-item--${systemModifier}` : '',
    ].filter(Boolean).join(' ');

    if (isSystem) {
      return (
        <>
        <div className="user-message-item__round-marker">
          <time className="user-message-item__round-time" dateTime={roundMarkerIso}>
            {roundMarkerText}
          </time>
        </div>
        <div ref={containerRef} className={rootClassName}>
          {/* Line 1: icon + source label (agent type · session name) */}
          <div className="user-message-item__system-header">
            <span
              className="user-message-item__agentic-os-icon"
              aria-label={triggerSourceLabel(message.triggerSource)}
              title={triggerSourceLabel(message.triggerSource)}
            >
              <Orbit size={12} strokeWidth={2} />
            </span>
            <span className="user-message-item__source-info">
              {sourceSessionInfo ? (
                <>
                  <Badge className="user-message-item__source-agent-type" variant="neutral">
                    {sourceSessionInfo.agentType}
                  </Badge>
                  <span className="user-message-item__source-sep">·</span>
                  <span className="user-message-item__source-session-name">{sourceSessionInfo.sessionName}</span>
                </>
              ) : (
                <Badge className="user-message-item__source-agent-type" variant="neutral">
                  {triggerSourceLabel(message.triggerSource)}
                </Badge>
              )}
            </span>
          </div>
          {/* Line 2: message content (truncated, expandable) */}
          <div
            className="user-message-item__system-row"
            onClick={handleToggleExpand}
            style={{ cursor: 'text' }}
            title={(isTruncated || expanded) ? (expanded ? t('message.clickToCollapse') : t('message.clickToExpand')) : undefined}
          >
            <span className="user-message-item__system-content">
              {highlightText(displayText, searchQuery ?? '')}
            </span>
            <IconButton
              className={`user-message-item__copy-action ${copied ? 'copied' : ''}`}
              size="small"
              variant={copied ? 'success' : 'ghost'}
              onClick={e => { e.stopPropagation(); handleCopy(e); }}
              aria-label={copied ? t('message.copyFailed') : t('message.copy')}
              tooltip={copied ? t('message.copyFailed') : t('message.copy')}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </IconButton>
          </div>
          {expanded && (
            <div className="user-message-item__expanded-body">
              <Markdown content={displayText} className="user-message-item__expanded-markdown" />
            </div>
          )}
        </div>
        </>
      );
    }

    if (isEditing) {
      return (
        <>
        <div className="user-message-item__round-marker">
          <time className="user-message-item__round-time" dateTime={roundMarkerIso}>
            {roundMarkerText}
          </time>
        </div>
        <div
          ref={containerRef}
          className={`${rootClassName} user-message-item--editing${showEditAttention ? ' user-message-item--edit-attention' : ''}`}
        >
          <UserMessageEditComposer
            value={editDraft}
            images={messageImages}
            disabled={isSubmittingEdit}
            labels={{
              placeholder: t('message.editPlaceholder'),
              submit: t('message.editSubmit'),
              cancel: t('message.editCancel'),
              removeImage: t('input.removeImage'),
            }}
            onChange={handleEditDraftChange}
            onSubmit={handleSubmitEdit}
            onCancel={handleCancelEdit}
          />
        </div>
        </>
      );
    }

    return (
      <>
      <div className="user-message-item__round-marker">
        <time className="user-message-item__round-time" dateTime={roundMarkerIso}>
          {roundMarkerText}
        </time>
      </div>
      <div 
        ref={containerRef}
        className={rootClassName}
      >
        {/* Single-line row, matching system-triggered messages but with a user icon. */}
        <div
          className="user-message-item__system-row"
          onClick={handleToggleExpand}
          style={{ cursor: 'text' }}
          title={(isTruncated || expanded) ? (expanded ? t('message.clickToCollapse') : t('message.clickToExpand')) : undefined}
        >
          <span className="user-message-item__user-icon" aria-label={t('message.user')}>
            <User size={14} strokeWidth={2} />
          </span>
          <span className="user-message-item__system-content">
            {highlightText(quotedDisplayText, searchQuery ?? '')}
          </span>
          <div className="user-message-item__actions" onClick={e => e.stopPropagation()}>
            <IconButton
              className={`user-message-item__copy-action ${copied ? 'copied' : ''}`}
              size="small"
              variant={copied ? 'success' : 'ghost'}
              onClick={handleCopy}
              aria-label={copied ? t('message.copyFailed') : t('message.copy')}
              tooltip={copied ? t('message.copyFailed') : t('message.copy')}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </IconButton>
            <IconButton
              className="user-message-item__edit-action"
              size="small"
              variant="ghost"
              onClick={handleBeginEdit}
              disabled={!sessionId || turnIndex < 0}
              aria-label={t('message.edit')}
              tooltip={t('message.edit')}
            >
              <Pencil size={14} />
            </IconButton>
            {isFailed ? (
              <IconButton
                className="user-message-item__copy-action"
                size="small"
                variant="ghost"
                onClick={handleFillToInput}
                aria-label={t('message.fillToInput')}
                tooltip={t('message.fillToInput')}
              >
                <ArrowDownToLine size={14} />
              </IconButton>
            ) : (
              <IconButton
                className="user-message-item__rollback-action"
                size="small"
                variant="ghost"
                onClick={handleRollback}
                disabled={!canRollback}
                isLoading={isRollingBack}
                aria-label={canRollback ? t('message.rollbackTo', { index: turnIndex + 1 }) : t('message.cannotRollback')}
                tooltip={canRollback ? t('message.rollbackTo', { index: turnIndex + 1 }) : t('message.cannotRollback')}
              >
                {isRollingBack ? (
                  <DotMatrixLoader size="tiny" />
                ) : (
                  <RotateCcw size={14} />
                )}
              </IconButton>
            )}
          </div>
        </div>

        {/* Expanded full content */}
        {expanded && (
          <div className="user-message-item__expanded-body">
            <Markdown content={displayText} className="user-message-item__expanded-markdown" />
          </div>
        )}

        {message.images && message.images.length > 0 && (
          <div className="user-message-item__images">
            {message.images.map(img => {
              const src = img.dataUrl || (img.imagePath ? `https://asset.localhost/${encodeURIComponent(img.imagePath)}` : undefined);
              return src ? (
                <div key={img.id} className="user-message-item__image-thumb" onClick={(e) => { e.stopPropagation(); setLightboxImage(src); }}>
                  <img src={src} alt={img.name} />
                </div>
              ) : null;
            })}
          </div>
        )}

        {reproductionSteps && (
          <div className="user-message-item__blocks">
            {reproductionSteps && <ReproductionStepsBlock steps={reproductionSteps} />}
          </div>
        )}

        {lightboxImage && (
          <div className="user-message-item__lightbox" onClick={() => setLightboxImage(null)}>
            <IconButton
              className="user-message-item__lightbox-close-action"
              onClick={() => setLightboxImage(null)}
              aria-label={t('common.close', { defaultValue: 'Close' })}
              shape="circle"
              variant="ghost"
            >
              <X size={20} />
            </IconButton>
            <img src={lightboxImage} alt="Preview" onClick={(e) => e.stopPropagation()} />
          </div>
        )}
      </div>
      </>
    );
  }
);

UserMessageItem.displayName = 'UserMessageItem';

