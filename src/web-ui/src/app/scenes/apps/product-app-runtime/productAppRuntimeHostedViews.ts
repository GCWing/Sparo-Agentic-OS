export type ProductAppRuntimeHostedViewKind = 'markdown-editor';

export interface ProductAppRuntimeHostedViewRect {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
}

export interface ProductAppRuntimeMarkdownEditorOptions {
  content: string;
  fileName: string;
  readOnly: boolean;
  showToolbar: boolean;
  showOutline: boolean;
  savedVersion?: string | number;
}

export interface ProductAppRuntimeHostedView {
  viewId: string;
  kind: ProductAppRuntimeHostedViewKind;
  rect: ProductAppRuntimeHostedViewRect;
  options: ProductAppRuntimeMarkdownEditorOptions;
}

export interface ProductAppRuntimeHostedViewBridge {
  mount(view: unknown): { viewId: string };
  update(view: unknown): { viewId: string };
  unmount(viewId: unknown): void;
}

const HOSTED_VIEW_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const MAX_HOSTED_VIEW_DIMENSION = 100_000;
const MAX_MARKDOWN_LENGTH = 5_000_000;

function objectValue(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function hostedViewId(value: unknown): string {
  if (typeof value !== 'string' || !HOSTED_VIEW_ID_PATTERN.test(value)) {
    throw new Error('hosted viewId must be a stable identifier');
  }
  return value;
}

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return Math.min(MAX_HOSTED_VIEW_DIMENSION, Math.max(0, value));
}

function normalizeRect(value: unknown): ProductAppRuntimeHostedViewRect {
  const rect = objectValue(value, 'hosted view rect');
  return {
    x: finiteNumber(rect.x, 'hosted view rect.x'),
    y: finiteNumber(rect.y, 'hosted view rect.y'),
    width: finiteNumber(rect.width, 'hosted view rect.width'),
    height: finiteNumber(rect.height, 'hosted view rect.height'),
    visible: rect.visible === true,
  };
}

function savedVersion(value: unknown): string | number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) {
    return value;
  }
  throw new Error('markdown editor savedVersion must be a string or number');
}

function normalizeMarkdownOptions(value: unknown): ProductAppRuntimeMarkdownEditorOptions {
  const options = objectValue(value, 'markdown editor options');
  const content = typeof options.content === 'string' ? options.content : '';
  if (content.length > MAX_MARKDOWN_LENGTH) {
    throw new Error('markdown editor content is too large');
  }
  return {
    content,
    fileName: typeof options.fileName === 'string' && options.fileName.trim()
      ? options.fileName.trim().slice(0, 256)
      : 'document.md',
    readOnly: options.readOnly === true,
    showToolbar: options.showToolbar !== false,
    showOutline: options.showOutline !== false,
    savedVersion: savedVersion(options.savedVersion),
  };
}

export function normalizeHostedView(value: unknown): ProductAppRuntimeHostedView {
  const view = objectValue(value, 'hosted view');
  if (view.kind !== 'markdown-editor') {
    throw new Error('unsupported hosted view kind');
  }
  return {
    viewId: hostedViewId(view.viewId),
    kind: view.kind,
    rect: normalizeRect(view.rect),
    options: normalizeMarkdownOptions(view.options),
  };
}

export function normalizeHostedViewUpdate(
  value: unknown,
  current: ProductAppRuntimeHostedView,
): ProductAppRuntimeHostedView {
  const update = objectValue(value, 'hosted view update');
  const viewId = hostedViewId(update.viewId);
  if (viewId !== current.viewId) {
    throw new Error('hosted view update cannot change viewId');
  }
  if (update.kind !== undefined && update.kind !== current.kind) {
    throw new Error('hosted view update cannot change kind');
  }
  return {
    ...current,
    rect: update.rect === undefined ? current.rect : normalizeRect(update.rect),
    options: update.options === undefined
      ? current.options
      : normalizeMarkdownOptions({ ...current.options, ...objectValue(update.options, 'markdown editor options') }),
  };
}

export function normalizeHostedViewId(value: unknown): string {
  return hostedViewId(value);
}

export function areHostedViewsEqual(
  left: ProductAppRuntimeHostedView,
  right: ProductAppRuntimeHostedView,
): boolean {
  return left.viewId === right.viewId
    && left.kind === right.kind
    && left.rect.x === right.rect.x
    && left.rect.y === right.rect.y
    && left.rect.width === right.rect.width
    && left.rect.height === right.rect.height
    && left.rect.visible === right.rect.visible
    && left.options.content === right.options.content
    && left.options.fileName === right.options.fileName
    && left.options.readOnly === right.options.readOnly
    && left.options.showToolbar === right.options.showToolbar
    && left.options.showOutline === right.options.showOutline
    && left.options.savedVersion === right.options.savedVersion;
}
