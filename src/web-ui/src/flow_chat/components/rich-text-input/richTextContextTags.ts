import type { TFunction } from 'i18next';
import type { ContextItem } from '@/shared/types/context';
import {
  getContextPresentation,
  type OpenContextOptions,
} from '../../domain/composerContextRegistry';

export function updateContextTagElement(
  tag: HTMLSpanElement,
  context: ContextItem,
  t: TFunction<'flow-chat'>,
): void {
  const presentation = getContextPresentation(context, t);
  tag.dataset.contextId = context.id;
  tag.dataset.contextType = context.type;
  tag.title = presentation.detail;
  tag.setAttribute('aria-label', `${presentation.label}, ${presentation.detail}`);
  tag.querySelector<HTMLElement>('.rich-text-tag-pill__text')!.textContent = presentation.label;
  const action = tag.querySelector<HTMLButtonElement>('.rich-text-tag-pill__action');
  if (action) {
    action.disabled = !presentation.canOpen;
    action.setAttribute('aria-label', presentation.canOpen
      ? t('input.context.open', { label: presentation.label, defaultValue: 'Open {{label}}' })
      : presentation.label);
  }
  const remove = tag.querySelector<HTMLButtonElement>('.rich-text-tag-pill__remove');
  if (remove) {
    remove.title = t('input.context.remove', { label: presentation.label, defaultValue: 'Remove {{label}}' });
    remove.setAttribute('aria-label', remove.title);
  }
  const detail = tag.querySelector<HTMLElement>('.rich-text-tag-pill__detail');
  if (detail) detail.textContent = presentation.detail;
  tag.classList.toggle('rich-text-tag-pill--openable', presentation.canOpen);
}

export function createContextTagElement(
  context: ContextItem,
  t: TFunction<'flow-chat'>,
  resolveContext: (id: string) => ContextItem | undefined,
  onOpenContext: (context: ContextItem, options: OpenContextOptions) => void,
  getOpenOptions: () => OpenContextOptions,
  onRemoveContext: (id: string) => void,
): HTMLSpanElement {
  const presentation = getContextPresentation(context, t);
  const tag = document.createElement('span');
  tag.className = 'rich-text-tag-pill';
  tag.contentEditable = 'false';

  const action = document.createElement('button');
  action.className = 'rich-text-tag-pill__action';
  action.type = 'button';
  action.disabled = !presentation.canOpen;
  action.setAttribute('aria-label', presentation.canOpen
    ? t('input.context.open', { label: presentation.label, defaultValue: 'Open {{label}}' })
    : presentation.label);
  action.onclick = event => {
    event.preventDefault();
    event.stopPropagation();
    const latestContext = resolveContext(context.id);
    if (presentation.canOpen && latestContext) onOpenContext(latestContext, getOpenOptions());
  };

  const text = document.createElement('span');
  text.className = 'rich-text-tag-pill__text';
  action.appendChild(text);

  const remove = document.createElement('button');
  remove.className = 'rich-text-tag-pill__remove';
  remove.type = 'button';
  remove.textContent = '×';
  remove.title = t('input.context.remove', { label: presentation.label, defaultValue: 'Remove {{label}}' });
  remove.setAttribute('aria-label', remove.title);
  remove.onclick = event => {
    event.preventDefault();
    event.stopPropagation();
    onRemoveContext(context.id);
  };

  tag.append(action, remove);
  updateContextTagElement(tag, context, t);
  return tag;
}
