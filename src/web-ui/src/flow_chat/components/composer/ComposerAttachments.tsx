import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { IconButton } from '@/design-system';
import { useTranslation } from 'react-i18next';
import type { ContextItem } from '@/shared/types/context';
import type { AttachmentActivity } from '@/shared/stores/contextStore';
import {
  getContextPresentation,
} from '../../domain/composerContextRegistry';
import { ComposerAttachmentIdentity } from './ComposerAttachmentIdentity';

interface ComposerAttachmentsProps {
  assets: ContextItem[];
  activity: AttachmentActivity | null;
  onOpen: (assetId: string, anchor: HTMLElement) => void;
  onRemove: (assetId: string) => void;
}

export function ComposerAttachments({
  assets,
  activity,
  onOpen,
  onRemove,
}: ComposerAttachmentsProps) {
  const { t } = useTranslation('flow-chat');
  const trayRef = useRef<HTMLDivElement>(null);
  const [overflowState, setOverflowState] = useState({ before: false, after: false });
  const [pulsedAssetId, setPulsedAssetId] = useState<string | null>(null);
  const activityAssetId = activity?.assetId;
  const activitySequence = activity?.sequence;

  useEffect(() => {
    if (!activityAssetId) return undefined;
    setPulsedAssetId(null);
    const frame = requestAnimationFrame(() => {
      setPulsedAssetId(activityAssetId);
      const card = Array.from(
        trayRef.current?.querySelectorAll<HTMLElement>('[data-attachment-asset-id]') || [],
      ).find(element => element.dataset.attachmentAssetId === activityAssetId);
      card?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    });
    const timeout = window.setTimeout(() => setPulsedAssetId(null), 720);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [activityAssetId, activitySequence]);

  const updateOverflowState = useCallback(() => {
    const tray = trayRef.current;
    if (!tray) return;
    const maxScrollLeft = Math.max(0, tray.scrollWidth - tray.clientWidth);
    setOverflowState({
      before: tray.scrollLeft > 2,
      after: tray.scrollLeft < maxScrollLeft - 2,
    });
  }, []);

  useEffect(() => {
    const tray = trayRef.current;
    if (!tray) return;
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateOverflowState);
    observer?.observe(tray);
    Array.from(tray.children).forEach(child => observer?.observe(child));
    tray.addEventListener('scroll', updateOverflowState, { passive: true });
    window.addEventListener('resize', updateOverflowState);
    updateOverflowState();
    return () => {
      observer?.disconnect();
      tray.removeEventListener('scroll', updateOverflowState);
      window.removeEventListener('resize', updateOverflowState);
    };
  }, [assets, updateOverflowState]);

  const scrollTray = useCallback((direction: -1 | 1) => {
    const tray = trayRef.current;
    if (!tray) return;
    tray.scrollBy({
      left: direction * Math.max(168, tray.clientWidth * 0.72),
      behavior: 'smooth',
    });
  }, []);

  if (assets.length === 0) return null;

  return (
    <div className={[
      'sparo-chat-input__context-tray-frame',
      overflowState.before ? 'sparo-chat-input__context-tray-frame--has-before' : '',
      overflowState.after ? 'sparo-chat-input__context-tray-frame--has-after' : '',
    ].filter(Boolean).join(' ')}>
      <div
        ref={trayRef}
        className="sparo-chat-input__context-tray"
        data-testid="chat-input-context-tray"
        aria-label={t('input.context.attachments', { defaultValue: 'Attachments' })}
      >
        {assets.map((asset, index) => {
          const presentation = getContextPresentation(asset, t);
          return (
            <div
              key={asset.id}
              className={[
                'sparo-chat-input__context-preview',
                pulsedAssetId === asset.id
                  ? 'sparo-chat-input__context-preview--reused'
                  : '',
              ].filter(Boolean).join(' ')}
              data-context-type={asset.type}
              data-attachment-asset-id={asset.id}
            >
              <button
                type="button"
                className="sparo-chat-input__context-preview-trigger"
                aria-label={t('input.context.preview', {
                  label: presentation.label,
                  defaultValue: 'Preview {{label}}',
                })}
                onClick={event => onOpen(asset.id, event.currentTarget)}
              >
                <ComposerAttachmentIdentity
                  asset={asset}
                  attachmentNumber={index + 1}
                  variant="preview"
                  t={t}
                />
              </button>
              <IconButton
                aria-label={t('input.context.remove', {
                  label: presentation.label,
                  defaultValue: 'Remove {{label}}',
                })}
                className="sparo-chat-input__context-preview-remove"
                onClick={event => {
                  event.stopPropagation();
                  onRemove(asset.id);
                }}
                size="xs"
                variant="ghost"
              >
                <X aria-hidden="true" size={14} />
              </IconButton>
            </div>
          );
        })}
      </div>
      {overflowState.before ? (
        <IconButton
          aria-label={t('input.context.showPreviousAttachments', { defaultValue: 'Show previous attachments' })}
          className="sparo-chat-input__context-tray-nav sparo-chat-input__context-tray-nav--previous"
          onClick={() => scrollTray(-1)}
          size="xs"
          variant="ghost"
        >
          <ChevronLeft aria-hidden="true" size={16} />
        </IconButton>
      ) : null}
      {overflowState.after ? (
        <IconButton
          aria-label={t('input.context.showMoreAttachments', { defaultValue: 'Show more attachments' })}
          className="sparo-chat-input__context-tray-nav sparo-chat-input__context-tray-nav--next"
          onClick={() => scrollTray(1)}
          size="xs"
          variant="ghost"
        >
          <ChevronRight aria-hidden="true" size={16} />
        </IconButton>
      ) : null}
    </div>
  );
}
