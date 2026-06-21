import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Node } from '@tiptap/core';
import { MarkdownRenderer } from '@/shared/markdown';
import { activeEditTargetService } from '@/tools/editor/services/ActiveEditTargetService';

type SourceBackedBlockOptions = {
  basePath?: string;
  labels?: SourceBackedBlockLabels;
};

type RawHtmlInlineOptions = {
  label: string;
};

type SourceBackedBlockLabels = {
  preview: string;
  sandbox: string;
  source: string;
  editSource: string;
  html: string;
  details: string;
  frontmatter: string;
  footnote: string;
  markdown: string;
};

const DEFAULT_SOURCE_BACKED_BLOCK_LABELS: SourceBackedBlockLabels = {
  preview: 'Preview',
  sandbox: 'Sandbox',
  source: 'Source',
  editSource: 'Edit source',
  html: 'HTML',
  details: 'Details',
  frontmatter: 'Frontmatter',
  footnote: 'Footnote',
  markdown: 'Markdown',
};

let sourceBackedBlockTextareaTargetCounter = 0;
let rawHtmlInlineTextareaTargetCounter = 0;

function resolveSourceBackedBlockLabel(
  nodeName: string,
  kind: string | null,
  labels: SourceBackedBlockLabels,
): string {
  switch (kind) {
    case 'details':
      return labels.details;
    case 'frontmatter':
      return labels.frontmatter;
    case 'footnote':
      return labels.footnote;
    default:
      return nodeName === 'rawHtmlBlock' ? labels.html : labels.markdown;
  }
}

function buildSandboxPreviewDocument(html: string): string {
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data: https: http:; media-src data: https: http:; style-src 'unsafe-inline'; font-src data: https: http:; frame-src 'none'; script-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'\">",
    '<style>',
    'html,body{margin:0;padding:0;background:transparent;color:CanvasText;font:14px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}',
    'body{padding:12px;box-sizing:border-box;}',
    'img,video,canvas,svg{max-width:100%;height:auto;}',
    'table{border-collapse:collapse;max-width:100%;}',
    'td,th{border:1px solid color-mix(in srgb, CanvasText 18%, transparent);padding:4px 6px;}',
    '</style>',
    '</head>',
    '<body>',
    html,
    '</body>',
    '</html>',
  ].join('');
}

function createRawHtmlInlinePreviewContent(
  html: string,
  labelText: string,
): {
  preview: HTMLElement;
  source: HTMLElement;
} {
  const preview = document.createElement('span');
  preview.className = 'm-editor-raw-html-inline__preview';

  const label = document.createElement('span');
  label.className = 'm-editor-raw-html-inline__label';
  label.textContent = labelText;

  const source = document.createElement('code');
  source.className = 'm-editor-raw-html-inline__source';
  source.textContent = html;

  preview.append(label, source);
  return { preview, source };
}

function isSelectAllShortcut(event: KeyboardEvent): boolean {
  return (
    event.key.toLowerCase() === 'a' &&
    (event.ctrlKey || event.metaKey) &&
    !event.altKey
  );
}

function focusElementWithoutScroll(element: HTMLElement): void {
  try {
    element.focus({ preventScroll: true });
  } catch {
    element.focus();
  }
}

function selectElementContent(element: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }

  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

function previewHasVisibleContent(preview: HTMLElement): boolean {
  const text = preview.textContent?.replace(/\u200b/g, '').trim() ?? '';
  if (text.length > 0) {
    return true;
  }

  if (preview.querySelector('img, svg, video, audio, table, pre, code, blockquote, ul, ol, hr')) {
    return true;
  }

  return Array.from(preview.querySelectorAll('details')).some((details) => {
    const detailsText = details.textContent?.replace(/\u200b/g, '').trim() ?? '';
    return detailsText.length > 0 || !!details.querySelector(
      'img, svg, video, audio, table, pre, code, blockquote, ul, ol, hr',
    );
  });
}

function normalizeDetailsBodyMarkdown(markdown: string): string {
  return markdown
    .replace(/^\s*\n/, '')
    .replace(/\n\s*$/, '');
}

function parseDetailsSource(markdown: string): {
  open: boolean;
  summaryHtml: string;
  bodyMarkdown: string;
} | null {
  const trimmed = markdown.trim();
  const match = trimmed.match(/^<details(\s[^>]*)?>\s*<summary>([\s\S]*?)<\/summary>\s*([\s\S]*?)\s*<\/details>$/);
  if (!match) {
    return null;
  }

  const [, attrSource = '', summaryHtml = '', bodyRaw = ''] = match;
  const isOpen = /\bopen\b/i.test(attrSource);

  return {
    open: isOpen,
    summaryHtml,
    bodyMarkdown: normalizeDetailsBodyMarkdown(bodyRaw),
  };
}

function isSafePreviewUrl(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return !normalized.startsWith('javascript:') && !normalized.startsWith('vbscript:');
}

function sanitizeDetailsSummaryHtml(summaryHtml: string): string {
  if (typeof document === 'undefined') {
    return summaryHtml;
  }

  const template = document.createElement('template');
  template.innerHTML = summaryHtml;
  const allowedTags = new Set(['A', 'STRONG', 'B', 'EM', 'I', 'CODE', 'BR', 'IMG']);

  const sanitizeNode = (node: globalThis.Node) => {
    if (!(node instanceof HTMLElement)) {
      return;
    }

    if (!allowedTags.has(node.tagName)) {
      const parent = node.parentNode;
      if (!parent) {
        return;
      }

      while (node.firstChild) {
        parent.insertBefore(node.firstChild, node);
      }
      parent.removeChild(node);
      return;
    }

    Array.from(node.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = attr.value;

      if (name.startsWith('on')) {
        node.removeAttribute(attr.name);
        return;
      }

      if (node.tagName === 'A') {
        if (!['href', 'title'].includes(name)) {
          node.removeAttribute(attr.name);
          return;
        }
        if (name === 'href' && !isSafePreviewUrl(value)) {
          node.removeAttribute(attr.name);
        }
        return;
      }

      if (node.tagName === 'IMG') {
        if (!['src', 'alt', 'title', 'width', 'height', 'align'].includes(name)) {
          node.removeAttribute(attr.name);
          return;
        }
        if (name === 'src' && !isSafePreviewUrl(value)) {
          node.removeAttribute(attr.name);
        }
        return;
      }

      if (name !== 'class') {
        node.removeAttribute(attr.name);
      }
    });

    Array.from(node.children).forEach((child) => sanitizeNode(child));
  };

  Array.from(template.content.children).forEach((child) => sanitizeNode(child));
  return template.innerHTML;
}

function executeTextareaAction(
  textarea: HTMLTextAreaElement | null,
  action: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll',
): boolean {
  if (!textarea || textarea.disabled) {
    return false;
  }

  textarea.focus();

  if (textarea.readOnly && action !== 'copy' && action !== 'selectAll') {
    return false;
  }

  if (action === 'selectAll') {
    textarea.select();
    return true;
  }

  return document.execCommand(action);
}

function createSourceBackedBlock(
  name: string,
  valueAttr: 'html' | 'markdown',
  className: string,
) {
  return Node.create<SourceBackedBlockOptions>({
    name,
    group: 'block',
    atom: true,
    isolating: true,
    selectable: true,
    draggable: false,
    defining: true,

    addOptions() {
      return {
        basePath: undefined,
        labels: DEFAULT_SOURCE_BACKED_BLOCK_LABELS,
      };
    },

    addAttributes() {
      return {
        [valueAttr]: {
          default: '',
        },
        kind: {
          default: null,
        },
      };
    },

    parseHTML() {
      return [{
        tag: `div[data-type="${name}"]`,
        getAttrs: element => ({
          [valueAttr]: element.getAttribute(`data-${valueAttr}`) ?? '',
          kind: element.getAttribute('data-kind'),
        }),
      }];
    },

    renderHTML({ node }) {
      const value = String(node.attrs[valueAttr] ?? '');
      const kind = typeof node.attrs.kind === 'string' && node.attrs.kind
        ? node.attrs.kind
        : null;

      return [
        'div',
        {
          'data-type': name,
          [`data-${valueAttr}`]: value,
          ...(kind ? { 'data-kind': kind } : {}),
        },
      ];
    },

    addNodeView() {
      return ({ editor, node, getPos }) => {
        let currentNode = node;
        let isEditing = false;
        let viewMode: 'preview' | 'source' | 'sandbox' = 'preview';
        let lastSyncedValue: string | null = null;
        let lastEditableState = editor.isEditable;
        let previewRoot: Root | null = null;
        let previewCheckTimer: number | null = null;
        const textareaTargetId = `${name}-textarea-${++sourceBackedBlockTextareaTargetCounter}`;
        let unbindEditTarget: (() => void) | null = null;

        const dom = document.createElement('div');
        dom.className = className;
        dom.draggable = false;
        dom.setAttribute('draggable', 'false');

        const labels = {
          ...DEFAULT_SOURCE_BACKED_BLOCK_LABELS,
          ...(this.options.labels ?? {}),
        };

        const header = document.createElement('div');
        header.className = `${className}__header`;
        header.draggable = false;
        header.setAttribute('draggable', 'false');

        const title = document.createElement('span');
        title.className = `${className}__title`;

        const actions = document.createElement('div');
        actions.className = `${className}__actions`;

        const previewButton = document.createElement('button');
        previewButton.type = 'button';
        previewButton.className = `${className}__action`;
        previewButton.textContent = labels.preview;

        const sandboxButton = document.createElement('button');
        sandboxButton.type = 'button';
        sandboxButton.className = `${className}__action`;
        sandboxButton.textContent = labels.sandbox;

        const sourceButton = document.createElement('button');
        sourceButton.type = 'button';
        sourceButton.className = `${className}__action`;
        sourceButton.textContent = labels.source;

        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.className = `${className}__action ${className}__action--primary`;
        editButton.textContent = labels.editSource;

        actions.append(previewButton, sandboxButton, sourceButton, editButton);
        header.append(title, actions);

        const body = document.createElement('div');
        body.className = `${className}__body`;
        body.draggable = false;
        body.setAttribute('draggable', 'false');

        const editorPane = document.createElement('div');
        editorPane.className = `${className}__pane ${className}__pane--editor`;

        const textarea = document.createElement('textarea');
        textarea.className = `${className}__textarea`;
        textarea.spellcheck = false;
        textarea.wrap = 'off';
        textarea.draggable = false;
        textarea.setAttribute('draggable', 'false');

        editorPane.append(textarea);

        const previewPane = document.createElement('div');
        previewPane.className = `${className}__pane ${className}__pane--preview`;

        const preview = document.createElement('div');
        preview.className = `${className}__preview markdown-body`;
        preview.draggable = false;
        preview.setAttribute('draggable', 'false');
        preview.tabIndex = 0;
        previewRoot = createRoot(preview);

        const sourceFallback = document.createElement('pre');
        sourceFallback.className = `${className}__source-fallback`;
        sourceFallback.tabIndex = 0;

        const sandboxFrame = document.createElement('iframe');
        sandboxFrame.className = `${className}__sandbox`;
        sandboxFrame.title = labels.sandbox;
        sandboxFrame.setAttribute('sandbox', '');
        sandboxFrame.setAttribute('referrerpolicy', 'no-referrer');

        previewPane.append(preview, sourceFallback, sandboxFrame);
        body.append(editorPane, previewPane);
        dom.append(header, body);

        const applyAttrs = (attrs: Record<string, unknown>) => {
          const pos = typeof getPos === 'function' ? getPos() : null;
          if (typeof pos !== 'number') {
            return;
          }

          editor.view.dispatch(
            editor.view.state.tr.setNodeMarkup(pos, undefined, {
              ...currentNode.attrs,
              ...attrs,
            }),
          );
        };

        const syncEditingState = () => {
          const kind = typeof currentNode.attrs.kind === 'string' ? currentNode.attrs.kind : null;
          const canSandboxPreview = name === 'rawHtmlBlock';
          if (!canSandboxPreview && viewMode === 'sandbox') {
            viewMode = 'preview';
          }
          dom.setAttribute('data-editing', isEditing ? 'true' : 'false');
          dom.setAttribute('data-view-mode', viewMode);
          title.textContent = resolveSourceBackedBlockLabel(name, kind, labels);
          sandboxButton.hidden = !canSandboxPreview;
          previewButton.setAttribute('aria-pressed', viewMode === 'preview' ? 'true' : 'false');
          sandboxButton.setAttribute('aria-pressed', viewMode === 'sandbox' ? 'true' : 'false');
          sourceButton.setAttribute('aria-pressed', viewMode === 'source' ? 'true' : 'false');
          editButton.disabled = !editor.isEditable;
          preview.tabIndex = editor.isEditable ? -1 : 0;
        };

        const setEditing = (nextEditing: boolean, options?: { focus?: boolean }) => {
          const resolvedEditing = editor.isEditable ? nextEditing : false;
          if (isEditing === resolvedEditing) {
            if (resolvedEditing && options?.focus) {
              focusElementWithoutScroll(textarea);
            }
            return;
          }

          isEditing = resolvedEditing;
          syncEditingState();

          if (resolvedEditing && options?.focus) {
            focusElementWithoutScroll(textarea);
          }
        };

        const exitEditing = () => {
          setEditing(false);
        };

        const renderPreview = (markdown: string) => {
          const kind = typeof currentNode.attrs.kind === 'string' ? currentNode.attrs.kind : null;
          const detailsSource = kind === 'details' ? parseDetailsSource(markdown) : null;
          const shouldForceSourcePreview = kind === 'frontmatter';
          const shouldCheckPreviewVisibility =
            name === 'rawHtmlBlock' ||
            kind === 'details' ||
            kind === 'footnote' ||
            shouldForceSourcePreview;

          sandboxFrame.srcdoc = name === 'rawHtmlBlock'
            ? buildSandboxPreviewDocument(markdown)
            : '';

          const syncPreviewVisibility = (fallbackToMarkdownRenderer = false) => {
            if (!shouldCheckPreviewVisibility) {
              dom.setAttribute('data-preview-empty', 'false');
              return;
            }

            if (previewCheckTimer !== null) {
              window.clearTimeout(previewCheckTimer);
            }

            previewCheckTimer = window.setTimeout(() => {
              const hasVisibleContent = previewHasVisibleContent(preview);

              if (!hasVisibleContent && fallbackToMarkdownRenderer) {
                previewRoot?.render(
                  React.createElement(MarkdownRenderer, {
                    content: markdown,
                    basePath: this.options.basePath,
                    className: `${className}__markdown`,
                  }),
                );

                previewCheckTimer = window.setTimeout(() => {
                  dom.setAttribute('data-preview-empty', previewHasVisibleContent(preview) ? 'false' : 'true');
                  previewCheckTimer = null;
                }, 0);
                return;
              }

              dom.setAttribute('data-preview-empty', hasVisibleContent ? 'false' : 'true');
              previewCheckTimer = null;
            }, 0);
          };

          if (shouldForceSourcePreview) {
            previewRoot?.render(null);
            sourceFallback.textContent = markdown;
            dom.setAttribute('data-preview-empty', 'true');
            return;
          }

          if (detailsSource) {
            previewRoot?.render(
              React.createElement(
                'details',
                {
                  open: detailsSource.open,
                  className: `${className}__details`,
                },
                React.createElement(
                  'summary',
                  {
                    className: `${className}__details-summary`,
                  },
                  React.createElement('span', {
                    className: `${className}__details-summary-content`,
                    dangerouslySetInnerHTML: {
                      __html: sanitizeDetailsSummaryHtml(detailsSource.summaryHtml),
                    },
                  }),
                ),
                detailsSource.bodyMarkdown
                  ? React.createElement(
                      'div',
                      {
                        className: `${className}__details-body`,
                      },
                      React.createElement(MarkdownRenderer, {
                        content: detailsSource.bodyMarkdown,
                        basePath: this.options.basePath,
                        className: `${className}__markdown`,
                      }),
                    )
                  : null,
              ),
            );

            sourceFallback.textContent = markdown;
            dom.setAttribute('data-preview-empty', 'false');
            syncPreviewVisibility(true);
            return;
          }

          previewRoot?.render(
            React.createElement(MarkdownRenderer, {
              content: markdown,
              basePath: this.options.basePath,
              className: `${className}__markdown`,
            }),
          );

          sourceFallback.textContent = markdown;
          dom.setAttribute('data-preview-empty', 'false');
          syncPreviewVisibility();
        };

        const sync = () => {
          const value = String(currentNode.attrs[valueAttr] ?? '');
          const editable = editor.isEditable;
          const valueChanged = lastSyncedValue !== value;
          const editableChanged = lastEditableState !== editable;

          dom.setAttribute('data-readonly', editable ? 'false' : 'true');

          if (valueChanged && textarea.value !== value) {
            textarea.value = value;
          }

          textarea.readOnly = !editable;
          if (!editable && isEditing) {
            isEditing = false;
          }
          syncEditingState();

          if (valueChanged || editableChanged) {
            renderPreview(value);
          }

          lastSyncedValue = value;
          lastEditableState = editable;
        };

        const enterEditing = () => {
          setEditing(true, { focus: true });
          const end = textarea.value.length;
          textarea.setSelectionRange(end, end);
          sync();
        };

        const stopPropagation = (event: Event) => {
          event.stopPropagation();
        };

        const handleTextareaKeyDown = (event: KeyboardEvent) => {
          if (isSelectAllShortcut(event)) {
            event.preventDefault();
            textarea.select();
          }

          event.stopPropagation();
        };

        const handlePreviewKeyDown = (event: KeyboardEvent) => {
          if (isSelectAllShortcut(event)) {
            event.preventDefault();
            selectElementContent(preview);
          }

          event.stopPropagation();
        };

        const handlePreviewClickCapture = (event: Event) => {
          const target = event.target;
          if (!(target instanceof HTMLElement)) {
            return;
          }

          if (target.closest('a')) {
            event.stopPropagation();
          }
        };

        const handlePreviewMouseDown = (event: MouseEvent) => {
          if (!editor.isEditable) {
            focusElementWithoutScroll(preview);
          }

          event.stopPropagation();
        };

        const handlePreviewDoubleClick = (event: MouseEvent) => {
          const target = event.target;
          if (!(target instanceof HTMLElement)) {
            return;
          }

          if (target.closest('a, summary')) {
            event.stopPropagation();
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          enterEditing();
        };

        const preventDrag = (event: Event) => {
          event.preventDefault();
          event.stopPropagation();
        };

        const handleHeaderMouseDown = (event: MouseEvent) => {
          event.stopPropagation();
        };

        const handlePreviewButtonClick = (event: MouseEvent) => {
          event.preventDefault();
          event.stopPropagation();
          viewMode = 'preview';
          syncEditingState();
        };

        const handleSandboxButtonClick = (event: MouseEvent) => {
          event.preventDefault();
          event.stopPropagation();
          viewMode = 'sandbox';
          syncEditingState();
        };

        const handleSourceButtonClick = (event: MouseEvent) => {
          event.preventDefault();
          event.stopPropagation();
          viewMode = 'source';
          syncEditingState();
        };

        const handleEditButtonClick = (event: MouseEvent) => {
          event.preventDefault();
          event.stopPropagation();
          enterEditing();
        };

        const handleTextareaFocus = () => {
          activeEditTargetService.setActiveTarget(textareaTargetId);
        };

        const handleTextareaBlur = () => {
          window.setTimeout(() => {
            const activeElement = typeof document !== 'undefined' ? document.activeElement : null;
            if (activeElement instanceof HTMLElement && textarea.contains(activeElement)) {
              return;
            }

            activeEditTargetService.clearActiveTarget(textareaTargetId);
          }, 0);
        };

        textarea.addEventListener('mousedown', stopPropagation);
        textarea.addEventListener('click', stopPropagation);
        textarea.addEventListener('keydown', handleTextareaKeyDown);
        textarea.addEventListener('focus', handleTextareaFocus);
        textarea.addEventListener('blur', exitEditing);
        textarea.addEventListener('blur', handleTextareaBlur);

        header.addEventListener('mousedown', handleHeaderMouseDown);
        header.addEventListener('click', stopPropagation);
        previewButton.addEventListener('click', handlePreviewButtonClick);
        sandboxButton.addEventListener('click', handleSandboxButtonClick);
        sourceButton.addEventListener('click', handleSourceButtonClick);
        editButton.addEventListener('click', handleEditButtonClick);

        preview.addEventListener('mousedown', handlePreviewMouseDown);
        preview.addEventListener('click', handlePreviewClickCapture, true);
        preview.addEventListener('click', stopPropagation);
        preview.addEventListener('dblclick', handlePreviewDoubleClick);
        preview.addEventListener('keydown', handlePreviewKeyDown);

        sourceFallback.addEventListener('mousedown', handlePreviewMouseDown);
        sourceFallback.addEventListener('click', stopPropagation);
        sourceFallback.addEventListener('dblclick', handlePreviewDoubleClick);
        sourceFallback.addEventListener('keydown', handlePreviewKeyDown);
        sandboxFrame.addEventListener('mousedown', stopPropagation);
        sandboxFrame.addEventListener('click', stopPropagation);

        [dom, header, body, textarea, preview, sourceFallback, sandboxFrame].forEach((element) => {
          element.addEventListener('dragstart', preventDrag);
        });

        textarea.addEventListener('input', () => {
          const nextValue = textarea.value;
          lastSyncedValue = nextValue;
          applyAttrs({ [valueAttr]: nextValue });
          void renderPreview(nextValue);
        });

        unbindEditTarget = activeEditTargetService.bindTarget({
          id: textareaTargetId,
          kind: 'markdown-textarea',
          focus: () => {
            focusElementWithoutScroll(textarea);
          },
          hasTextFocus: () => {
            const activeElement = typeof document !== 'undefined' ? document.activeElement : null;
            return activeElement === textarea;
          },
          undo: () => executeTextareaAction(textarea, 'undo'),
          redo: () => executeTextareaAction(textarea, 'redo'),
          cut: () => executeTextareaAction(textarea, 'cut'),
          copy: () => executeTextareaAction(textarea, 'copy'),
          paste: () => executeTextareaAction(textarea, 'paste'),
          selectAll: () => executeTextareaAction(textarea, 'selectAll'),
          containsElement: (element) => element === textarea,
        });

        sync();

        return {
          dom,
          update: (updatedNode) => {
            if (updatedNode.type.name !== this.name) {
              return false;
            }

            currentNode = updatedNode;
            sync();
            return true;
          },
          stopEvent: (event) => {
            if (event.type === 'dragstart') {
              return true;
            }

            const target = event.target;
            return target instanceof HTMLElement && dom.contains(target) && (
              !!target.closest('textarea') ||
              !!target.closest(`.${className}__preview`) ||
              !!target.closest(`.${className}__sandbox`)
            );
          },
          ignoreMutation: (mutation) => {
            const target = mutation.target;
            return target instanceof globalThis.Node && dom.contains(target);
          },
          destroy: () => {
            activeEditTargetService.clearActiveTarget(textareaTargetId);
            unbindEditTarget?.();
            unbindEditTarget = null;
            if (previewCheckTimer !== null) {
              window.clearTimeout(previewCheckTimer);
              previewCheckTimer = null;
            }
            previewRoot?.unmount();
            previewRoot = null;
          },
        };
      };
    },
  });
}

export const RenderOnlyBlock = createSourceBackedBlock(
  'renderOnlyBlock',
  'markdown',
  'm-editor-render-only-block',
);

export const RawHtmlBlock = createSourceBackedBlock(
  'rawHtmlBlock',
  'html',
  'm-editor-raw-html-block',
);

export const RawHtmlInline = Node.create<RawHtmlInlineOptions>({
  name: 'rawHtmlInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return {
      label: 'HTML',
    };
  },

  addAttributes() {
    return {
      html: {
        default: '',
      },
    };
  },

  parseHTML() {
    return [{
      tag: 'span[data-type="raw-html-inline"]',
      getAttrs: element => ({
        html: element.getAttribute('data-html') ?? '',
      }),
    }];
  },

  renderHTML({ node }) {
    return [
      'span',
      {
        'data-type': 'raw-html-inline',
        'data-html': String(node.attrs.html ?? ''),
      },
    ];
  },

  addNodeView() {
    return ({ editor, node, getPos }) => {
      let currentNode = node;
      let isEditing = false;
      let editingStartValue = String(node.attrs.html ?? '');
      let unbindEditTarget: (() => void) | null = null;
      const textareaTargetId = `raw-html-inline-textarea-${++rawHtmlInlineTextareaTargetCounter}`;

      const dom = document.createElement('span');
      dom.className = 'm-editor-raw-html-inline';
      dom.draggable = false;
      dom.setAttribute('draggable', 'false');

      const { preview, source } = createRawHtmlInlinePreviewContent(
        String(currentNode.attrs.html ?? ''),
        this.options.label,
      );

      const textarea = document.createElement('textarea');
      textarea.className = 'm-editor-raw-html-inline__textarea';
      textarea.spellcheck = false;
      textarea.wrap = 'off';
      textarea.rows = 1;
      textarea.draggable = false;
      textarea.setAttribute('draggable', 'false');

      dom.append(preview, textarea);

      const applyAttrs = (attrs: Record<string, unknown>) => {
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (typeof pos !== 'number') {
          return;
        }

        editor.view.dispatch(
          editor.view.state.tr.setNodeMarkup(pos, undefined, {
            ...currentNode.attrs,
            ...attrs,
          }),
        );
      };

      const syncEditingState = () => {
        dom.setAttribute('data-editing', isEditing ? 'true' : 'false');
        dom.setAttribute('data-readonly', editor.isEditable ? 'false' : 'true');
        preview.tabIndex = editor.isEditable ? 0 : -1;
      };

      const sync = () => {
        const value = String(currentNode.attrs.html ?? '');
        if (source.textContent !== value) {
          source.textContent = value;
        }
        if (textarea.value !== value && document.activeElement !== textarea) {
          textarea.value = value;
        }
        textarea.readOnly = !editor.isEditable;
        syncEditingState();
      };

      const setEditing = (nextEditing: boolean, options?: { focus?: boolean }) => {
        const resolvedEditing = editor.isEditable ? nextEditing : false;
        if (isEditing === resolvedEditing) {
          if (resolvedEditing && options?.focus) {
            focusElementWithoutScroll(textarea);
          }
          return;
        }

        isEditing = resolvedEditing;
        syncEditingState();

        if (resolvedEditing && options?.focus) {
          focusElementWithoutScroll(textarea);
          textarea.select();
        }
      };

      const enterEditing = () => {
        editingStartValue = String(currentNode.attrs.html ?? '');
        setEditing(true, { focus: true });
        sync();
      };

      const exitEditing = () => {
        setEditing(false);
      };

      const stopPropagation = (event: Event) => {
        event.stopPropagation();
      };

      const preventDrag = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
      };

      const handlePreviewKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === 'F2') {
          event.preventDefault();
          event.stopPropagation();
          enterEditing();
          return;
        }

        event.stopPropagation();
      };

      const handleTextareaKeyDown = (event: KeyboardEvent) => {
        if (isSelectAllShortcut(event)) {
          event.preventDefault();
          textarea.select();
        }

        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          textarea.value = editingStartValue;
          source.textContent = editingStartValue;
          applyAttrs({ html: editingStartValue });
          exitEditing();
          return;
        }

        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          event.stopPropagation();
          exitEditing();
          return;
        }

        event.stopPropagation();
      };

      const handleTextareaFocus = () => {
        activeEditTargetService.setActiveTarget(textareaTargetId);
      };

      const handleTextareaBlur = () => {
        exitEditing();
        window.setTimeout(() => {
          const activeElement = typeof document !== 'undefined' ? document.activeElement : null;
          if (activeElement === textarea) {
            return;
          }

          activeEditTargetService.clearActiveTarget(textareaTargetId);
        }, 0);
      };

      preview.addEventListener('mousedown', stopPropagation);
      preview.addEventListener('click', stopPropagation);
      preview.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
        enterEditing();
      });
      preview.addEventListener('keydown', handlePreviewKeyDown);

      textarea.addEventListener('mousedown', stopPropagation);
      textarea.addEventListener('click', stopPropagation);
      textarea.addEventListener('keydown', handleTextareaKeyDown);
      textarea.addEventListener('focus', handleTextareaFocus);
      textarea.addEventListener('blur', handleTextareaBlur);
      textarea.addEventListener('input', () => {
        const nextValue = textarea.value;
        source.textContent = nextValue;
        applyAttrs({ html: nextValue });
      });

      [dom, preview, textarea].forEach((element) => {
        element.addEventListener('dragstart', preventDrag);
      });

      unbindEditTarget = activeEditTargetService.bindTarget({
        id: textareaTargetId,
        kind: 'markdown-textarea',
        focus: () => {
          focusElementWithoutScroll(textarea);
        },
        hasTextFocus: () => {
          const activeElement = typeof document !== 'undefined' ? document.activeElement : null;
          return activeElement === textarea;
        },
        undo: () => executeTextareaAction(textarea, 'undo'),
        redo: () => executeTextareaAction(textarea, 'redo'),
        cut: () => executeTextareaAction(textarea, 'cut'),
        copy: () => executeTextareaAction(textarea, 'copy'),
        paste: () => executeTextareaAction(textarea, 'paste'),
        selectAll: () => executeTextareaAction(textarea, 'selectAll'),
        containsElement: (element) => element === textarea,
      });

      sync();

      return {
        dom,
        update: (updatedNode) => {
          if (updatedNode.type.name !== this.name) {
            return false;
          }

          currentNode = updatedNode;
          sync();
          return true;
        },
        stopEvent: (event) => {
          const target = event.target;
          return target instanceof HTMLElement && dom.contains(target);
        },
        ignoreMutation: (mutation) => {
          const target = mutation.target;
          return target instanceof globalThis.Node && dom.contains(target);
        },
        destroy: () => {
          activeEditTargetService.clearActiveTarget(textareaTargetId);
          unbindEditTarget?.();
          unbindEditTarget = null;
        },
      };
    };
  },
});
