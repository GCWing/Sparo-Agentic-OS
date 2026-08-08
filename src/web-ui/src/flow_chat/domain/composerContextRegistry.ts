import type { TFunction } from 'i18next';
import {
  BookOpen,
  Braces,
  Clipboard,
  Code2,
  File,
  Folder,
  GitBranch,
  Image,
  Link,
  Layers,
  Network,
  MousePointer2,
  Sheet,
  SquareTerminal,
  type LucideIcon,
} from 'lucide-react';
import { i18nService } from '@/infrastructure/i18n';
import { getImageAssetPreviewUrl } from '@/shared/media/imageAssetStore';
import type {
  ContextItem,
  ContextType,
  SpreadsheetFocusCacheCoverage,
  SpreadsheetFocusContext,
  SkillSelectionContext,
  TextFragmentContext,
} from '@/shared/types/context';
import type {
  ComposerContextSnapshot,
  ComposerDocument,
  ComposerSubmissionEnvelope,
  ComposerSubmissionIntent,
  ContextReference,
} from '@/shared/types/composer';
import { getComposerReferenceIds } from '@/shared/types/composer';
import {
  isComposerContextWorkspaceOpen,
  requestComposerContextWorkspace,
  type ComposerWorkspaceItemDescriptor,
} from './composerContextWorkspacePort';

export type ContextInjectionMode = 'inline' | 'attached' | 'out-of-band';

export interface ContextPresentation {
  label: string;
  detail: string;
  icon: LucideIcon;
  color: 'blue' | 'green' | 'red' | 'yellow' | 'purple' | 'gray';
  canOpen: boolean;
}

export interface OpenContextOptions {
  readOnly: boolean;
  draftKey?: string;
  workspacePath?: string;
  onUpdate?: (contextId: string, updates: Partial<ContextItem>) => void;
}

interface ContextTypeAdapter<T extends ContextItem> {
  injectionMode: ContextInjectionMode;
  presentation: (context: T, t: TFunction<'flow-chat'>) => ContextPresentation;
  serializeForModel: (context: T, capturedAt: number) => string;
  open?: (context: T, options: OpenContextOptions) => void | Promise<void>;
  createWorkspaceItem?: (
    context: T,
    options: OpenContextOptions,
  ) => ComposerWorkspaceItemDescriptor;
  snapshot?: (context: T) => T;
}

function fileDetail(path: string): string {
  return path;
}

function basePresentation(
  label: string,
  detail: string,
  icon: LucideIcon,
  color: ContextPresentation['color'] = 'gray',
  canOpen = false,
): ContextPresentation {
  return { label, detail, icon, color, canOpen };
}

function markdownWorkspaceItem(
  context: ContextItem,
  title: string,
  content: string,
  options: OpenContextOptions,
  readOnly = true,
): ComposerWorkspaceItemDescriptor {
  const duplicateCheckKey = `context-workspace:${options.draftKey || 'draft'}:${context.id}`;
  return {
    type: 'markdown-editor',
    title,
    duplicateCheckKey,
    replaceExisting: true,
    data: {
      initialContent: content,
      fileName: title,
      workspacePath: options.workspacePath,
      readOnly,
      onContentChange: readOnly || !options.onUpdate
        ? undefined
        : (nextContent: string) => options.onUpdate?.(context.id, {
            ...(context.type === 'text-fragment'
              ? { content: nextContent, charCount: Array.from(nextContent).length }
              : {}),
          }),
    },
    metadata: {
      contextId: context.id,
      contextType: context.type,
      duplicateCheckKey,
    },
  };
}

function textFragmentPreview(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  const characters = Array.from(normalized);
  const preview = characters.slice(0, 14).join('');
  return characters.length > 14 ? `${preview}…` : preview;
}

function formatSpreadsheetCoverage(coverage: SpreadsheetFocusCacheCoverage | undefined): string {
  if (coverage == null) return 'unknown';
  if (typeof coverage === 'number') {
    if (coverage >= 0 && coverage <= 1) return `${Math.round(coverage * 100)}%`;
    return String(coverage);
  }
  const cached = coverage.cachedCellCount ?? coverage.loadedCellCount;
  const selected = coverage.selectedCellCount ?? coverage.totalCellCount;
  if (typeof cached === 'number' && typeof selected === 'number') return `${cached}/${selected} cells`;
  if (typeof coverage.ratio === 'number') return `${Math.round(coverage.ratio * 100)}%`;
  return JSON.stringify(coverage);
}

function spreadsheetFormulaResultsTrustworthy(context: SpreadsheetFocusContext): boolean {
  if (context.formulaResultsFresh === false) return false;
  const token = String(
    context.calculationStatus?.status ?? context.calculationStatus?.state ?? '',
  ).trim().toLowerCase();
  if (['cached', 'stale', 'pending', 'dirty', 'unknown', 'failed', 'error'].includes(token)) {
    return false;
  }
  if (['current', 'fresh', 'ready', 'calculated', 'recalculated', 'ok', 'not-required'].includes(token)) {
    return true;
  }
  return context.formulaResultsFresh === true;
}

export function formatSpreadsheetFocusContext(
  context: SpreadsheetFocusContext,
  sendCapturedAt: number,
): string {
  const formulaTrustworthy = spreadsheetFormulaResultsTrustworthy(context);
  const capturedAt = Number.isFinite(context.capturedAt) && context.capturedAt > 0
    ? context.capturedAt
    : sendCapturedAt;
  const lines = [
    `[Spreadsheet Focus (${context.role}): ${context.sheetName}!${context.a1}]`,
    `Binding: session=${context.sessionId || 'unbound'}; workbook=${context.workbookId}${context.workbookPath ? ` (${context.workbookPath})` : ''}`,
    `Selection: ${context.selectionKind}; size=${context.rowCount}x${context.columnCount}`,
    `Mode: ${context.mode || 'unknown'}`,
    `Revision: ${context.revision ?? 'unknown'}`,
    `Cache: ${context.cacheComplete ? 'complete' : 'incomplete'}; coverage=${formatSpreadsheetCoverage(context.cacheCoverage)}`,
    `Formula results: ${formulaTrustworthy ? (context.formulaResultsFresh === true ? 'fresh' : 'no untrusted formula evidence') : 'stale/unknown and untrusted'}; calculationStatus=${JSON.stringify(context.calculationStatus ?? null)}`,
    `Fidelity: ${JSON.stringify(context.fidelity ?? null)}`,
    `Freshness: ${new Date(capturedAt).toISOString()}; age at send ${Math.max(0, sendCapturedAt - capturedAt)} ms`,
  ];
  if (context.valueSummary) {
    lines.push(`${context.cacheComplete ? 'Value summary' : 'Cached value summary (partial, not authoritative)'}: ${JSON.stringify(context.valueSummary)}`);
  }
  if (!formulaTrustworthy) {
    lines.push('Preview TSV: omitted because formula results are stale or not explicitly proven fresh.');
  } else if (context.cacheComplete && context.previewTsv) {
    lines.push(`Preview TSV${context.previewTruncated ? ' (truncated)' : ''}:\n\`\`\`tsv\n${context.previewTsv}\n\`\`\``);
  } else if (!context.cacheComplete) {
    lines.push('Preview TSV: omitted because the selection cache is incomplete.');
  }
  return lines.join('\n');
}

function openTextFragment(context: TextFragmentContext, options: OpenContextOptions): void {
  const longTextTitle = i18nService.t('flow-chat:input.context.longTextTitle', {
    defaultValue: 'Long text',
  });
  const title = options.readOnly
    ? `${longTextTitle} · ${context.charCount.toLocaleString()}`
    : longTextTitle;
  const duplicateCheckKey = options.readOnly
    ? `message-context:${context.id}`
    : `composer-context:${options.draftKey || 'draft'}:${context.id}`;

  requestComposerContextWorkspace({
    item: {
      ...markdownWorkspaceItem(context, title, context.content, options, options.readOnly),
      duplicateCheckKey,
    },
    presentation: 'docked',
  });
}

const adapters: { [K in ContextType]: ContextTypeAdapter<Extract<ContextItem, { type: K }>> } = {
  'text-fragment': {
    injectionMode: 'inline',
    presentation: (context, t) => basePresentation(
      t('input.context.textFragment', {
        preview: textFragmentPreview(context.content) || t('input.context.emptyPreview', { defaultValue: 'empty' }),
        defaultValue: 'Long text: {{preview}}',
      }),
      t('input.context.characterCount', {
        count: context.charCount,
        defaultValue: '{{count}} chars',
      }),
      Clipboard,
      'purple',
      true,
    ),
    serializeForModel: context => context.content,
    open: openTextFragment,
    createWorkspaceItem: (context, options) => markdownWorkspaceItem(
      context,
      i18nService.t('flow-chat:input.context.longTextTitle', { defaultValue: 'Long text' }),
      context.content,
      options,
      options.readOnly,
    ),
  },
  'skill-selection': {
    injectionMode: 'inline',
    presentation: (context: SkillSelectionContext, t) => basePresentation(
      context.name,
      context.targetKind === 'suite'
        ? t('input.context.skillSuiteDetail', {
            count: context.memberCount ?? 0,
            defaultValue: 'Skill Suite · {{count}} skills',
          })
        : t('input.context.skillDetail', {
            suite: context.suiteName ?? t('input.context.standaloneSkill', { defaultValue: 'Standalone' }),
            defaultValue: 'Skill · {{suite}}',
          }),
      context.targetKind === 'suite' ? Layers : BookOpen,
      context.targetKind === 'suite' ? 'purple' : 'blue',
    ),
    serializeForModel: context => `Please use the Skill tool with command "${context.command}".`,
  },
  file: {
    injectionMode: 'attached',
    presentation: context => basePresentation(context.fileName, fileDetail(context.filePath), File, 'blue', true),
    serializeForModel: context => `[File: ${context.relativePath || context.filePath}]`,
    createWorkspaceItem: (context, options) => ({
      type: /\.(md|mdx|markdown)$/i.test(context.fileName) ? 'markdown-editor' : 'code-editor',
      title: context.fileName,
      duplicateCheckKey: `context-workspace:${options.draftKey || 'draft'}:${context.id}`,
      replaceExisting: true,
      data: { filePath: context.filePath, workspacePath: options.workspacePath },
      metadata: { contextId: context.id, contextType: context.type },
    }),
  },
  directory: {
    injectionMode: 'attached',
    presentation: context => basePresentation(context.directoryName, context.directoryPath, Folder, 'purple'),
    serializeForModel: context => `[Directory${context.recursive ? ' (recursive)' : ''}: ${context.directoryPath}]`,
    createWorkspaceItem: (context, options) => markdownWorkspaceItem(
      context,
      context.directoryName,
      `# ${context.directoryName}\n\n${context.directoryPath}`,
      options,
    ),
  },
  'code-snippet': {
    injectionMode: 'inline',
    presentation: context => basePresentation(
      `${context.fileName}:${context.startLine}-${context.endLine}`,
      context.filePath,
      Code2,
      'green',
      true,
    ),
    serializeForModel: context => [
      `[Code Snippet: ${context.filePath}:${context.startLine}-${context.endLine}]`,
      `\`\`\`${context.language || ''}`,
      context.selectedText,
      '```',
    ].join('\n'),
    createWorkspaceItem: (context, options) => ({
      type: 'code-editor',
      title: context.fileName,
      duplicateCheckKey: `context-workspace:${options.draftKey || 'draft'}:${context.id}`,
      replaceExisting: true,
      data: {
        filePath: context.filePath,
        workspacePath: options.workspacePath,
        jumpToRange: { start: context.startLine, end: context.endLine },
      },
      metadata: { contextId: context.id, contextType: context.type },
    }),
  },
  image: {
    injectionMode: 'out-of-band',
    presentation: context => basePresentation(
      context.imageName,
      context.sourceRef.kind === 'local-file' ? context.sourceRef.path : '',
      Image,
      'yellow',
    ),
    serializeForModel: () => '',
    createWorkspaceItem: (context, options) => ({
      type: 'image-viewer',
      title: context.imageName,
      duplicateCheckKey: `context-workspace:${options.draftKey || 'draft'}:${context.id}`,
      replaceExisting: true,
      data: {
        sourceRef: context.sourceRef,
        previewUrl: getImageAssetPreviewUrl(context),
        mimeType: context.mimeType,
        fileSize: context.fileSize,
        width: context.width,
        height: context.height,
      },
      metadata: { contextId: context.id, contextType: context.type },
    }),
    snapshot: context => ({ ...context, thumbnailUrl: undefined }),
  },
  'terminal-command': {
    injectionMode: 'inline',
    presentation: context => basePresentation(context.command, context.workingDirectory || '', SquareTerminal, 'gray'),
    serializeForModel: context => [
      `[Terminal Command${context.workingDirectory ? ` @ ${context.workingDirectory}` : ''}]`,
      `\`\`\`shell\n${context.command}\n\`\`\``,
      context.output ? `Output:\n\`\`\`text\n${context.output}\n\`\`\`` : '',
    ].filter(Boolean).join('\n'),
  },
  'git-ref': {
    injectionMode: 'attached',
    presentation: context => basePresentation(context.refValue, `Git ${context.refType}`, GitBranch, 'gray'),
    serializeForModel: context => `[Git ${context.refType}: ${context.refValue}${context.commitHash ? ` (${context.commitHash})` : ''}]`,
  },
  url: {
    injectionMode: 'attached',
    presentation: context => basePresentation(context.title || context.url, context.url, Link, 'blue', true),
    serializeForModel: context => `[URL: ${context.url}]`,
    createWorkspaceItem: (context, options) => markdownWorkspaceItem(
      context,
      context.title || context.url,
      [
        `# ${context.title || context.url}`,
        '',
        context.description || '',
        '',
        context.url,
      ].filter(Boolean).join('\n'),
      options,
    ),
  },
  'web-element': {
    injectionMode: 'inline',
    presentation: context => basePresentation(`<${context.tagName}>`, context.path, Braces, 'green'),
    serializeForModel: context => [
      `[Web Element: <${context.tagName}>]`,
      `CSS Path: ${context.path}`,
      context.sourceUrl ? `Source URL: ${context.sourceUrl}` : '',
      context.textContent ? `Text Content: ${context.textContent}` : '',
      context.outerHTML ? `Outer HTML:\n\`\`\`html\n${context.outerHTML}\n\`\`\`` : '',
    ].filter(Boolean).join('\n'),
  },
  'product-app-preview-element-selection': {
    injectionMode: 'inline',
    presentation: context => basePresentation(
      context.element.label || context.element.textContent || context.appName || context.appId,
      `${context.appName || context.appId} · ${context.route}`,
      MousePointer2,
      'green',
    ),
    serializeForModel: context => [
      `[Product App Preview Element: ${context.appName || context.appId} @ ${context.route}]`,
      `Selector: ${context.element.selectorPath}`,
      `Confidence: ${context.confidence}`,
      `Fingerprint: ${JSON.stringify(context.fingerprint)}`,
      `Element Summary:\n\`\`\`json\n${JSON.stringify(context.element, null, 2)}\n\`\`\``,
    ].join('\n'),
  },
  'intent-canvas': {
    injectionMode: 'attached',
    presentation: context => basePresentation(
      context.rootNodeLabel || context.title,
      `${context.nodeCount} nodes · ${context.scope}`,
      Network,
      'purple',
      true,
    ),
    serializeForModel: context => [
      `[Intent Canvas: ${context.title}]`,
      `Canvas: ${context.canvasId}; revision=${context.revision}; scope=${context.scope}`,
      context.rootNodeId ? `Root node: ${context.rootNodeId}` : '',
      context.selectedNodeIds?.length ? `Selected nodes: ${context.selectedNodeIds.join(', ')}` : '',
      context.serializedContent,
    ].filter(Boolean).join('\n'),
    createWorkspaceItem: (context, options) => markdownWorkspaceItem(
      context,
      context.title,
      context.serializedContent,
      options,
    ),
  },
  'spreadsheet-focus': {
    injectionMode: 'out-of-band',
    presentation: context => basePresentation(
      `${context.sheetName}!${context.a1}`,
      `${context.mode || 'inspect'} · ${context.cacheComplete ? 'complete cache' : 'partial cache'}`,
      Sheet,
      'green',
    ),
    serializeForModel: formatSpreadsheetFocusContext,
  },
};

export function getContextPresentation(
  context: ContextItem,
  t: TFunction<'flow-chat'>,
): ContextPresentation {
  const adapter = adapters[context.type] as ContextTypeAdapter<ContextItem>;
  return adapter.presentation(context, t);
}

/** Concise content-owned title shared by inline, tray, and Peek surfaces. */
export function getContextDisplayTitle(
  context: ContextItem,
  t: TFunction<'flow-chat'>,
): string {
  switch (context.type) {
    case 'text-fragment':
      return context.content.split(/\r?\n/).find(line => line.trim())?.trim()
        || getContextPresentation(context, t).label;
    case 'url':
      return context.title || context.url;
    case 'code-snippet':
      return `${context.fileName}:${context.startLine}-${context.endLine}`;
    case 'intent-canvas':
      return context.title;
    case 'image':
      return context.imageName;
    default:
      return getContextPresentation(context, t).label;
  }
}

export function getContextInjectionMode(context: ContextItem): ContextInjectionMode {
  return (adapters[context.type] as ContextTypeAdapter<ContextItem>).injectionMode;
}

export function openComposerContext(
  context: ContextItem,
  options: OpenContextOptions,
): void {
  const adapter = adapters[context.type] as ContextTypeAdapter<ContextItem>;
  if (adapter.open) {
    void adapter.open(context, options);
    return;
  }
  openComposerContextWorkspace(context, options, 'docked');
}

function createContextWorkspaceItem(
  context: ContextItem,
  options: OpenContextOptions,
): ComposerWorkspaceItemDescriptor {
  const adapter = adapters[context.type] as ContextTypeAdapter<ContextItem>;
  if (adapter.createWorkspaceItem) return adapter.createWorkspaceItem(context, options);
  return markdownWorkspaceItem(
    context,
    context.type,
    adapter.serializeForModel(context, Date.now()),
    options,
  );
}

export function openComposerContextWorkspace(
  context: ContextItem,
  options: OpenContextOptions,
  presentation: 'docked' | 'scene-focus',
): boolean {
  const item = createContextWorkspaceItem(context, options);
  return requestComposerContextWorkspace({ item, presentation });
}

function contextForReference(
  referenceId: string,
  referencesById: Map<string, ContextReference>,
  assetsById: Map<string, ContextItem>,
): ContextItem | undefined {
  const reference = referencesById.get(referenceId);
  return reference ? assetsById.get(reference.assetId) : undefined;
}

export function createComposerSubmissionEnvelope(
  document: ComposerDocument,
  references: ContextReference[],
  assets: ContextItem[],
  intent: ComposerSubmissionIntent,
  t: TFunction<'flow-chat'>,
  capturedAt = Date.now(),
): ComposerSubmissionEnvelope {
  const referencesById = new Map(references.map(reference => [reference.id, reference]));
  const assetIds = new Set(assets.map(asset => asset.id));

  return {
    schemaVersion: 1,
    intent,
    document: {
      nodes: document.nodes.reduce<ComposerSubmissionEnvelope['document']['nodes']>((nodes, node) => {
        if (node.type === 'text') {
          nodes.push({ type: 'text', text: node.text });
          return nodes;
        }
        const reference = referencesById.get(node.referenceId);
        if (reference && assetIds.has(reference.assetId)) {
          nodes.push({ type: 'attachment_ref', attachmentId: reference.assetId });
        }
        return nodes;
      }, []),
    },
    attachments: assets.map((asset, index) => {
      const modelContent = (adapters[asset.type] as ContextTypeAdapter<ContextItem>)
        .serializeForModel(asset, capturedAt);
      return {
        id: asset.id,
        ordinal: index + 1,
        type: asset.type,
        title: getContextDisplayTitle(asset, t),
        ...(modelContent ? { modelContent } : {}),
        ...(asset.type === 'image' ? { mimeType: asset.mimeType } : {}),
      };
    }),
    createdAt: capturedAt,
  };
}

export function serializeComposerDocumentForModel(
  document: ComposerDocument,
  references: ContextReference[],
  assets: ContextItem[],
  capturedAt = Date.now(),
): string {
  const referencesById = new Map(references.map(reference => [reference.id, reference]));
  const attachmentNumberById = new Map(assets.map((asset, index) => [asset.id, index + 1]));
  const inline = document.nodes.map(node => {
    if (node.type === 'text') return node.text;
    const reference = referencesById.get(node.referenceId);
    if (!reference) return '';
    const attachmentNumber = attachmentNumberById.get(reference.assetId);
    return attachmentNumber ? `[Attachment ${attachmentNumber}]` : '';
  }).join('');

  const attachmentBlocks = assets
    .map((context, index) => {
      const serialized = (adapters[context.type] as ContextTypeAdapter<ContextItem>)
        .serializeForModel(context, capturedAt);
      if (!serialized) return '';
      return `[Attachment ${index + 1}: ${context.type}]\n${serialized}`;
    })
    .filter(Boolean);
  return [inline, ...attachmentBlocks].filter(Boolean).join('\n\n');
}

export function serializeComposerDocumentForDisplay(
  document: ComposerDocument,
  references: ContextReference[],
  assets: ContextItem[],
  t: TFunction<'flow-chat'>,
): string {
  const referencesById = new Map(references.map(reference => [reference.id, reference]));
  const assetsById = new Map(assets.map(asset => [asset.id, asset]));
  const inlineAssetIds = new Set<string>();
  const inline = document.nodes.map(node => {
    if (node.type === 'text') return node.text;
    const reference = referencesById.get(node.referenceId);
    if (!reference) return '';
    const context = contextForReference(node.referenceId, referencesById, assetsById);
    if (context) inlineAssetIds.add(context.id);
    return context ? `[${getContextPresentation(context, t).label}]` : '';
  }).join('');

  const unattached = assets
    .filter(asset => !inlineAssetIds.has(asset.id))
    .map(asset => `[${getContextPresentation(asset, t).label}]`)
    .filter(Boolean);
  return [inline, ...unattached].filter(Boolean).join('\n\n');
}

export function createComposerContextSnapshot(
  document: ComposerDocument,
  references: ContextReference[],
  assets: ContextItem[],
): ComposerContextSnapshot {
  const documentReferenceIds = new Set(getComposerReferenceIds(document));
  const documentReferences = references.filter(reference => documentReferenceIds.has(reference.id));
  const attachmentSnapshots = assets
    .map(asset => {
      const adapter = adapters[asset.type] as ContextTypeAdapter<ContextItem>;
      return adapter.snapshot ? adapter.snapshot(asset) : structuredClone(asset);
    });
  return {
    schemaVersion: 2,
    document: structuredClone(document),
    references: structuredClone(documentReferences),
    assets: attachmentSnapshots,
    createdAt: Date.now(),
  };
}

export function freezeComposerDraftContextEditors(
  snapshot: ComposerContextSnapshot,
  draftKey: string,
): void {
  snapshot.assets.forEach(context => {
    if (context.type !== 'text-fragment') return;
    const duplicateCheckKey = `composer-context:${draftKey}:${context.id}`;
    if (!isComposerContextWorkspaceOpen(duplicateCheckKey)) return;
    const title = `${i18nService.t('flow-chat:input.context.longTextTitle', { defaultValue: 'Long text' })} · ${context.charCount.toLocaleString()}`;
    requestComposerContextWorkspace({
      item: {
        ...markdownWorkspaceItem(context, title, context.content, { readOnly: true }, true),
        duplicateCheckKey,
        metadata: {
          contextId: context.id,
          contextType: context.type,
          submittedAt: snapshot.createdAt,
          duplicateCheckKey,
        },
      },
      presentation: 'docked',
    });
  });
}

export function restoreComposerDraftContextEditors(
  snapshot: ComposerContextSnapshot,
  draftKey: string,
  onUpdate: (contextId: string, updates: Partial<ContextItem>) => void,
): void {
  snapshot.assets.forEach(context => {
    if (context.type !== 'text-fragment') return;
    const duplicateCheckKey = `composer-context:${draftKey}:${context.id}`;
    if (!isComposerContextWorkspaceOpen(duplicateCheckKey)) return;
    const title = i18nService.t('flow-chat:input.context.longTextTitle', { defaultValue: 'Long text' });
    requestComposerContextWorkspace({
      item: {
        ...markdownWorkspaceItem(context, title, context.content, {
          readOnly: false,
          onUpdate,
        }, false),
        duplicateCheckKey,
      },
      presentation: 'docked',
    });
  });
}
