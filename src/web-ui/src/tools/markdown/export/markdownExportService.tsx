import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { save } from '@tauri-apps/plugin-dialog';
import { isTauriRuntime } from '@/infrastructure/runtime';
import { markdownExportAPI, workspaceAPI } from '@/infrastructure/api';
import { notificationService } from '@/shared/notification-system';
import { MarkdownExportDocument } from './MarkdownExportDocument';
import {
  buildMarkdownExportHtmlDocument,
  type MarkdownExportFormat,
} from './markdownExportStyles';

const EXPORT_RENDER_TIMEOUT_MS = 10_000;
const EXPORT_RENDER_WIDTH_PX = 960;

export interface MarkdownExportLabels {
  saveTitle: string;
  exported: (destinationPath: string) => string;
  failed: (message: string) => string;
  reveal: string;
  desktopRequired: string;
}

export interface ExportMarkdownDocumentOptions {
  format: MarkdownExportFormat;
  markdown: string;
  title: string;
  basePath?: string;
  filePath?: string;
  fileName?: string;
  labels: MarkdownExportLabels;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return String(error);
}

function replaceMarkdownExtension(pathLike: string, extension: MarkdownExportFormat): string {
  const nextExtension = `.${extension}`;
  if (/\.(md|markdown|mdx)$/i.test(pathLike)) {
    return pathLike.replace(/\.(md|markdown|mdx)$/i, nextExtension);
  }
  if (/\.[^\\/]+$/.test(pathLike)) {
    return pathLike.replace(/\.[^\\/]+$/, nextExtension);
  }
  return `${pathLike}${nextExtension}`;
}

function sanitizeFileName(fileName: string): string {
  const sanitized = fileName
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitized || 'markdown-export';
}

function buildDefaultExportPath(
  format: MarkdownExportFormat,
  filePath?: string,
  fileName?: string,
  title?: string,
): string {
  if (filePath) {
    return replaceMarkdownExtension(filePath, format);
  }

  const sourceName = fileName || title || 'markdown-export';
  return replaceMarkdownExtension(sanitizeFileName(sourceName), format);
}

async function waitForFonts(): Promise<void> {
  try {
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }
  } catch {
    // Font readiness should not block exporting the document body.
  }
}

async function waitForExportDom(rootElement: HTMLElement): Promise<void> {
  const startedAt = performance.now();
  while (performance.now() - startedAt < EXPORT_RENDER_TIMEOUT_MS) {
    const pendingElement = rootElement.querySelector(
      '.mermaid-block--loading, .mermaid-block--streaming, .markdown-image--loading',
    );
    if (!pendingElement) {
      return;
    }
    await delay(80);
  }
}

async function waitForImages(rootElement: HTMLElement): Promise<void> {
  const images = Array.from(rootElement.querySelectorAll('img'));
  await Promise.all(images.map((image) => {
    if (image.complete) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      const finish = () => resolve();
      image.addEventListener('load', finish, { once: true });
      image.addEventListener('error', finish, { once: true });
    });
  }));
}

export async function buildMarkdownExportHtml({
  markdown,
  basePath,
  title,
  format,
}: Pick<ExportMarkdownDocumentOptions, 'markdown' | 'basePath' | 'title' | 'format'>): Promise<string> {
  const host = document.createElement('div');
  host.setAttribute('data-markdown-export-host', 'true');
  host.style.position = 'fixed';
  host.style.left = '-10000px';
  host.style.top = '0';
  host.style.width = `${EXPORT_RENDER_WIDTH_PX}px`;
  host.style.minHeight = '100px';
  host.style.opacity = '0';
  host.style.pointerEvents = 'none';
  host.style.zIndex = '-1';

  document.body.appendChild(host);
  let root: Root | null = null;

  try {
    root = createRoot(host);
    flushSync(() => {
      root?.render(
        <MarkdownExportDocument
          markdown={markdown}
          basePath={basePath}
          format={format}
        />,
      );
    });

    await nextFrame();
    await waitForFonts();
    await waitForExportDom(host);
    await waitForImages(host);
    await nextFrame();
    await nextFrame();

    const documentElement = host.querySelector('.markdown-export-document');
    if (!(documentElement instanceof HTMLElement)) {
      throw new Error('Markdown export document did not render');
    }

    return buildMarkdownExportHtmlDocument({
      title,
      bodyHtml: documentElement.outerHTML,
      format,
    });
  } finally {
    root?.unmount();
    host.remove();
  }
}

export async function exportMarkdownDocument(options: ExportMarkdownDocumentOptions): Promise<string | null> {
  const { format, labels } = options;

  if (!isTauriRuntime()) {
    notificationService.error(labels.desktopRequired, { duration: 5000 });
    return null;
  }

  try {
    const destinationPath = await save({
      title: labels.saveTitle,
      defaultPath: buildDefaultExportPath(format, options.filePath, options.fileName, options.title),
      filters: [
        {
          name: format === 'html' ? 'HTML' : 'PDF',
          extensions: [format],
        },
      ],
    });

    if (!destinationPath) {
      return null;
    }

    const html = await buildMarkdownExportHtml(options);
    const response = format === 'html'
      ? await markdownExportAPI.exportHtml({ destinationPath, html })
      : await markdownExportAPI.exportPdf({
        destinationPath,
        html,
        options: {
          orientation: 'portrait',
          background: true,
          scale: 1,
          marginTop: 1.6,
          marginBottom: 1.6,
          marginLeft: 1.5,
          marginRight: 1.5,
        },
      });

    notificationService.success(labels.exported(response.destinationPath), {
      duration: 6000,
      actions: [
        {
          label: labels.reveal,
          onClick: () => {
            void workspaceAPI.revealInExplorer(response.destinationPath);
          },
          variant: 'secondary',
        },
      ],
    });

    return response.destinationPath;
  } catch (error) {
    notificationService.error(labels.failed(getErrorMessage(error)));
    return null;
  }
}
