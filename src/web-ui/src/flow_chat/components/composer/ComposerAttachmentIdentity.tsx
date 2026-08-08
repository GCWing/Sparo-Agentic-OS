import type { TFunction } from 'i18next';
import type { ContextItem } from '@/shared/types/context';
import { getImageAssetPreviewUrl } from '@/shared/media/imageAssetStore';
import {
  getContextDisplayTitle,
  getContextPresentation,
} from '../../domain/composerContextRegistry';
import './ComposerAttachmentIdentity.scss';

export type ComposerAttachmentIdentityVariant = 'capsule' | 'preview';

interface ComposerAttachmentIdentityProps {
  asset: ContextItem;
  attachmentNumber: number;
  variant: ComposerAttachmentIdentityVariant;
  t: TFunction<'flow-chat'>;
}

interface ComposerAttachmentIdentityModel {
  attachmentNumber: number;
  attachmentLabel: string;
  title: string;
  previewText?: string;
  thumbnailUrl?: string;
  type: ContextItem['type'];
  typeLabel: string;
  icon: ReturnType<typeof getContextPresentation>['icon'];
}

function compactPreviewText(value: string | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function formatFileSize(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function previewContent(
  asset: ContextItem,
  t: TFunction<'flow-chat'>,
): Pick<ComposerAttachmentIdentityModel, 'title' | 'previewText' | 'thumbnailUrl'> {
  const presentation = getContextPresentation(asset, t);
  switch (asset.type) {
    case 'text-fragment': {
      const lines = asset.content.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const firstLine = lines[0] || '';
      const hasConciseHeading = lines.length > 1 && firstLine.length <= 48;
      return {
        title: hasConciseHeading
          ? firstLine
          : t('input.context.longTextTitle', { defaultValue: 'Long text' }),
        previewText: compactPreviewText(hasConciseHeading ? lines.slice(1).join(' ') : asset.content)
          || presentation.detail,
      };
    }
    case 'image':
      return {
        title: asset.imageName,
        previewText: [
          asset.width && asset.height ? `${asset.width} × ${asset.height}` : '',
          formatFileSize(asset.fileSize),
        ].filter(Boolean).join(' · ') || asset.mimeType,
        thumbnailUrl: getImageAssetPreviewUrl(asset),
      };
    case 'intent-canvas':
      return {
        title: asset.rootNodeLabel || asset.title,
        previewText: compactPreviewText(asset.serializedContent)
          || `${asset.nodeCount} nodes`,
        thumbnailUrl: asset.thumbnailUrl,
      };
    case 'url':
      return {
        title: asset.title || asset.url,
        previewText: compactPreviewText(asset.description) || asset.url,
      };
    case 'code-snippet':
      return {
        title: `${asset.fileName}:${asset.startLine}-${asset.endLine}`,
        previewText: compactPreviewText(asset.selectedText) || asset.filePath,
      };
    case 'file':
      return {
        title: asset.fileName,
        previewText: [asset.relativePath || asset.filePath, formatFileSize(asset.fileSize)]
          .filter(Boolean).join(' · '),
      };
    case 'directory':
      return {
        title: asset.directoryName,
        previewText: [
          asset.directoryPath,
          asset.itemCount === undefined ? '' : `${asset.itemCount} items`,
        ].filter(Boolean).join(' · '),
      };
    case 'terminal-command':
      return {
        title: asset.command,
        previewText: compactPreviewText(asset.output) || asset.workingDirectory || asset.command,
      };
    case 'skill-selection':
      return { title: asset.name, previewText: compactPreviewText(asset.description) || asset.command };
    case 'git-ref':
      return {
        title: asset.refValue,
        previewText: compactPreviewText(asset.commitMessage) || asset.commitHash || `Git ${asset.refType}`,
      };
    case 'web-element':
      return {
        title: compactPreviewText(asset.textContent) || `<${asset.tagName}>`,
        previewText: asset.path || asset.sourceUrl,
      };
    case 'product-app-preview-element-selection':
      return {
        title: asset.element.label || asset.element.textContent || asset.appName || asset.appId,
        previewText: compactPreviewText(asset.element.textContent)
          || asset.element.selectorPath
          || asset.route,
      };
    case 'spreadsheet-focus':
      return {
        title: `${asset.sheetName}!${asset.a1}`,
        previewText: compactPreviewText(asset.previewTsv)
          || `${asset.rowCount} × ${asset.columnCount}`,
      };
  }
}

function identityModel(
  asset: ContextItem,
  attachmentNumber: number,
  variant: ComposerAttachmentIdentityVariant,
  t: TFunction<'flow-chat'>,
): ComposerAttachmentIdentityModel {
  const presentation = getContextPresentation(asset, t);
  const preview = variant === 'preview'
    ? previewContent(asset, t)
    : { title: getContextDisplayTitle(asset, t) };
  return {
    attachmentNumber,
    attachmentLabel: t('input.context.attachmentNumber', {
      number: attachmentNumber,
      defaultValue: 'Attachment {{number}}',
    }),
    ...preview,
    type: asset.type,
    typeLabel: t(`input.context.types.${asset.type}`, { defaultValue: asset.type }),
    icon: presentation.icon,
  };
}

function IdentityContent({
  model,
  variant,
}: {
  model: ComposerAttachmentIdentityModel;
  variant: ComposerAttachmentIdentityVariant;
}) {
  const Icon = model.icon;
  if (variant === 'preview') {
    return (
      <>
        {model.thumbnailUrl ? (
          <img
            className="composer-attachment-identity__thumbnail"
            src={model.thumbnailUrl}
            alt=""
          />
        ) : null}
        <span className="composer-attachment-identity__preview-meta">
          <span className="composer-attachment-identity__preview-heading">
            <span
              className="composer-attachment-identity__number"
              aria-label={model.attachmentLabel}
            >
              {model.attachmentNumber}
            </span>
            <span className="composer-attachment-identity__title" title={model.title}>
              {model.title}
            </span>
          </span>
          {model.previewText ? (
            <span className="composer-attachment-identity__preview-text">
              {model.previewText}
            </span>
          ) : null}
        </span>
      </>
    );
  }

  return (
    <>
      <span
        className="composer-attachment-identity__number"
        aria-label={model.attachmentLabel}
      >
        {model.attachmentNumber}
      </span>
      <span className="composer-attachment-identity__icon" title={model.typeLabel}>
        <Icon aria-hidden="true" size={13} strokeWidth={1.8} />
      </span>
      <span className="composer-attachment-identity__copy">
        <span className="composer-attachment-identity__title" title={model.title}>{model.title}</span>
      </span>
    </>
  );
}

export function ComposerAttachmentIdentity({
  asset,
  attachmentNumber,
  variant,
  t,
}: ComposerAttachmentIdentityProps) {
  const model = identityModel(asset, attachmentNumber, variant, t);
  return (
    <span
      className={[
        'composer-attachment-identity',
        `composer-attachment-identity--${variant}`,
        variant === 'preview' && model.thumbnailUrl
          ? 'composer-attachment-identity--preview-with-thumbnail'
          : '',
      ].filter(Boolean).join(' ')}
      data-context-type={model.type}
    >
      <IdentityContent model={model} variant={variant} />
    </span>
  );
}

/** Populates an existing interactive surface with the shared attachment identity content. */
export function populateComposerAttachmentIdentityContent(
  element: HTMLElement,
  asset: ContextItem,
  attachmentNumber: number,
  variant: ComposerAttachmentIdentityVariant,
  t: TFunction<'flow-chat'>,
): void {
  populateIdentityContent(element, identityModel(asset, attachmentNumber, variant, t), variant);
}

function populateIdentityContent(
  element: HTMLElement,
  model: ComposerAttachmentIdentityModel,
  variant: ComposerAttachmentIdentityVariant,
): void {
  const number = document.createElement('span');
  number.className = 'composer-attachment-identity__number';
  number.setAttribute('aria-label', model.attachmentLabel);
  number.textContent = String(model.attachmentNumber);

  const copy = document.createElement('span');
  copy.className = 'composer-attachment-identity__copy';
  const title = document.createElement('span');
  title.className = 'composer-attachment-identity__title';
  title.textContent = model.title;
  title.title = model.title;
  copy.appendChild(title);
  if (variant === 'capsule') {
    const icon = document.createElement('span');
    icon.className = 'composer-attachment-identity__icon';
    icon.title = model.typeLabel;
    icon.appendChild(createAttachmentTypeIcon(model.type, 13));
    element.replaceChildren(number, icon, copy);
    return;
  }

  element.replaceChildren(number, copy);
}

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

function appendSvgShape(
  svg: SVGSVGElement,
  tag: 'circle' | 'path' | 'rect',
  attributes: Record<string, string>,
): void {
  const shape = document.createElementNS(SVG_NAMESPACE, tag);
  Object.entries(attributes).forEach(([name, value]) => shape.setAttribute(name, value));
  svg.appendChild(shape);
}

function createAttachmentTypeIcon(type: ContextItem['type'], size: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');

  if (type === 'image') {
    appendSvgShape(svg, 'rect', { x: '3', y: '3', width: '18', height: '18', rx: '2' });
    appendSvgShape(svg, 'circle', { cx: '9', cy: '9', r: '2' });
    appendSvgShape(svg, 'path', { d: 'm21 15-5-5L5 21' });
    return svg;
  }
  if (type === 'url') {
    appendSvgShape(svg, 'path', { d: 'M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.1 1.1' });
    appendSvgShape(svg, 'path', { d: 'M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.1-1.1' });
    return svg;
  }
  if (type === 'intent-canvas') {
    appendSvgShape(svg, 'circle', { cx: '12', cy: '5', r: '2' });
    appendSvgShape(svg, 'circle', { cx: '6', cy: '19', r: '2' });
    appendSvgShape(svg, 'circle', { cx: '18', cy: '19', r: '2' });
    appendSvgShape(svg, 'path', { d: 'M12 7v4M12 11 7 17M12 11l5 6' });
    return svg;
  }
  if (type === 'directory') {
    appendSvgShape(svg, 'path', { d: 'M3 6h6l2 2h10v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z' });
    return svg;
  }
  if (type === 'code-snippet' || type === 'web-element') {
    appendSvgShape(svg, 'path', { d: 'm8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14' });
    return svg;
  }

  appendSvgShape(svg, 'path', { d: 'M6 2h9l5 5v15H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z' });
  appendSvgShape(svg, 'path', { d: 'M14 2v6h6M8 13h8M8 17h6' });
  return svg;
}
