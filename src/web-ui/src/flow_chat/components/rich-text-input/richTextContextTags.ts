import type { TFunction } from 'i18next';
import type { ContextReference } from '@/shared/types/composer';
import type { ContextItem } from '@/shared/types/context';
import { getContextPresentation } from '../../domain/composerContextRegistry';
import { populateComposerAttachmentIdentityContent } from '../composer/ComposerAttachmentIdentity';

function ensureContextTagSurface(tag: HTMLSpanElement): HTMLSpanElement {
  const existing = tag.querySelector<HTMLSpanElement>('.rich-text-tag-pill__surface');
  if (existing) return existing;

  const surface = document.createElement('span');
  surface.className = 'rich-text-tag-pill__surface composer-attachment-identity composer-attachment-identity--capsule';
  surface.append(...Array.from(tag.childNodes));
  tag.replaceChildren(surface);
  return surface;
}

export function updateContextTagElement(
  tag: HTMLSpanElement,
  reference: ContextReference,
  context: ContextItem,
  attachmentNumber: number,
  t: TFunction<'flow-chat'>,
): void {
  const presentation = getContextPresentation(context, t);
  tag.dataset.referenceId = reference.id;
  tag.dataset.assetId = context.id;
  tag.dataset.contextType = context.type;
  const surface = ensureContextTagSurface(tag);
  surface.dataset.contextType = context.type;
  tag.title = presentation.detail;
  tag.setAttribute('aria-label', `${presentation.label}, ${presentation.detail}`);
  const action = tag.querySelector<HTMLButtonElement>('.rich-text-tag-pill__action');
  if (action) {
    action.disabled = false;
    action.setAttribute('aria-label', t('input.context.preview', {
      label: presentation.label,
      defaultValue: 'Preview {{label}}',
    }));
    populateComposerAttachmentIdentityContent(
      action,
      context,
      attachmentNumber,
      'capsule',
      t,
    );
  }
  const remove = tag.querySelector<HTMLButtonElement>('.rich-text-tag-pill__remove');
  if (remove) {
    remove.title = t('input.context.remove', {
      label: presentation.label,
      defaultValue: 'Remove {{label}}',
    });
    remove.setAttribute('aria-label', remove.title);
  }
  const detail = tag.querySelector<HTMLElement>('.rich-text-tag-pill__detail');
  if (detail) detail.textContent = presentation.detail;
  tag.classList.add('rich-text-tag-pill--openable');
}

export function createContextTagElement(
  reference: ContextReference,
  context: ContextItem,
  attachmentNumber: number,
  t: TFunction<'flow-chat'>,
  onOpenReference: (referenceId: string, anchor: HTMLElement) => void,
  onRemoveReference: (id: string) => void,
): HTMLSpanElement {
  const presentation = getContextPresentation(context, t);
  const tag = document.createElement('span');
  tag.className = 'rich-text-tag-pill';
  tag.contentEditable = 'false';
  tag.setAttribute('data-composer-context-reference', '');

  const action = document.createElement('button');
  action.className = 'rich-text-tag-pill__action';
  action.type = 'button';
  action.setAttribute('aria-label', t('input.context.preview', {
    label: presentation.label,
    defaultValue: 'Preview {{label}}',
  }));
  action.onclick = event => {
    event.preventDefault();
    event.stopPropagation();
    onOpenReference(reference.id, tag);
  };

  const remove = document.createElement('button');
  remove.className = 'rich-text-tag-pill__remove';
  remove.type = 'button';
  remove.textContent = '×';
  remove.title = t('input.context.remove', {
    label: presentation.label,
    defaultValue: 'Remove {{label}}',
  });
  remove.setAttribute('aria-label', remove.title);
  remove.onclick = event => {
    event.preventDefault();
    event.stopPropagation();
    onRemoveReference(reference.id);
  };

  const surface = document.createElement('span');
  surface.className = 'rich-text-tag-pill__surface composer-attachment-identity composer-attachment-identity--capsule';
  surface.dataset.contextType = context.type;
  surface.append(action, remove);
  tag.append(surface);
  updateContextTagElement(tag, reference, context, attachmentNumber, t);
  return tag;
}
