export type MarkdownExportFormat = 'html' | 'pdf';

const EXPORT_CSS_RULE_MARKERS = [
  '.markdown-renderer',
  '.m-editor-preview-markdown',
  '.markdown-export-document',
  '.markdown-image',
  '.markdown-badge-strip',
  '.inline-code',
  '.code-block',
  '.table-wrapper',
  '.custom-blockquote',
  '.mermaid-block',
  '.katex',
  '.token',
  'code[class*="language-"]',
  'pre[class*="language-"]',
];

const EXPORT_CSS_VARIABLE_PREFIXES = [
  '--ds-',
  '--markdown-',
  '--flowchat-',
  '--m-editor-',
];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function shouldKeepCssRule(cssText: string): boolean {
  if (cssText.startsWith('@page')) {
    return true;
  }

  return EXPORT_CSS_RULE_MARKERS.some((marker) => cssText.includes(marker));
}

function collectCssVariables(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  const computedStyle = window.getComputedStyle(document.documentElement);
  const declarations: string[] = [];

  for (const name of Array.from(computedStyle)) {
    if (!EXPORT_CSS_VARIABLE_PREFIXES.some((prefix) => name.startsWith(prefix))) {
      continue;
    }
    const value = computedStyle.getPropertyValue(name).trim();
    if (value) {
      declarations.push(`  ${name}: ${value};`);
    }
  }

  return declarations.length > 0 ? `:root {\n${declarations.join('\n')}\n}` : '';
}

function collectReadableCssRules(): string {
  if (typeof document === 'undefined') {
    return '';
  }

  const rules: string[] = [];

  for (const sheet of Array.from(document.styleSheets)) {
    let cssRules: CSSRuleList | undefined;
    try {
      cssRules = sheet.cssRules;
    } catch {
      continue;
    }

    for (const rule of Array.from(cssRules)) {
      const cssText = rule.cssText;
      if (shouldKeepCssRule(cssText)) {
        rules.push(cssText);
      }
    }
  }

  return rules.join('\n\n');
}

function getBaseExportCss(format: MarkdownExportFormat): string {
  const isPdf = format === 'pdf';

  return `
html,
body {
  min-height: 100%;
  margin: 0;
  padding: 0;
  background: var(--ds-color-bg-scene, Canvas);
  color: var(--ds-color-text-primary, CanvasText);
}

html {
  color-scheme: var(--markdown-export-color-scheme, light);
}

body {
  font-family: var(--ds-font-family-sans, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

.markdown-export-document {
  box-sizing: border-box;
  width: 100%;
  max-width: ${isPdf ? 'none' : '880px'};
  margin: 0 auto;
  padding: ${isPdf ? '0' : '32px'};
}

.markdown-export-document *,
.markdown-export-document *::before,
.markdown-export-document *::after {
  box-sizing: border-box;
}

.markdown-renderer--static-export {
  cursor: default;
}

.markdown-renderer--static-export .copy-button,
.markdown-renderer--static-export .mermaid-block__actions {
  display: none !important;
}

.markdown-export-document img,
.markdown-export-document svg {
  max-width: 100%;
}

.markdown-export-document table {
  width: 100%;
}

@page {
  size: A4;
  margin: 16mm 15mm;
}

@media print {
  html,
  body {
    background: var(--ds-color-bg-scene, Canvas);
  }

  body {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .markdown-export-document {
    max-width: none;
    padding: 0;
  }

  pre,
  table,
  blockquote,
  img,
  svg,
  .code-block-wrapper,
  .table-wrapper,
  .mermaid-block {
    break-inside: avoid;
    page-break-inside: avoid;
  }
}
`;
}

export function collectMarkdownExportCss(format: MarkdownExportFormat): string {
  const themeType = document.documentElement.getAttribute('data-theme-type');
  const colorScheme = themeType === 'dark' ? 'dark' : 'light';

  return [
    `:root {\n  --markdown-export-color-scheme: ${colorScheme};\n}`,
    collectCssVariables(),
    collectReadableCssRules(),
    getBaseExportCss(format),
  ].filter(Boolean).join('\n\n');
}

export interface BuildMarkdownExportHtmlDocumentOptions {
  title: string;
  bodyHtml: string;
  format: MarkdownExportFormat;
}

export function buildMarkdownExportHtmlDocument({
  title,
  bodyHtml,
  format,
}: BuildMarkdownExportHtmlDocumentOptions): string {
  const themeType = document.documentElement.getAttribute('data-theme-type') || 'light';
  const css = collectMarkdownExportCss(format);

  return [
    '<!DOCTYPE html>',
    `<html lang="en" data-theme-type="${escapeHtml(themeType)}">`,
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `<title>${escapeHtml(title || 'Markdown Export')}</title>`,
    `<style>${css}</style>`,
    '</head>',
    '<body>',
    bodyHtml,
    '</body>',
    '</html>',
  ].join('\n');
}
