const pptxgen = require('pptxgenjs');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { PassThrough } = require('stream');
const { PDFDocument } = require('pdf-lib');
const archiver = require('archiver');

const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const EXPORT_VIEWPORT = { width: 1280, height: 720 };

module.exports = {
  async exportPptx(params) {
    const deck = params?.deck || params || {};
    const pptx = new pptxgen();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.author = 'PPT Live';
    pptx.subject = deck.brief?.topic || deck.title || 'PPT Live deck';
    pptx.title = deck.title || 'PPT Live';
    pptx.company = 'Sparo OS';
    pptx.lang = 'en-US';
    pptx.theme = {
      headFontFace: 'Aptos Display',
      bodyFontFace: 'Aptos',
      lang: 'en-US',
    };

    const slides = Array.isArray(deck.slides) && deck.slides.length > 0 ? deck.slides : [];
    if (slides.some((sourceSlide) => sourceSlide.html)) {
      await exportHtmlSlidesToPptx(pptx, slides);
    } else {
      slides.forEach((sourceSlide, index) => {
        const slide = pptx.addSlide();
        const theme = normalizeTheme(sourceSlide.theme);
        slide.background = { color: hex(theme.background) };
        drawSlideBackdrop(pptx, slide, theme, index);
        drawSlideMethodology(pptx, slide, sourceSlide, theme);
        (sourceSlide.elements || []).forEach((element) => drawElement(pptx, slide, element, theme));
        const notes = buildSpeakerNotes(sourceSlide);
        if (notes && typeof slide.addNotes === 'function') {
          slide.addNotes(notes);
        }
      });
    }

    const base64 = await pptx.write({ outputType: 'base64' });
    return {
      filename: `${fileSafe(deck.title || 'ppt-live')}.pptx`,
      mimeType: MIME,
      base64,
    };
  },

  async exportPdf(params) {
    const deck = params?.deck || params || {};
    const pageBuffers = await renderDeckPages(deck, async (page) => {
      await page.emulateMedia({ media: 'screen' });
      return page.pdf({
        width: `${EXPORT_VIEWPORT.width}px`,
        height: `${EXPORT_VIEWPORT.height}px`,
        printBackground: true,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        preferCSSPageSize: false,
      });
    });
    const merged = await PDFDocument.create();
    for (const buffer of pageBuffers) {
      const source = await PDFDocument.load(buffer);
      const copied = await merged.copyPages(source, source.getPageIndices());
      copied.forEach((page) => merged.addPage(page));
    }
    const bytes = await merged.save();
    return {
      filename: `${fileSafe(deck.title || 'ppt-live')}.pdf`,
      mimeType: 'application/pdf',
      base64: Buffer.from(bytes).toString('base64'),
    };
  },

  async exportPng(params) {
    const deck = params?.deck || params || {};
    const images = await renderDeckPages(deck, async (page, index) => page.screenshot({
      type: 'png',
      fullPage: false,
      clip: { x: 0, y: 0, width: EXPORT_VIEWPORT.width, height: EXPORT_VIEWPORT.height },
    }), { includeIndex: true });
    const zipBuffer = await buildZipBuffer(images.map((item) => ({
      name: `slide-${String(item.index + 1).padStart(2, '0')}.png`,
      buffer: item.buffer,
    })));
    return {
      filename: `${fileSafe(deck.title || 'ppt-live')}-slides.zip`,
      mimeType: 'application/zip',
      base64: zipBuffer.toString('base64'),
    };
  },
};

async function exportHtmlSlidesToPptx(pptx, slides) {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ppt-live-html-'));
  const browser = await launchPptxExportBrowser();
  try {
    const page = await browser.newPage();
    const html2pptx = await loadHtml2Pptx(tmpDir);
    for (const [index, sourceSlide] of slides.entries()) {
      const filePath = path.join(tmpDir, `slide-${String(index + 1).padStart(2, '0')}.html`);
      const result = await convertHtmlSlideWithRetry({
        page,
        html2pptx,
        html: sourceSlide.html,
        filePath,
        pptx,
        tmpDir,
      });
      const notes = buildSpeakerNotes(sourceSlide);
      if (notes && result?.slide && typeof result.slide.addNotes === 'function') {
        result.slide.addNotes(notes);
      }
    }
  } finally {
    await browser.close().catch(() => {});
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function launchPptxExportBrowser() {
  const { chromium } = require('playwright');
  const launchOptions = { env: { TMPDIR: os.tmpdir() } };
  if (process.platform === 'darwin') {
    launchOptions.channel = 'chrome';
  }
  return chromium.launch(launchOptions);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getExportSlideDocs(deck) {
  const slides = Array.isArray(deck?.slides) ? deck.slides : [];
  if (!slides.length) {
    throw new Error('No slides to export');
  }
  return slides.map((slide, index) => ({
    index,
    html: slide?.html
      ? normalizeSlideDocument(slide.html)
      : buildElementSlideDocument(slide),
  }));
}

function buildElementSlideDocument(slide = {}) {
  const theme = normalizeTheme(slide.theme);
  const title = escapeHtml(slide.title || 'Slide');
  const subtitle = escapeHtml(slide.subtitle || slide.claim || '');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  html, body { margin: 0; padding: 0; width: ${EXPORT_VIEWPORT.width}px; height: ${EXPORT_VIEWPORT.height}px; overflow: hidden; }
  body {
    box-sizing: border-box;
    background: ${theme.background};
    color: ${theme.ink};
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    display: grid;
    align-content: center;
    gap: 16px;
    padding: 72px 96px;
  }
  h1 { margin: 0; font-size: 56px; line-height: 1.08; }
  p { margin: 0; font-size: 24px; color: ${theme.muted}; line-height: 1.35; }
</style>
</head>
<body>
  <h1>${title}</h1>
  ${subtitle ? `<p>${subtitle}</p>` : ''}
</body>
</html>`;
}

async function renderDeckPages(deck, capture, options = {}) {
  const docs = getExportSlideDocs(deck);
  const browser = await launchPptxExportBrowser();
  const results = [];
  try {
    const context = await browser.newContext({ viewport: EXPORT_VIEWPORT });
    for (const doc of docs) {
      const page = await context.newPage();
      await page.setContent(doc.html, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(900);
      const buffer = await capture(page, doc.index);
      results.push(options.includeIndex ? { index: doc.index, buffer } : buffer);
      await page.close();
    }
    await context.close();
    return results;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function buildZipBuffer(files) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const stream = new PassThrough();
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
    archive.on('error', reject);
    archive.pipe(stream);
    files.forEach((file) => archive.append(file.buffer, { name: file.name }));
    archive.finalize();
  });
}

function isRetriableHtml2PptxError(error) {
  const message = String(error?.message || error || '');
  if (/validation error/i.test(message)) return true;
  return /not supported in PowerPoint|must be wrapped in <p>|Background images on|CSS gradients are not supported|overflows body|don't match presentation layout|ends too close to bottom|data-pptx-merge|Placeholder .* has (width|height): 0|Multiple validation errors found/i.test(message);
}

async function convertHtmlSlideWithRetry({ page, html2pptx, html, filePath, pptx, tmpDir }) {
  let lastError = null;
  for (const aggressive of [false, true]) {
    const sanitized = await sanitizeSlideHtmlForPptxExport(page, html, { aggressive });
    await fsp.writeFile(filePath, sanitized, 'utf8');
    try {
      return await html2pptx(filePath, pptx, { tmpDir });
    } catch (error) {
      lastError = error;
      if (!aggressive && isRetriableHtml2PptxError(error)) continue;
      throw error;
    }
  }
  throw lastError || new Error('PPT Live html2pptx export failed');
}

async function sanitizeSlidesForPptxExport(htmlSlides, options = {}) {
  const browser = await launchPptxExportBrowser();
  try {
    const page = await browser.newPage();
    const sanitized = [];
    for (const html of htmlSlides) {
      sanitized.push(await sanitizeSlideHtmlForPptxExport(page, html, options));
    }
    return sanitized;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function sanitizeSlideHtmlForPptxExport(page, html, options = {}) {
  await page.setContent(normalizeSlideDocument(html), { waitUntil: 'domcontentloaded' });
  return page.evaluate(({ aggressive }) => {
    const skipTags = new Set(['SCRIPT', 'STYLE', 'PRE', 'CODE', 'SVG', 'TEXTAREA']);
    const inlineSelector = 'strong,b,em,i,u,span,a,small,mark,sub,sup,code';
    const textSelector = 'p,h1,h2,h3,h4,h5,h6,li';

    function inferBlockTag(node) {
      const cls = String(node.className || '').toLowerCase();
      const role = String(node.getAttribute?.('role') || '').toLowerCase();
      if (/h1|title|headline|hero/.test(cls) || role === 'heading') return 'h1';
      if (/h2|subtitle|subhead|section-title/.test(cls)) return 'h2';
      if (/h3|kicker|eyebrow|label|caption/.test(cls)) return 'h3';
      return 'p';
    }

    function ensureExportCanvas() {
      const body = document.body;
      if (!body) return;
      body.style.width = '1280px';
      body.style.height = '720px';
      body.style.margin = '0';
      body.style.padding = '0';
      body.style.overflow = 'hidden';
      body.style.position = 'relative';
      document.documentElement.style.margin = '0';
      document.documentElement.style.padding = '0';
    }

    function wrapDirectTextNodes(root) {
      root.querySelectorAll('div').forEach((div) => {
        if (skipTags.has(div.tagName)) return;
        [...div.childNodes].forEach((node) => {
          if (node.nodeType !== Node.TEXT_NODE) return;
          const text = node.textContent.replace(/\s+/g, ' ').trim();
          if (!text) {
            node.remove();
            return;
          }
          const block = document.createElement(inferBlockTag(div));
          block.textContent = text;
          div.replaceChild(block, node);
        });
      });
    }

    function normalizeInlineLists(root) {
      root.querySelectorAll('div').forEach((div) => {
        const onlySpans = [...div.children].length > 0
          && [...div.children].every((child) => child.tagName === 'SPAN' || child.tagName === 'BR');
        const text = div.textContent.replace(/\s+/g, ' ').trim();
        if (!onlySpans || !text || div.querySelector('ul,ol,p,h1,h2,h3,h4,h5,h6')) return;
        const items = text.split(/\s*[•·▪-]\s+/).map((item) => item.trim()).filter(Boolean);
        if (items.length >= 2) {
          const ul = document.createElement('ul');
          items.forEach((item) => {
            const li = document.createElement('li');
            li.textContent = item;
            ul.appendChild(li);
          });
          div.replaceChildren(ul);
        }
      });
    }

    function hasVisibleBorder(computed) {
      return ['Top', 'Right', 'Bottom', 'Left'].some((side) => parseFloat(computed[`border${side}Width`] || 0) > 0);
    }

    function hoistTextDecorations(root) {
      root.querySelectorAll(textSelector).forEach((el) => {
        const computed = window.getComputedStyle(el);
        const hasBg = computed.backgroundColor && computed.backgroundColor !== 'rgba(0, 0, 0, 0)';
        const hasBgImage = computed.backgroundImage && computed.backgroundImage !== 'none';
        const hasBorder = hasVisibleBorder(computed);
        const hasShadow = computed.boxShadow && computed.boxShadow !== 'none';
        if (!hasBg && !hasBgImage && !hasBorder && !hasShadow) return;
        const wrapper = document.createElement('div');
        if (hasBg || hasBgImage) {
          wrapper.style.background = computed.background;
          wrapper.style.backgroundColor = computed.backgroundColor;
        }
        if (hasBgImage && !String(computed.backgroundImage || '').includes('gradient')) {
          wrapper.style.backgroundImage = 'none';
        }
        if (hasBorder) wrapper.style.border = computed.border;
        if (computed.borderRadius) wrapper.style.borderRadius = computed.borderRadius;
        if (hasShadow) wrapper.style.boxShadow = computed.boxShadow;
        if (computed.padding) wrapper.style.padding = computed.padding;
        el.style.background = 'transparent';
        el.style.backgroundColor = 'transparent';
        el.style.backgroundImage = 'none';
        el.style.border = 'none';
        el.style.boxShadow = 'none';
        el.style.padding = '0';
        el.parentNode.insertBefore(wrapper, el);
        wrapper.appendChild(el);
      });
    }

    function flattenGradients(root) {
      root.querySelectorAll('*').forEach((el) => {
        const computed = window.getComputedStyle(el);
        const bgImage = computed.backgroundImage || '';
        if (!bgImage.includes('gradient')) return;
        const colorMatch = bgImage.match(/#[0-9a-f]{3,8}|rgba?\([^)]+\)/i);
        el.style.backgroundImage = 'none';
        if (colorMatch) {
          el.style.backgroundColor = colorMatch[0];
        } else if (computed.backgroundColor && computed.backgroundColor !== 'rgba(0, 0, 0, 0)') {
          el.style.backgroundColor = computed.backgroundColor;
        }
      });
    }

    function stripUnsupportedDivBackgrounds(root) {
      root.querySelectorAll('div').forEach((el) => {
        const computed = window.getComputedStyle(el);
        const bgImage = computed.backgroundImage;
        if (!bgImage || bgImage === 'none') return;
        el.style.backgroundImage = 'none';
        if (computed.backgroundColor && computed.backgroundColor !== 'rgba(0, 0, 0, 0)') {
          el.style.backgroundColor = computed.backgroundColor;
        }
      });
    }

    function resetInlineBoxModel(root) {
      root.querySelectorAll(inlineSelector).forEach((el) => {
        el.style.setProperty('margin', '0', 'important');
        el.style.setProperty('padding', '0', 'important');
        el.style.setProperty('border', 'none', 'important');
        el.style.setProperty('box-shadow', 'none', 'important');
        el.style.setProperty('background', 'transparent', 'important');
        el.style.setProperty('background-color', 'transparent', 'important');
        el.style.setProperty('background-image', 'none', 'important');
        if (window.getComputedStyle(el).display === 'block') {
          el.style.setProperty('display', 'inline', 'important');
        }
      });
    }

    function stripInlineClasses(root) {
      root.querySelectorAll(inlineSelector).forEach((el) => {
        el.removeAttribute('class');
        el.removeAttribute('style');
      });
    }

    function stripAuthorStylesheets(root) {
      root.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
        if (node.id === 'ppt-live-export-safe-styles') return;
        node.remove();
      });
    }

    function enforceInlineElementsSafe(root) {
      root.querySelectorAll(inlineSelector).forEach((el) => {
        const computed = window.getComputedStyle(el);
        const hasBadMargin = ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'].some(
          (prop) => parseFloat(computed[prop]) > 0,
        );
        const hasBadPadding = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].some(
          (prop) => parseFloat(computed[prop]) > 0,
        );
        const hasBorder = hasVisibleBorder(computed);
        const hasBg = computed.backgroundColor && computed.backgroundColor !== 'rgba(0, 0, 0, 0)';
        const hasBgImage = computed.backgroundImage && computed.backgroundImage !== 'none';
        if (!hasBadMargin && !hasBadPadding && !hasBorder && !hasBg && !hasBgImage) return;

        const tag = el.tagName.toLowerCase();
        const clean = document.createElement(tag);
        clean.textContent = el.textContent;
        el.replaceWith(clean);
      });
    }

    function inlineSnapshotLayoutStyles(root) {
      root.querySelectorAll('body, body *').forEach((el) => {
        if (skipTags.has(el.tagName)) return;
        const computed = window.getComputedStyle(el);
        const style = el.style;
        if (computed.position && computed.position !== 'static') style.position = computed.position;
        if (computed.display && computed.display !== 'inline') style.display = computed.display;
        ['left', 'top', 'right', 'bottom', 'width', 'height', 'maxWidth', 'maxHeight'].forEach((prop) => {
          const value = computed[prop];
          if (value && value !== 'auto' && value !== 'none' && value !== '0px') {
            style[prop] = value;
          }
        });
        if (computed.zIndex && computed.zIndex !== 'auto') style.zIndex = computed.zIndex;
        if (computed.color) style.color = computed.color;
        if (computed.fontSize) style.fontSize = computed.fontSize;
        if (computed.fontWeight) style.fontWeight = computed.fontWeight;
        if (computed.fontFamily) style.fontFamily = computed.fontFamily;
        if (computed.lineHeight && computed.lineHeight !== 'normal') style.lineHeight = computed.lineHeight;
        if (computed.textAlign) style.textAlign = computed.textAlign;
        const bg = computed.backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)') style.backgroundColor = bg;
        if (computed.border && computed.border !== 'none' && hasVisibleBorder(computed)) {
          style.border = computed.border;
        }
        if (computed.borderRadius && computed.borderRadius !== '0px') {
          style.borderRadius = computed.borderRadius;
        }
        if (computed.padding && computed.padding !== '0px') style.padding = computed.padding;
        if (computed.gap && computed.gap !== 'normal') style.gap = computed.gap;
        if (computed.flexDirection && computed.flexDirection !== 'row') {
          style.flexDirection = computed.flexDirection;
        }
        if (computed.alignItems && computed.alignItems !== 'normal') {
          style.alignItems = computed.alignItems;
        }
        if (computed.justifyContent && computed.justifyContent !== 'normal') {
          style.justifyContent = computed.justifyContent;
        }
      });
    }

    function injectExportSafeStyles(root) {
      const styleId = 'ppt-live-export-safe-styles';
      root.getElementById(styleId)?.remove();
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        ${inlineSelector}, [class] ${inlineSelector.split(',').join(', [class] ')} {
          margin: 0 !important;
          padding: 0 !important;
          border: none !important;
          box-shadow: none !important;
          background: transparent !important;
          background-color: transparent !important;
          background-image: none !important;
        }
        p, h1, h2, h3, h4, h5, h6, li {
          box-shadow: none !important;
        }
      `;
      (root.head || root.documentElement).appendChild(style);
    }

    ensureExportCanvas();
    wrapDirectTextNodes(document);
    normalizeInlineLists(document);
    hoistTextDecorations(document);
    flattenGradients(document);
    stripUnsupportedDivBackgrounds(document);
    stripInlineClasses(document);
    resetInlineBoxModel(document);
    enforceInlineElementsSafe(document);
    injectExportSafeStyles(document);
    enforceInlineElementsSafe(document);
    if (aggressive) {
      inlineSnapshotLayoutStyles(document);
      document.querySelectorAll('[class]').forEach((el) => el.removeAttribute('class'));
      stripAuthorStylesheets(document);
      stripInlineClasses(document);
      resetInlineBoxModel(document);
      enforceInlineElementsSafe(document);
      injectExportSafeStyles(document);
    }
    return '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
  }, { aggressive: Boolean(options.aggressive) });
}

async function loadHtml2Pptx(tmpDir) {
  const sourcePath = path.join(__dirname, 'skills', 'ppt-design', 'scripts', 'html2pptx.js');
  const cjsPath = path.join(tmpDir, 'html2pptx.cjs');
  const source = await fsp.readFile(sourcePath, 'utf8');
  const patchedSource = source
    .replace("require('playwright')", `require(${JSON.stringify(require.resolve('playwright'))})`)
    .replace("require('sharp')", `require(${JSON.stringify(require.resolve('sharp'))})`);
  await fsp.writeFile(cjsPath, patchedSource, 'utf8');
  const html2pptx = require(cjsPath);
  if (typeof html2pptx !== 'function') {
    throw new Error('ppt-design html2pptx converter is not available');
  }
  return html2pptx;
}

function normalizeSlideDocument(html) {
  const source = String(html || '').trim();
  if (!source) return '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body></body></html>';
  if (/<!doctype|<html[\s>]/i.test(source)) return source;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${source}</body></html>`;
}

function drawSlideBackdrop(pptx, slide, theme, index) {
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: SLIDE_W,
    h: SLIDE_H,
    fill: { color: hex(theme.background) },
    line: { color: hex(theme.background), transparency: 100 },
  });
  slide.addShape(pptx.ShapeType.ellipse, {
    x: 10.3,
    y: -0.45,
    w: 3.8,
    h: 3.8,
    fill: { color: hex(index % 2 ? theme.accent : theme.primary), transparency: 84 },
    line: { color: hex(theme.background), transparency: 100 },
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 0.12,
    h: SLIDE_H,
    fill: { color: hex(theme.primary), transparency: 0 },
    line: { color: hex(theme.primary), transparency: 100 },
  });
}

function drawSlideMethodology(pptx, slide, sourceSlide, theme) {
  if (sourceSlide.kicker) {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 0.96,
      y: 0.48,
      w: 0.22,
      h: 0.07,
      fill: { color: hex(theme.primary) },
      line: { color: hex(theme.primary), transparency: 100 },
    });
    slide.addText(String(sourceSlide.kicker).toUpperCase(), {
      x: 1.24,
      y: 0.36,
      w: 2.4,
      h: 0.28,
      margin: 0,
      fontFace: 'Aptos',
      fontSize: 7,
      bold: true,
      color: hex(theme.primary),
      fit: 'shrink',
    });
  }
  if (sourceSlide.proofObject) {
    slide.addText(String(sourceSlide.proofObject), {
      x: 9.26,
      y: 0.34,
      w: 2.95,
      h: 0.32,
      margin: 0.04,
      fontFace: 'Aptos',
      fontSize: 7,
      bold: true,
      color: hex(theme.muted),
      align: 'right',
      fit: 'shrink',
      fill: { color: hex(theme.panel), transparency: 8 },
      line: { color: hex(theme.primary), transparency: 78 },
    });
  }
  if (sourceSlide.sourceNote) {
    slide.addText(String(sourceSlide.sourceNote), {
      x: 0.96,
      y: 7.05,
      w: 10.7,
      h: 0.2,
      margin: 0,
      fontFace: 'Aptos',
      fontSize: 6,
      color: hex(theme.muted),
      fit: 'shrink',
    });
  }
}

function buildSpeakerNotes(sourceSlide) {
  return [
    sourceSlide.notes,
    sourceSlide.claim ? `Claim: ${sourceSlide.claim}` : '',
    sourceSlide.proofObject ? `Proof object: ${sourceSlide.proofObject}` : '',
    sourceSlide.supportNote ? `Support note: ${sourceSlide.supportNote}` : '',
    sourceSlide.sourceNote ? `Source note: ${sourceSlide.sourceNote}` : '',
  ].filter(Boolean).join('\n\n');
}

function drawElement(pptx, slide, element, theme) {
  const box = toInches(element);
  const style = element.style || {};
  const common = {
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    margin: 0.08,
    fit: 'shrink',
    color: hex(resolveColor(style.color, theme)),
    fontFace: 'Aptos',
    fontSize: pxToPt(style.fontSize || 22),
    bold: Number(style.fontWeight || 500) >= 700,
    align: style.align || 'left',
    valign: 'mid',
    breakLine: false,
  };
  if (element.type === 'shape') {
    slide.addShape(pptx.ShapeType.roundRect, {
      ...box,
      rectRadius: 0.08,
      fill: { color: hex(resolveColor(style.background, theme)), transparency: transparency(style.opacity) },
      line: { color: hex(resolveColor(style.background, theme)), transparency: 100 },
    });
    if (element.text) slide.addText(element.text, common);
    return;
  }
  if (element.type === 'list') {
    const runs = (element.items || []).map((item) => ({ text: item, options: { bullet: { type: 'bullet' }, breakLine: true } }));
    slide.addText(runs.length ? runs : [{ text: '' }], {
      ...common,
      valign: 'top',
      paraSpaceAfterPt: 6,
      fit: 'shrink',
    });
    return;
  }
  if (element.type === 'metric') {
    drawPanel(pptx, slide, box, style, theme);
    slide.addText(String(element.text || ''), {
      ...common,
      y: box.y + 0.08,
      h: box.h * 0.48,
      color: hex(resolveColor(style.color || 'primary', theme)),
      fontSize: pxToPt(style.fontSize || 42),
      bold: true,
    });
    slide.addText(String(element.label || ''), {
      ...common,
      y: box.y + box.h * 0.56,
      h: box.h * 0.34,
      color: hex(theme.muted),
      fontSize: 10,
      bold: false,
      valign: 'top',
    });
    return;
  }
  if (element.type === 'chart') {
    drawPanel(pptx, slide, box, style, theme);
    slide.addText(String(element.text || ''), {
      ...common,
      y: box.y + 0.1,
      h: 0.32,
      fontSize: 11,
      bold: true,
    });
    drawBars(pptx, slide, element, box, theme);
    return;
  }
  if (element.type === 'media') {
    slide.addShape(pptx.ShapeType.roundRect, {
      ...box,
      fill: { color: hex(resolveColor(style.background || 'soft', theme)), transparency: 10 },
      line: { color: hex(theme.primary), transparency: 55, dash: 'dash' },
    });
    slide.addText(String(element.text || 'Image placeholder'), {
      ...common,
      align: 'center',
      color: hex(theme.muted),
      fontSize: 12,
    });
    return;
  }
  drawTextBackground(pptx, slide, box, style, theme);
  slide.addText(String(element.text || ''), common);
}

function drawPanel(pptx, slide, box, style, theme) {
  slide.addShape(pptx.ShapeType.roundRect, {
    ...box,
    fill: { color: hex(resolveColor(style.background || 'panel', theme)), transparency: transparency(style.opacity) },
    line: { color: hex(theme.primary), transparency: 82 },
    shadow: { type: 'outer', color: '111827', opacity: 0.12, blur: 1, angle: 45, distance: 1 },
  });
}

function drawTextBackground(pptx, slide, box, style, theme) {
  const bg = style.background || 'transparent';
  if (bg === 'transparent') return;
  slide.addShape(pptx.ShapeType.roundRect, {
    ...box,
    fill: { color: hex(resolveColor(bg, theme)), transparency: transparency(style.opacity) },
    line: { color: hex(resolveColor(bg, theme)), transparency: 100 },
  });
}

function drawBars(pptx, slide, element, box, theme) {
  const data = Array.isArray(element.data) && element.data.length ? element.data : [{ label: 'A', value: 40 }, { label: 'B', value: 70 }];
  const max = Math.max(1, ...data.map((point) => Number(point.value) || 0));
  const gap = 0.1;
  const chartX = box.x + 0.18;
  const chartY = box.y + 0.68;
  const chartW = box.w - 0.36;
  const chartH = box.h - 0.95;
  const barW = Math.max(0.08, (chartW - gap * (data.length - 1)) / data.length);
  data.forEach((point, index) => {
    const value = Number(point.value) || 0;
    const h = Math.max(0.15, (value / max) * chartH);
    const x = chartX + index * (barW + gap);
    const y = chartY + chartH - h;
    slide.addShape(pptx.ShapeType.rect, {
      x,
      y,
      w: barW,
      h,
      fill: { color: hex(index % 2 ? theme.accent : theme.primary) },
      line: { color: hex(index % 2 ? theme.accent : theme.primary), transparency: 100 },
    });
    slide.addText(String(point.label || ''), {
      x: x - 0.03,
      y: chartY + chartH + 0.04,
      w: barW + 0.06,
      h: 0.2,
      fontSize: 7,
      color: hex(theme.muted),
      align: 'center',
      margin: 0,
      fit: 'shrink',
    });
  });
}

function normalizeTheme(theme = {}) {
  return {
    background: theme.background || '#fbfcff',
    ink: theme.ink || '#111827',
    muted: theme.muted || '#5b6575',
    primary: theme.primary || '#0f766e',
    accent: theme.accent || '#f97316',
    panel: theme.panel || '#ffffff',
  };
}

function toInches(element) {
  return {
    x: pct(element.x) * SLIDE_W,
    y: pct(element.y) * SLIDE_H,
    w: pct(element.w) * SLIDE_W,
    h: pct(element.h) * SLIDE_H,
  };
}

function pct(value) {
  return Math.max(0, Math.min(100, Number(value) || 0)) / 100;
}

function pxToPt(value) {
  return Math.max(6, Math.min(66, Math.round((Number(value) || 22) * 0.58)));
}

function resolveColor(value, theme) {
  if (!value || value === 'transparent') return theme.background;
  if (value === 'ink') return theme.ink;
  if (value === 'muted') return theme.muted;
  if (value === 'primary') return theme.primary;
  if (value === 'accent') return theme.accent;
  if (value === 'panel') return theme.panel;
  if (value === 'soft') return theme.primary;
  if (value === 'background') return theme.background;
  return value;
}

function hex(value) {
  const raw = String(value || '#111827').trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.slice(1).toUpperCase();
  if (/^[0-9a-f]{6}$/i.test(raw)) return raw.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(raw)) {
    return raw.slice(1).split('').map((part) => part + part).join('').toUpperCase();
  }
  return '111827';
}

function transparency(opacity) {
  return Math.round((1 - Math.max(0, Math.min(1, Number(opacity ?? 1)))) * 100);
}

function fileSafe(value) {
  return String(value || 'ppt-live').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 96);
}
