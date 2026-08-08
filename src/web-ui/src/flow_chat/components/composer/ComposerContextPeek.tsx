import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Expand, PanelRightOpen, TextCursorInput, Trash2 } from 'lucide-react';
import { FloatingCard, IconButton } from '@/design-system';
import type { ContextReference } from '@/shared/types/composer';
import type { ContextItem } from '@/shared/types/context';
import { getImageAssetPreviewUrl } from '@/shared/media/imageAssetStore';
import {
  getContextDisplayTitle,
  getContextPresentation,
  openComposerContextWorkspace,
  type OpenContextOptions,
} from '../../domain/composerContextRegistry';
import { useTranslation } from 'react-i18next';

interface ComposerContextPeekProps {
  reference?: ContextReference;
  asset: ContextItem;
  anchor: HTMLElement;
  openOptions: OpenContextOptions;
  onDismiss: () => void;
  onInsertReference?: (assetId: string) => void;
  onRemoveAttachment?: (assetId: string) => void;
  onRemoveReference?: (referenceId: string) => void;
}

function ContextPreview({ asset }: { asset: ContextItem }) {
  if (asset.type === 'image') {
    const source = getImageAssetPreviewUrl(asset);
    return source ? (
      <img className="composer-context-peek__image" src={source} alt={asset.imageName} />
    ) : (
      <div className="composer-context-peek__empty">{asset.imageName}</div>
    );
  }
  if (asset.type === 'text-fragment') {
    return <div className="composer-context-peek__text">{asset.content}</div>;
  }
  if (asset.type === 'code-snippet') {
    return <pre className="composer-context-peek__code"><code>{asset.selectedText}</code></pre>;
  }
  if (asset.type === 'intent-canvas') {
    return asset.thumbnailUrl
      ? <img className="composer-context-peek__image" src={asset.thumbnailUrl} alt={asset.title} />
      : <div className="composer-context-peek__text">{asset.serializedContent}</div>;
  }
  if (asset.type === 'url') {
    return (
      <div className="composer-context-peek__link-preview">
        <strong>{asset.title || asset.url}</strong>
        {asset.description ? <span>{asset.description}</span> : null}
        <span>{asset.url}</span>
      </div>
    );
  }
  const raw = asset.type === 'terminal-command'
    ? [asset.command, asset.output].filter(Boolean).join('\n\n')
    : asset.type === 'web-element'
      ? asset.textContent || asset.outerHTML
      : asset.type === 'product-app-preview-element-selection'
        ? asset.element.textContent || asset.element.selectorPath
        : asset.type === 'spreadsheet-focus'
          ? `${asset.sheetName}!${asset.a1}`
          : asset.type === 'file'
            ? asset.filePath
            : asset.type === 'directory'
              ? asset.directoryPath
              : asset.type === 'git-ref'
                ? asset.refValue
                : asset.type === 'skill-selection'
                  ? asset.description
                  : '';
  return <div className="composer-context-peek__text">{raw}</div>;
}

export function ComposerContextPeek({
  reference,
  asset,
  anchor,
  openOptions,
  onDismiss,
  onInsertReference,
  onRemoveAttachment,
  onRemoveReference,
}: ComposerContextPeekProps) {
  const { t } = useTranslation('flow-chat');
  const cardRef = useRef<HTMLDivElement>(null);
  const presentation = useMemo(() => getContextPresentation(asset, t), [asset, t]);
  const displayTitle = useMemo(() => getContextDisplayTitle(asset, t), [asset, t]);
  const openDockedLabel = t('input.context.openDocked', { defaultValue: 'Open' });
  const openSceneFocusLabel = t('input.context.openSceneFocus', { defaultValue: 'Full screen in scene' });
  const insertLabel = t('input.context.insertAtCursor', { defaultValue: 'Insert at cursor' });
  const removeLabel = reference
    ? t('input.context.removeReference', { defaultValue: 'Remove reference' })
    : t('input.context.removeAttachment', { defaultValue: 'Remove attachment' });

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (cardRef.current?.contains(target) || anchor.contains(target)) return;
      onDismiss();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onDismiss();
      anchor.focus();
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [anchor, onDismiss]);

  const openWorkspace = (mode: 'docked' | 'scene-focus') => {
    openComposerContextWorkspace(asset, openOptions, mode);
    onDismiss();
  };

  return createPortal(
    <FloatingCard
      ref={cardRef}
      className="composer-context-peek"
      padding="compact"
      role="dialog"
      aria-modal="false"
      aria-label={presentation.label}
      onDismiss={onDismiss}
      dismissLabel={t('input.context.closePreview', { defaultValue: 'Close preview' })}
      data-testid="composer-context-peek"
    >
      <div className="composer-context-peek__header">
        <span className="composer-context-peek__eyebrow">
          {t(`input.context.types.${asset.type}`, { defaultValue: asset.type })}
        </span>
        <strong>{displayTitle}</strong>
      </div>
      <div className="composer-context-peek__preview">
        <ContextPreview asset={asset} />
      </div>
      <div
        className="composer-context-peek__actions"
        role="toolbar"
        aria-label={t('input.context.previewActions', { defaultValue: 'Preview actions' })}
      >
        <IconButton
          aria-label={openDockedLabel}
          tooltip={openDockedLabel}
          tooltipFollowCursor={false}
          size="small"
          variant="ghost"
          onClick={() => openWorkspace('docked')}
        >
          <PanelRightOpen aria-hidden="true" size={17} />
        </IconButton>
        <IconButton
          aria-label={openSceneFocusLabel}
          tooltip={openSceneFocusLabel}
          tooltipFollowCursor={false}
          size="small"
          variant="ghost"
          onClick={() => openWorkspace('scene-focus')}
        >
          <Expand aria-hidden="true" size={17} />
        </IconButton>
        <span className="composer-context-peek__action-divider" aria-hidden="true" />
        {onInsertReference ? (
          <IconButton
            aria-label={insertLabel}
            tooltip={insertLabel}
            tooltipFollowCursor={false}
            size="small"
            variant="ghost"
            onClick={() => onInsertReference(asset.id)}
          >
            <TextCursorInput aria-hidden="true" size={17} />
          </IconButton>
        ) : null}
        <span className="composer-context-peek__action-divider" aria-hidden="true" />
        <IconButton
          aria-label={removeLabel}
          tooltip={removeLabel}
          tooltipFollowCursor={false}
          size="small"
          variant="danger"
          onClick={() => {
            if (reference) onRemoveReference?.(reference.id);
            else onRemoveAttachment?.(asset.id);
            onDismiss();
          }}
        >
          <Trash2 aria-hidden="true" size={17} />
        </IconButton>
      </div>
    </FloatingCard>,
    document.body,
  );
}
