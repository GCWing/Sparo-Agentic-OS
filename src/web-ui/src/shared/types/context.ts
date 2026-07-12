 
/**
 * Context item types shared across features.
 *
 * A `ContextItem` is a discriminated union (via `type`) used to represent things
 * like files, snippets, diagrams, and URLs in a transportable form (e.g. drag-and-drop,
 * context menus, clipboard).
 */
export interface BaseContext {
  id: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

/**
 * A discriminated union representing supported context payloads.
 */
export type ContextItem =
  | FileContext
  | DirectoryContext
  | CodeSnippetContext
  | ImageContext
  | TerminalCommandContext
  | GitRefContext
  | URLContext
  | WebElementContext
  | ProductAppPreviewElementSelectionContext
  | SpreadsheetFocusContext;

export interface FileContext extends BaseContext {
  type: 'file';
  filePath: string;
  fileName: string;
  fileSize?: number;
  mimeType?: string;
  relativePath?: string; 
}

export interface DirectoryContext extends BaseContext {
  type: 'directory';
  directoryPath: string;
  directoryName: string;
  recursive: boolean;
  itemCount?: number;
}

export interface CodeSnippetContext extends BaseContext {
  type: 'code-snippet';
  filePath: string;
  fileName: string;
  startLine: number;
  endLine: number;
  selectedText: string;
  language?: string;
  
  beforeContext?: string; 
  afterContext?: string;  
}

export interface ImageContext extends BaseContext {
  type: 'image';
  imagePath: string;
  imageName: string;
  width?: number;
  height?: number;
  fileSize: number;          
  mimeType: string;          
  dataUrl?: string;          
  thumbnailUrl?: string;     
  source: 'file' | 'clipboard' | 'url';  
  isLocal: boolean;          
}

export interface TerminalCommandContext extends BaseContext {
  type: 'terminal-command';
  command: string;
  workingDirectory?: string;
  output?: string;
}

export interface GitRefContext extends BaseContext {
  type: 'git-ref';
  refType: 'commit' | 'branch' | 'tag';
  refValue: string;
  commitHash?: string;
  commitMessage?: string;
}

export interface URLContext extends BaseContext {
  type: 'url';
  url: string;
  title?: string;
  description?: string;
}

export interface WebElementContext extends BaseContext {
  type: 'web-element';
  /** HTML tag name, e.g. "div", "button" */
  tagName: string;
  /** Absolute CSS selector path to the element */
  path: string;
  /** All HTML attributes of the element */
  attributes: Record<string, string>;
  /** Inner text content (truncated) */
  textContent: string;
  /** Outer HTML (truncated) */
  outerHTML: string;
  /** URL of the page where the element was captured */
  sourceUrl?: string;
}

export interface NormalizedPreviewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ProductAppPreviewElementAncestorSummary {
  tagName: string;
  selectorPart: string;
  role?: string;
  label?: string;
}

export interface ProductAppPreviewElementSummary {
  tagName: string;
  selectorPath: string;
  selectorPart?: string;
  role?: string;
  label?: string;
  textContent?: string;
  attributes?: Record<string, string>;
  normalizedBox: NormalizedPreviewBox;
  computedStyleSummary?: Record<string, string>;
  ancestorPath?: ProductAppPreviewElementAncestorSummary[];
}

export interface ProductAppPreviewElementFingerprint {
  selectorPath: string;
  textHash?: string;
  boxHash: string;
}

export interface ProductAppPreviewElementSelectionContext extends BaseContext {
  type: 'product-app-preview-element-selection';
  schemaVersion: 1;
  appId: string;
  appName?: string;
  sessionId?: string | null;
  route: string;
  runtimeRevision?: string;
  element: ProductAppPreviewElementSummary;
  fingerprint: ProductAppPreviewElementFingerprint;
  source: 'iframe-element-inspector' | 'runtime-specific';
  confidence: 'high' | 'medium' | 'low';
}

export interface SpreadsheetFocusValueSummary {
  cellCount?: number;
  numericCount?: number;
  textCount?: number;
  emptyCount?: number;
  formulaCount?: number;
  sum?: number;
  avg?: number | null;
  headerGuess?: string[];
}

export type SpreadsheetFocusMode = 'inspect' | 'edit' | 'author';

/**
 * Cache coverage is emitted by the spreadsheet surface. Newer runtimes use a
 * structured count, while early previews used a numeric ratio. Keep both
 * forms so persisted/pinned contexts remain readable across runtime updates.
 */
export type SpreadsheetFocusCacheCoverage =
  | number
  | {
      cachedCellCount?: number;
      selectedCellCount?: number;
      loadedCellCount?: number;
      totalCellCount?: number;
      ratio?: number;
      [key: string]: unknown;
    };

export interface SpreadsheetFocusContext extends BaseContext {
  type: 'spreadsheet-focus';
  schemaVersion: 1;
  role: 'ambient' | 'pinned';
  /** Chat session bound to the Excel Live surface that produced this focus. */
  sessionId?: string;
  workbookId: string;
  workbookPath?: string;
  sheetId: string;
  sheetName: string;
  a1: string;
  selectionKind: 'cell' | 'range' | 'row' | 'column' | 'sheet';
  rowCount: number;
  columnCount: number;
  mode?: SpreadsheetFocusMode;
  revision?: string | number;
  cacheCoverage?: SpreadsheetFocusCacheCoverage;
  /** Only an explicit `true` means preview/value cache covers the selection. */
  cacheComplete: boolean;
  /** False means selected formula results are cached/stale and not authoritative. */
  formulaResultsFresh?: boolean;
  /** Engine calculation state captured with this focus. */
  calculationStatus?: Record<string, unknown>;
  /** Separates live-view limitations from source-package round-trip safety. */
  fidelity?: Record<string, unknown>;
  /** Time at which this exact focus snapshot was captured by the surface. */
  capturedAt: number;
  previewTsv?: string;
  previewTruncated: boolean;
  valueSummary?: SpreadsheetFocusValueSummary;
}

/**
 * Convenience alias for the discriminant used by `ContextItem`.
 */
export type ContextType = ContextItem['type'];

 
export type ContextByType<T extends ContextType> = Extract<
  ContextItem,
  { type: T }
>;



export interface ValidationResult {
  valid: boolean;
  error?: string;
  warnings?: string[];
  metadata?: Record<string, unknown>; 
}



export interface RenderOptions {
  compact?: boolean;      
  interactive?: boolean;  
  showPreview?: boolean;  
}



export function isFileContext(context: ContextItem): context is FileContext {
  return context.type === 'file';
}

export function isDirectoryContext(context: ContextItem): context is DirectoryContext {
  return context.type === 'directory';
}

export function isCodeSnippetContext(context: ContextItem): context is CodeSnippetContext {
  return context.type === 'code-snippet';
}

export function isImageContext(context: ContextItem): context is ImageContext {
  return context.type === 'image';
}

export function isTerminalCommandContext(context: ContextItem): context is TerminalCommandContext {
  return context.type === 'terminal-command';
}

export function isGitRefContext(context: ContextItem): context is GitRefContext {
  return context.type === 'git-ref';
}

export function isURLContext(context: ContextItem): context is URLContext {
  return context.type === 'url';
}

export function isWebElementContext(context: ContextItem): context is WebElementContext {
  return context.type === 'web-element';
}

export function isProductAppPreviewElementSelectionContext(
  context: ContextItem,
): context is ProductAppPreviewElementSelectionContext {
  return context.type === 'product-app-preview-element-selection';
}

export function isSpreadsheetFocusContext(
  context: ContextItem,
): context is SpreadsheetFocusContext {
  return context.type === 'spreadsheet-focus';
}

 
export function isContextOfType<T extends ContextType>(
  context: ContextItem,
  type: T
): context is ContextByType<T> {
  return context.type === type;
}
