import React, { act, createRef, forwardRef, useImperativeHandle, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import type { ComposerDocument, ContextReference } from '@/shared/types/composer';
import { createComposerTextDocument } from '@/shared/types/composer';
import type { ImageContext, TextFragmentContext } from '@/shared/types/context';
import RichTextInput, { type RichTextInputHandle } from './RichTextInput';
import { ComposerAttachmentIdentity } from './composer/ComposerAttachmentIdentity';

type HarnessHandle = {
  focusInput: () => void;
  getDocument: () => ComposerDocument | undefined;
  insertContext: () => void;
  insertDuplicateContext: () => void;
  insertText: (text: string) => void;
  setValue: (value: string) => void;
};

interface HarnessProps {
  onRemoveReference?: (referenceId: string) => void;
}

let JSDOMCtor: (new (
  html?: string,
  options?: { pretendToBeVisual?: boolean }
) => { window: Window & typeof globalThis }) | null = null;

try {
  const jsdom = await import('jsdom');
  JSDOMCtor = jsdom.JSDOM as typeof JSDOMCtor;
} catch {
  JSDOMCtor = null;
}

const asset: TextFragmentContext = {
  id: 'asset-text-1',
  type: 'text-fragment',
  content: 'Long reference content',
  charCount: 22,
  source: 'clipboard',
  format: 'markdown',
  timestamp: 1,
};

const imageAsset: ImageContext = {
  id: 'asset-image-1',
  type: 'image',
  imageName: 'architecture.png',
  width: 1280,
  height: 720,
  fileSize: 2048,
  mimeType: 'image/png',
  thumbnailUrl: '/architecture-thumbnail.png',
  source: 'clipboard',
  sourceRef: { kind: 'memory-asset', assetId: 'asset-image-1' },
  timestamp: 1,
};

const reference: ContextReference = {
  id: 'reference-text-1',
  assetId: asset.id,
  scope: 'inline',
  role: 'reference',
  snapshotPolicy: 'current',
  createdAt: 1,
};

const duplicateReference: ContextReference = {
  ...reference,
  id: 'reference-text-duplicate',
  createdAt: 2,
};

const attachmentT = ((key: string, options?: Record<string, unknown>) => (
  key === 'input.context.attachmentNumber'
    ? `Attachment ${options?.number}`
    : key === 'input.context.longTextTitle'
      ? 'Long text'
    : key
)) as TFunction<'flow-chat'>;

const ControlledHarness = forwardRef<HarnessHandle, HarnessProps>(function ControlledHarness({
  onRemoveReference = () => {},
}, ref) {
  const [document, setDocument] = useState<ComposerDocument>(createComposerTextDocument('hello'));
  const inputRef = useRef<RichTextInputHandle>(null);

  useImperativeHandle(ref, () => ({
    focusInput: () => inputRef.current?.focus(),
    getDocument: () => inputRef.current?.getDocument(),
    insertContext: () => inputRef.current?.insertTag(reference, asset),
    insertDuplicateContext: () => inputRef.current?.insertTag(duplicateReference, asset),
    insertText: text => inputRef.current?.insertText(text),
    setValue: value => setDocument(createComposerTextDocument(value)),
  }), []);

  return (
    <RichTextInput
      ref={inputRef}
      document={document}
      onChange={setDocument}
      assets={[asset]}
      references={[reference]}
      onOpenReference={() => {}}
      onRemoveReference={onRemoveReference}
    />
  );
});

const describeWithJsdom = JSDOMCtor ? describe : describe.skip;

describeWithJsdom('RichTextInput Tiptap boundary', () => {
  let dom: { window: Window & typeof globalThis };
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    dom = new JSDOMCtor!('<!doctype html><html><body></body></html>', {
      pretendToBeVisual: true,
    });

    const { window } = dom;
    vi.stubGlobal('window', window);
    vi.stubGlobal('document', window.document);
    vi.stubGlobal('navigator', window.navigator);
    vi.stubGlobal('Node', window.Node);
    vi.stubGlobal('Text', window.Text);
    vi.stubGlobal('Element', window.Element);
    vi.stubGlobal('HTMLElement', window.HTMLElement);
    vi.stubGlobal('HTMLDivElement', window.HTMLDivElement);
    vi.stubGlobal('HTMLSpanElement', window.HTMLSpanElement);
    vi.stubGlobal('DocumentFragment', window.DocumentFragment);
    vi.stubGlobal('DOMParser', window.DOMParser);
    vi.stubGlobal('MutationObserver', window.MutationObserver);
    vi.stubGlobal('Range', window.Range);
    vi.stubGlobal('Selection', window.Selection);
    vi.stubGlobal('NodeFilter', window.NodeFilter);
    vi.stubGlobal('Event', window.Event);
    vi.stubGlobal('InputEvent', window.InputEvent);
    vi.stubGlobal('KeyboardEvent', window.KeyboardEvent);
    vi.stubGlobal('CustomEvent', window.CustomEvent);
    vi.stubGlobal('getComputedStyle', window.getComputedStyle.bind(window));
    vi.stubGlobal('getSelection', window.getSelection.bind(window));
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

    Object.defineProperty(window.Range.prototype, 'getClientRects', {
      configurable: true,
      value: () => [],
    });
    Object.defineProperty(window.Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0 }),
    });
    Object.defineProperty(window.HTMLElement.prototype, 'getClientRects', {
      configurable: true,
      value: () => [],
    });
    Object.defineProperty(window.HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0 }),
    });

    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    window.requestAnimationFrame = globalThis.requestAnimationFrame;
    window.cancelAnimationFrame = globalThis.cancelAnimationFrame;

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    await new Promise(resolve => setTimeout(resolve, 10));
    container.remove();
    dom.window.close();
    vi.unstubAllGlobals();
  });

  it('renders a concise preview title with an actual content excerpt', async () => {
    await act(async () => {
      root.render(
        <ComposerAttachmentIdentity
          asset={asset}
          attachmentNumber={1}
          variant="preview"
          t={attachmentT}
        />,
      );
    });

    expect(container.querySelector('.composer-attachment-identity__number')?.textContent).toBe('1');
    expect(container.querySelector('.composer-attachment-identity__title')?.textContent)
      .toBe('Long text');
    expect(container.querySelector('.composer-attachment-identity__preview-text')?.textContent)
      .toBe('Long reference content');
    expect(container.querySelector('.composer-attachment-identity__icon')).toBeNull();
  });

  it('uses media and dimensions for an image attachment preview', async () => {
    await act(async () => {
      root.render(
        <ComposerAttachmentIdentity
          asset={imageAsset}
          attachmentNumber={2}
          variant="preview"
          t={attachmentT}
        />,
      );
    });

    expect(container.querySelector<HTMLImageElement>('.composer-attachment-identity__thumbnail')?.src)
      .toContain('/architecture-thumbnail.png');
    expect(container.querySelector('.composer-attachment-identity__title')?.textContent)
      .toBe('architecture.png');
    expect(container.querySelector('.composer-attachment-identity__preview-text')?.textContent)
      .toBe('1280 × 720 · 2.0 KB');
  });

  async function renderHarness(ref: React.RefObject<HarnessHandle>) {
    await act(async () => {
      root.render(<ControlledHarness ref={ref} />);
    });

    const editor = container.querySelector('.rich-text-input');
    expect(editor).toBeInstanceOf(HTMLDivElement);
    return editor as HTMLDivElement;
  }

  it('keeps the editor instance when the parent echoes a local transaction', async () => {
    const harnessRef = createRef<HarnessHandle>();
    const editor = await renderHarness(harnessRef);

    await act(async () => {
      harnessRef.current?.insertText('!');
    });

    expect(container.querySelector('.rich-text-input')).toBe(editor);
    expect(editor.textContent).toBe('hello!');
    expect(harnessRef.current?.getDocument()).toEqual(createComposerTextDocument('hello!'));
  });

  it('accepts a controlled document replacement without recreating the editor', async () => {
    const harnessRef = createRef<HarnessHandle>();
    const editor = await renderHarness(harnessRef);

    await act(async () => {
      harnessRef.current?.setValue('server rewrite');
    });

    expect(container.querySelector('.rich-text-input')).toBe(editor);
    expect(editor.textContent).toBe('server rewrite');
    expect(harnessRef.current?.getDocument()).toEqual(createComposerTextDocument('server rewrite'));
  });

  it('keeps the schema-valid empty paragraph and exposes the placeholder state', async () => {
    const harnessRef = createRef<HarnessHandle>();
    const editor = await renderHarness(harnessRef);

    await act(async () => {
      harnessRef.current?.setValue('');
    });

    expect(harnessRef.current?.getDocument()).toEqual(createComposerTextDocument(''));
    expect(editor.querySelectorAll('p')).toHaveLength(1);
    expect(editor.querySelector('p')?.classList.contains('rich-text-input--empty')).toBe(true);
  });

  it('renders context as an atomic reference node containing only its reference id', async () => {
    const harnessRef = createRef<HarnessHandle>();
    const editor = await renderHarness(harnessRef);

    await act(async () => {
      harnessRef.current?.insertContext();
    });

    const tag = editor.querySelector<HTMLElement>('[data-composer-context-reference]');
    expect(tag?.dataset.referenceId).toBe(reference.id);
    expect(tag?.dataset.assetId).toBe(asset.id);
    expect(tag?.querySelector('.composer-attachment-identity__number')?.textContent).toBe('1');
    expect(tag?.querySelector('.composer-attachment-identity__icon svg')).not.toBeNull();
    expect(tag?.querySelector('.composer-attachment-identity__title')?.textContent)
      .toBe('Long reference content');
    const capsule = tag?.querySelector('.rich-text-tag-pill__surface');
    expect(capsule?.classList.contains('composer-attachment-identity--capsule')).toBe(true);
    expect(tag?.querySelector('.rich-text-tag-pill__remove')?.closest('.composer-attachment-identity--capsule'))
      .toBe(capsule);
    expect(harnessRef.current?.getDocument()).toEqual({
      version: 2,
      nodes: [
        { type: 'text', text: 'hello' },
        { type: 'context-ref', referenceId: reference.id },
      ],
    });
  });

  it('suppresses an immediately adjacent duplicate reference', async () => {
    const harnessRef = createRef<HarnessHandle>();
    const onRemoveReference = vi.fn();
    await act(async () => {
      root.render(
        <ControlledHarness
          ref={harnessRef}
          onRemoveReference={onRemoveReference}
        />,
      );
    });

    await act(async () => {
      harnessRef.current?.insertContext();
      harnessRef.current?.insertDuplicateContext();
    });

    expect(harnessRef.current?.getDocument()).toEqual({
      version: 2,
      nodes: [
        { type: 'text', text: 'hello' },
        { type: 'context-ref', referenceId: reference.id },
      ],
    });
    expect(onRemoveReference).toHaveBeenCalledOnce();
    expect(onRemoveReference).toHaveBeenCalledWith(duplicateReference.id);
  });

  it('places focus at the end through the public editor handle', async () => {
    const harnessRef = createRef<HarnessHandle>();
    const editor = await renderHarness(harnessRef);

    await act(async () => {
      harnessRef.current?.focusInput();
    });

    expect(document.activeElement).toBe(editor);
  });
});
