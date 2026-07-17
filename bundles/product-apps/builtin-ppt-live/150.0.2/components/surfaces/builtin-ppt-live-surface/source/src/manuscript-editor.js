import { getLocale } from './i18n.js';

const DOCUMENT_ID = 'manuscript';
const ROUTE = '/manuscript';

const COPY = {
  'zh-CN': {
    eyebrow: '文本轨',
    title: 'PPT 文本稿',
    loading: '正在读取受管 Markdown…',
    preview: '预览',
    edit: '编辑',
    split: '分栏',
    reload: '重新载入',
    save: '保存',
    saving: '保存中…',
    unsaved: '未保存',
    empty: '文本稿为空。',
    ready: '文本稿已同步',
    saved: '文本稿已保存。视觉稿会收到新的修订通知。',
    loadFailed: '无法读取文本稿，请确认当前工作已由 PPT Live 打开。',
    saveFailed: '保存失败，本地草稿仍然保留。',
    invalid: '文本稿格式未通过校验，请按下方行号修正后再保存。',
    conflict: '远端文本稿已有新修订。本地草稿未被覆盖；请载入最新版本后再合并。',
    discardConfirm: '当前有未保存修改。再次点击“载入最新”将放弃本地草稿。',
    loadLatest: '载入最新',
    managed: '受管 Markdown',
    revision: '修订',
    generated: 'Agent 已先更新文本规划，视觉页将按该修订生成。',
  },
  'en-US': {
    eyebrow: 'TEXT TRACK',
    title: 'Presentation manuscript',
    loading: 'Loading managed Markdown…',
    preview: 'Preview',
    edit: 'Edit',
    split: 'Split',
    reload: 'Reload',
    save: 'Save',
    saving: 'Saving…',
    unsaved: 'Unsaved',
    empty: 'The manuscript is empty.',
    ready: 'Manuscript synced',
    saved: 'Manuscript saved. The visual track has been notified of the revision.',
    loadFailed: 'Could not load the manuscript. Open this work through PPT Live and try again.',
    saveFailed: 'Save failed. Your local draft has been preserved.',
    invalid: 'The manuscript did not pass validation. Fix the listed lines and save again.',
    conflict: 'A newer manuscript revision exists. Your local draft was preserved; load the latest version before merging.',
    discardConfirm: 'You have unsaved changes. Choose “Load latest” to discard the local draft.',
    loadLatest: 'Load latest',
    managed: 'Managed Markdown',
    revision: 'revision',
    generated: 'The Agent updated the text plan first; visual slides will follow this revision.',
  },
};

let currentDocument = null;
let pendingRemoteDocument = null;
let dirty = false;
let loading = false;
let saving = false;
let activeMode = 'preview';
let bound = false;
let routeResolved = false;
let visualInitialized = false;
let onVisualRoute = null;
let onManuscriptCommitted = null;

const $ = (id) => document.getElementById(id);
const runtime = () => window.app || {};

function strings() {
  return getLocale() === 'zh-CN' ? COPY['zh-CN'] : COPY['en-US'];
}

function manuscriptApi() {
  const api = runtime().deck?.manuscript;
  return api && typeof api.get === 'function' && typeof api.commit === 'function' ? api : null;
}

function normalizeDocument(value) {
  if (!value || typeof value !== 'object') return null;
  const revision = Number(value.revision);
  const content = typeof value.content === 'string' ? value.content : '';
  const contentHash = typeof value.contentHash === 'string' ? value.contentHash : '';
  if (!Number.isSafeInteger(revision) || revision < 0 || !contentHash) return null;
  return {
    documentId: String(value.documentId || DOCUMENT_ID),
    deckId: String(value.deckId || ''),
    relativePath: String(value.relativePath || 'manuscript.md'),
    content,
    revision,
    contentHash,
    updatedAtMs: Number(value.updatedAtMs) || 0,
    diagnostics: Array.isArray(value.diagnostics) ? value.diagnostics : [],
  };
}

function setBusyState() {
  const editor = $('manuscriptEditor');
  const save = $('saveManuscript');
  const reload = $('reloadManuscript');
  if (editor) editor.disabled = loading || saving;
  if (save) {
    save.disabled = loading || saving || !dirty || !currentDocument;
    save.textContent = saving ? strings().saving : strings().save;
  }
  if (reload) reload.disabled = loading || saving;
}

function setDirty(next) {
  dirty = Boolean(next);
  const badge = $('manuscriptDirtyBadge');
  if (badge) badge.hidden = !dirty;
  setBusyState();
}

function setNotice(message = '', { error = false, conflict = false } = {}) {
  const notice = $('manuscriptNotice');
  const text = $('manuscriptNoticeText');
  const resolve = $('resolveManuscriptConflict');
  if (!notice || !text || !resolve) return;
  notice.hidden = !message;
  notice.classList.toggle('is-error', error);
  text.textContent = message;
  resolve.hidden = !conflict;
  resolve.textContent = strings().loadLatest;
}

function updateMetadata() {
  const copy = strings();
  const meta = $('manuscriptMeta');
  const sync = $('manuscriptSyncState');
  if (!currentDocument) {
    if (meta) meta.textContent = loading ? copy.loading : copy.loadFailed;
    if (sync) sync.textContent = `${copy.managed} · ${copy.revision} —`;
    return;
  }
  const updated = currentDocument.updatedAtMs
    ? new Date(currentDocument.updatedAtMs).toLocaleString(getLocale())
    : '';
  if (meta) {
    meta.textContent = `${currentDocument.relativePath} · ${copy.revision} ${currentDocument.revision}${updated ? ` · ${updated}` : ''}`;
  }
  if (sync) sync.textContent = `${copy.managed} · ${copy.revision} ${currentDocument.revision} · ${currentDocument.contentHash.slice(0, 19)}…`;
}

function renderDiagnostics(diagnostics = []) {
  const list = $('manuscriptDiagnostics');
  if (!list) return;
  list.replaceChildren();
  diagnostics.slice(0, 4).forEach((diagnostic) => {
    const item = document.createElement('li');
    const line = diagnostic?.line ? `L${diagnostic.line} · ` : '';
    item.textContent = `${line}${diagnostic?.message || diagnostic?.code || 'Invalid manuscript'}`;
    item.title = item.textContent;
    list.append(item);
  });
}

function diagnosticsFromCommitError(message) {
  const marker = 'ppt.manuscript.invalid:';
  const markerIndex = message.indexOf(marker);
  if (markerIndex < 0) return [];
  const start = message.indexOf('[', markerIndex + marker.length);
  const end = message.lastIndexOf(']');
  if (start < 0 || end < start) return [];
  try {
    const diagnostics = JSON.parse(message.slice(start, end + 1));
    return Array.isArray(diagnostics) ? diagnostics : [];
  } catch {
    return [];
  }
}

function appendTextBlock(parent, tag, text, className = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  parent.append(node);
  return node;
}

function renderMarkdown(content) {
  const preview = $('manuscriptPreview');
  if (!preview) return;
  const root = document.createElement('div');
  root.className = 'manuscript-preview__document';
  const lines = String(content || '').replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  let index = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.slice(1).findIndex((line) => line.trim() === '---');
    if (end >= 0) {
      appendTextBlock(root, 'pre', lines.slice(1, end + 1).join('\n'), 'manuscript-preview__frontmatter');
      index = end + 2;
    }
  }
  let list = null;
  let code = null;
  const closeList = () => { list = null; };
  for (; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      closeList();
      if (code) {
        code = null;
      } else {
        const pre = document.createElement('pre');
        code = document.createElement('code');
        pre.append(code);
        root.append(pre);
      }
      continue;
    }
    if (code) {
      code.textContent += `${code.textContent ? '\n' : ''}${line}`;
      continue;
    }
    if (!trimmed) {
      closeList();
      continue;
    }
    const marker = trimmed.match(/^<!--\s*ppt:(?:slide|chapter)\b.*-->$/);
    if (marker) {
      closeList();
      appendTextBlock(root, 'p', trimmed, 'manuscript-preview__marker');
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      closeList();
      appendTextBlock(root, `h${heading[1].length}`, heading[2].trim());
      continue;
    }
    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      const tag = ordered ? 'ol' : 'ul';
      if (!list || list.tagName.toLowerCase() !== tag) {
        list = document.createElement(tag);
        root.append(list);
      }
      appendTextBlock(list, 'li', (unordered || ordered)[1]);
      continue;
    }
    closeList();
    if (trimmed.startsWith('>')) {
      appendTextBlock(root, 'blockquote', trimmed.replace(/^>\s?/, ''));
    } else if (/^_{3,}$|^-{3,}$|^\*{3,}$/.test(trimmed)) {
      root.append(document.createElement('hr'));
    } else {
      appendTextBlock(root, 'p', line);
    }
  }
  if (!root.childNodes.length) appendTextBlock(root, 'p', strings().empty, 'manuscript-preview__empty');
  preview.replaceChildren(root);
}

function applyDocument(documentValue, { force = false, notice = '' } = {}) {
  const next = normalizeDocument(documentValue);
  if (!next) throw new Error('PPT Live host returned an invalid manuscript document');
  if (dirty && !force) {
    if (pendingRemoteDocument && next.revision <= pendingRemoteDocument.revision) return false;
    pendingRemoteDocument = next;
    setNotice(strings().conflict, { error: true, conflict: true });
    return false;
  }
  currentDocument = next;
  pendingRemoteDocument = null;
  const editor = $('manuscriptEditor');
  if (editor) editor.value = next.content;
  renderMarkdown(next.content);
  renderDiagnostics(next.diagnostics);
  setDirty(false);
  updateMetadata();
  setNotice(notice);
  return true;
}

async function fetchDocument() {
  const api = manuscriptApi();
  if (!api) return null;
  return normalizeDocument(await api.get({ documentId: DOCUMENT_ID }));
}

export async function loadManuscript({ force = false, quiet = false } = {}) {
  if (loading) return currentDocument;
  if (dirty && !force) {
    setNotice(strings().discardConfirm, { conflict: true });
    return currentDocument;
  }
  loading = true;
  setBusyState();
  updateMetadata();
  try {
    const documentValue = await fetchDocument();
    if (!documentValue) throw new Error('Managed manuscript API is unavailable');
    applyDocument(documentValue, { force, notice: quiet ? '' : strings().ready });
    return documentValue;
  } catch (error) {
    runtime().log?.error?.('Failed to load PPT Live manuscript', { error: String(error) });
    setNotice(strings().loadFailed, { error: true });
    updateMetadata();
    return null;
  } finally {
    loading = false;
    setBusyState();
  }
}

function idempotencyKey(prefix = 'manuscript') {
  const random = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  return `${prefix}-${Date.now()}-${random}`.slice(0, 120);
}

async function saveDraft() {
  if (saving || !dirty || !currentDocument) return;
  const api = manuscriptApi();
  const editor = $('manuscriptEditor');
  if (!api || !editor) return;
  saving = true;
  setBusyState();
  try {
    const result = await api.commit(editor.value, {
      documentId: DOCUMENT_ID,
      expectedRevision: currentDocument.revision,
      expectedContentHash: currentDocument.contentHash,
      idempotencyKey: idempotencyKey('manual'),
    });
    applyDocument(result?.document, { force: true, notice: strings().saved });
  } catch (error) {
    const message = String(error?.message || error);
    runtime().log?.warn?.('Failed to save PPT Live manuscript', { error: message });
    const conflict = message.includes('ppt.manuscript.revision_conflict');
    const diagnostics = diagnosticsFromCommitError(message);
    if (diagnostics.length) renderDiagnostics(diagnostics);
    const invalid = message.includes('ppt.manuscript.invalid');
    setNotice(conflict ? strings().conflict : invalid ? strings().invalid : strings().saveFailed, {
      error: true,
      conflict,
    });
  } finally {
    saving = false;
    setBusyState();
  }
}

function setViewMode(mode) {
  activeMode = ['preview', 'edit', 'split'].includes(mode) ? mode : 'preview';
  const body = $('manuscriptBody');
  if (body) body.dataset.mode = activeMode;
  document.querySelectorAll('[data-manuscript-mode]').forEach((button) => {
    button.setAttribute('aria-pressed', button.dataset.manuscriptMode === activeMode ? 'true' : 'false');
  });
}

function syncLocale() {
  const copy = strings();
  if ($('manuscriptEyebrow')) $('manuscriptEyebrow').textContent = copy.eyebrow;
  if ($('manuscriptTitle')) $('manuscriptTitle').textContent = copy.title;
  if ($('manuscriptDirtyBadge')) $('manuscriptDirtyBadge').textContent = copy.unsaved;
  if ($('reloadManuscript')) $('reloadManuscript').textContent = copy.reload;
  if ($('saveManuscript') && !saving) $('saveManuscript').textContent = copy.save;
  const labels = { preview: copy.preview, edit: copy.edit, split: copy.split };
  document.querySelectorAll('[data-manuscript-mode]').forEach((button) => {
    button.textContent = labels[button.dataset.manuscriptMode] || button.dataset.manuscriptMode;
  });
  updateMetadata();
}

function activateRoute(route) {
  routeResolved = true;
  const manuscript = route === ROUTE;
  const root = document.querySelector('.ppt-live');
  const manuscriptWorkspace = $('manuscriptWorkspace');
  const studioWorkspace = $('studioWorkspace');
  if (root) root.dataset.route = manuscript ? 'manuscript' : 'studio';
  if (manuscriptWorkspace) manuscriptWorkspace.hidden = !manuscript;
  if (studioWorkspace) studioWorkspace.hidden = manuscript;
  if (manuscript) {
    syncLocale();
    if (!currentDocument) void loadManuscript({ quiet: true });
  } else if (!visualInitialized) {
    visualInitialized = true;
    void onVisualRoute?.();
  }
}

function handleCommitted(payload) {
  const next = normalizeDocument(payload?.document);
  if (!next) return;
  onManuscriptCommitted?.(next, payload);
  const latestKnownRevision = Math.max(
    Number(currentDocument?.revision) || 0,
    Number(pendingRemoteDocument?.revision) || 0,
  );
  if (next.revision <= latestKnownRevision) return;
  const editor = $('manuscriptEditor');
  // Desktop emits the commit event immediately before resolving the RPC. If
  // this iframe originated the save, accept the matching content as its own
  // result instead of briefly presenting a false remote-conflict state.
  if (saving && editor?.value === next.content) {
    applyDocument(next, { force: true, notice: strings().saved });
    return;
  }
  applyDocument(next, { notice: strings().ready });
}

function bindDomEvents() {
  $('manuscriptEditor')?.addEventListener('input', (event) => {
    renderMarkdown(event.currentTarget.value);
    setDirty(!currentDocument || event.currentTarget.value !== currentDocument.content);
    if (pendingRemoteDocument) setNotice(strings().conflict, { error: true, conflict: true });
    else setNotice('');
  });
  $('saveManuscript')?.addEventListener('click', () => { void saveDraft(); });
  $('reloadManuscript')?.addEventListener('click', () => { void loadManuscript(); });
  $('resolveManuscriptConflict')?.addEventListener('click', () => {
    if (pendingRemoteDocument) applyDocument(pendingRemoteDocument, { force: true, notice: strings().ready });
    else void loadManuscript({ force: true });
  });
  document.querySelectorAll('[data-manuscript-mode]').forEach((button) => {
    button.addEventListener('click', () => setViewMode(button.dataset.manuscriptMode));
  });
}

export function bindManuscriptController(options = {}) {
  if (bound) return;
  bound = true;
  onVisualRoute = typeof options.onVisualRoute === 'function' ? options.onVisualRoute : null;
  onManuscriptCommitted = typeof options.onManuscriptCommitted === 'function'
    ? options.onManuscriptCommitted
    : null;
  bindDomEvents();
  syncLocale();
  setViewMode(activeMode);
  const app = runtime();
  app.on?.('productAppRuntimeRouteChange', (payload) => activateRoute(String(payload?.route || '/')));
  app.on?.('ppt.manuscript.committed', handleCommitted);
  app.onLocaleChange?.(() => syncLocale());
  // Standalone previews do not have a runtime route event. Keep that path usable
  // without letting a manuscript iframe initialize and overwrite visual state.
  setTimeout(() => {
    if (!routeResolved && !app.deck?.manuscript) activateRoute('/');
  }, 180);
}

export async function captureManuscriptBase() {
  if (!manuscriptApi()) {
    throw new Error('Managed PPT manuscript API is unavailable');
  }
  const documentValue = await fetchDocument();
  if (!documentValue) {
    throw new Error('Managed PPT manuscript could not be loaded');
  }
  return documentValue;
}

export function normalizeSlideMarkerId(value, fallback) {
  const normalized = String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || String(fallback || 'slide').replace(/[^A-Za-z0-9._-]+/g, '-');
}

function inline(value, fallback = '') {
  return String(value ?? fallback).replaceAll('\r', ' ').replaceAll('\n', ' ').trim() || fallback;
}

function block(value, fallback = '') {
  return String(value ?? fallback).replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim() || fallback;
}

function list(values, fallback = '待补充') {
  const items = Array.isArray(values) ? values.map((value) => inline(value)).filter(Boolean) : [];
  return (items.length ? items : [fallback]).map((value) => `- ${value}`).join('\n');
}

function scalar(value, fallback = '') {
  return normalizeSlideMarkerId(value, fallback);
}

export function buildPlanManuscript({ plan = {}, slidePlans = [], baseDocument, style = {} } = {}) {
  const title = inline(plan.title, 'Untitled deck');
  const deckId = scalar(baseDocument?.deckId, 'deck');
  const language = scalar(plan.language, getLocale());
  const stylePreset = scalar(style.stylePreset, 'clean-business');
  const research = plan.researchReport && typeof plan.researchReport === 'object' ? plan.researchReport : {};
  const design = plan.design && typeof plan.design === 'object' ? plan.design : {};
  const outline = Array.isArray(plan.outline) ? plan.outline : slidePlans.map((slide) => slide.title).filter(Boolean);
  const output = [
    '---',
    'pptSchema: 1',
    `deckId: ${deckId}`,
    `language: ${language}`,
    `stylePreset: ${stylePreset}`,
    '---',
    '',
    `# ${title}`,
    '',
    '## 创作简报',
    '',
    block(research.summary, title),
    '',
    '## 叙事主线',
    '',
    list(outline, '围绕主题建立完整叙事主线'),
    '',
    '## 视觉总则',
    '',
    `- 风格模式：${inline(style.stylePreset, 'clean-business')}`,
    `- 设计方法：${inline(design.stylePhilosophy, 'content-led')}`,
    `- 明暗主题：${inline(design.theme, style.colorMode || 'light')}`,
    `- 字体：${inline(style.fontFamily, 'sans')}`,
    `- 信息密度：${inline(style.density, 'standard')}`,
    ...((Array.isArray(design.layoutPrinciples) ? design.layoutPrinciples : []).map((rule) => `- ${inline(rule)}`).filter((line) => line !== '- ')),
    '',
    '## 来源',
    '',
    list([
      ...(Array.isArray(research.verifiedFacts) ? research.verifiedFacts : []),
      ...(Array.isArray(research.assumptions) ? research.assumptions.map((item) => `假设：${item}`) : []),
      ...(Array.isArray(research.warnings) ? research.warnings.map((item) => `待核验：${item}`) : []),
    ], '当前规划未使用外部来源；事实性内容仍需核验'),
    '',
    '<!-- ppt:chapter id="chapter-main" revision="1" -->',
    '## 页面规划',
    '',
  ];

  slidePlans.forEach((slide, index) => {
    const number = Number.isFinite(Number(slide.slideNumber)) ? Math.round(Number(slide.slideNumber)) : index + 1;
    const slideId = normalizeSlideMarkerId(slide.slideId || slide.id, `slide-${number}`);
    output.push(
      `<!-- ppt:slide id="${slideId}" revision="1" -->`,
      `### P${String(number).padStart(2, '0')}｜${inline(slide.title, `Slide ${number}`)}`,
      '',
      '#### 核心判断',
      '',
      block(slide.claim, slide.contentBrief || '待补充核心判断'),
      '',
      '#### 页面文案',
      '',
      list(slide.bullets, slide.contentBrief || '待补充页面文案'),
      '',
      '#### 证据与来源',
      '',
      list([
        ...(Array.isArray(slide.facts) ? slide.facts : []),
        slide.supportNote,
        slide.sourceNote,
      ].filter(Boolean), '待核验'),
      '',
      '#### 视觉表达',
      '',
      `- 角色：${inline(slide.role, 'content')}`,
      `- 布局：${inline(slide.layout, 'brief')}`,
      `- 表达：${inline(slide.visualTreatment, slide.proofObject || '遵循整套视觉总则')}`,
      `- 画面描述：${inline(slide.contentBrief, slide.proofObject || '围绕核心判断组织视觉层级')}`,
      '',
      '#### 讲述提示',
      '',
      block(slide.notes, '围绕本页核心判断进行讲述。'),
      '',
    );
  });
  return `${output.join('\n').trimEnd()}\n`;
}

function splitSlideSections(content) {
  const source = String(content || '').replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const marker = /^<!--\s*ppt:slide\s+id="([A-Za-z0-9._-]+)"[^>]*-->\s*$/gm;
  const matches = [...source.matchAll(marker)];
  return {
    preamble: source.slice(0, matches[0]?.index ?? source.length).trimEnd(),
    sections: matches.map((match, index) => ({
      id: match[1],
      content: source.slice(match.index, matches[index + 1]?.index ?? source.length).trim(),
    })),
  };
}

function mergeManagedPreamble(base, generated, updateManagedHeader = true) {
  if (!String(base || '').trim()) return String(generated || '').trimEnd();
  if (!updateManagedHeader) return String(base || '').trimEnd();
  let next = String(base || '').trimEnd();
  const fresh = String(generated || '');
  for (const field of ['language', 'stylePreset']) {
    const freshLine = fresh.match(new RegExp(`^${field}:.*$`, 'm'))?.[0];
    if (!freshLine) continue;
    const current = new RegExp(`^${field}:.*$`, 'm');
    if (current.test(next)) next = next.replace(current, freshLine);
  }
  const freshTitle = fresh.match(/^#\s+.+$/m)?.[0];
  if (freshTitle && /^#\s+.+$/m.test(next)) next = next.replace(/^#\s+.+$/m, freshTitle);
  return next;
}

function withNextSectionRevision(generated, previous) {
  const previousRevision = Number(previous?.match(/\brevision="([0-9]+)"/)?.[1]) || 0;
  if (!previousRevision) return generated;
  return generated.replace(
    /(<!--\s*ppt:slide\b[^>]*\brevision=")[0-9]+("[^>]*-->)/,
    `$1${previousRevision + 1}$2`,
  );
}

export function mergeDeckManuscript(baseDocument, generatedContent, mutation = {}) {
  const base = splitSlideSections(baseDocument?.content);
  const generated = splitSlideSections(generatedContent);
  const generatedById = new Map(generated.sections.map((section) => [section.id, section]));
  const changedIds = new Set((mutation.changedSlideIds || []).map(String));
  const deletedIds = new Set((mutation.deletedSlideIds || []).map(String));
  const replaceAll = mutation.replaceAllSlides !== false;
  const mergedSections = [];
  const presentIds = new Set();

  base.sections.forEach((section) => {
    if (deletedIds.has(section.id)) return;
    const replacement = generatedById.get(section.id);
    const shouldReplace = replacement && (replaceAll || changedIds.has(section.id));
    mergedSections.push({
      id: section.id,
      content: shouldReplace
        ? withNextSectionRevision(replacement.content, section.content)
        : section.content,
    });
    presentIds.add(section.id);
  });

  generated.sections.forEach((section, generatedIndex) => {
    if (presentIds.has(section.id) || deletedIds.has(section.id)) return;
    const previousId = generated.sections
      .slice(0, generatedIndex)
      .reverse()
      .find((candidate) => presentIds.has(candidate.id))?.id;
    const nextId = generated.sections
      .slice(generatedIndex + 1)
      .find((candidate) => presentIds.has(candidate.id))?.id;
    if (previousId) {
      const index = mergedSections.findIndex((candidate) => candidate.id === previousId);
      mergedSections.splice(index + 1, 0, section);
    } else if (nextId) {
      const index = mergedSections.findIndex((candidate) => candidate.id === nextId);
      mergedSections.splice(Math.max(0, index), 0, section);
    } else {
      mergedSections.push(section);
    }
    presentIds.add(section.id);
  });

  const preamble = mergeManagedPreamble(
    base.preamble,
    generated.preamble,
    mutation.updateManagedHeader !== false,
  );
  return `${[
    preamble,
    ...mergedSections.map((section) => section.content),
  ].filter(Boolean).join('\n\n').trimEnd()}\n`;
}

async function commitGeneratedContent(content, baseDocument, prefix) {
  const api = manuscriptApi();
  if (!api) throw new Error('Managed PPT manuscript API is unavailable');
  if (!baseDocument) throw new Error('Managed PPT manuscript base revision is required');
  const result = await api.commit(content, {
    documentId: DOCUMENT_ID,
    expectedRevision: baseDocument.revision,
    expectedContentHash: baseDocument.contentHash,
    idempotencyKey: idempotencyKey(prefix),
  });
  const next = normalizeDocument(result?.document);
  if (!next) throw new Error('Managed PPT manuscript commit returned an invalid document');
  if (next && (!currentDocument || next.revision > currentDocument.revision)) {
    applyDocument(next, { notice: strings().generated });
  }
  return next;
}

export async function commitPlanToManuscript({ plan, slidePlans, baseDocument, style } = {}) {
  const content = buildPlanManuscript({ plan, slidePlans, baseDocument, style });
  return commitGeneratedContent(content, baseDocument, 'agent-plan');
}

export async function commitStylePresetToManuscript({ baseDocument, stylePreset } = {}) {
  if (!baseDocument) throw new Error('Managed PPT manuscript base revision is required');
  const preset = normalizeSlideMarkerId(stylePreset, 'clean-business');
  const content = String(baseDocument.content || '').replace(
    /^stylePreset:.*$/m,
    `stylePreset: ${preset}`,
  );
  if (content === baseDocument.content && !/^stylePreset:/m.test(content)) {
    throw new Error('Managed PPT manuscript has no stylePreset frontmatter field');
  }
  return commitGeneratedContent(content, baseDocument, 'style-preset');
}

export async function commitDeckStateToManuscript({
  deckState,
  baseDocument,
  reason = 'visual-restore',
  mutation = {},
} = {}) {
  if (!deckState) throw new Error('PPT deck state is required to update the manuscript');
  const sources = deckState.sources && typeof deckState.sources === 'object' ? deckState.sources : {};
  const slides = Array.isArray(deckState.slides) ? deckState.slides : [];
  const generatedContent = buildPlanManuscript({
    plan: {
      title: deckState.title,
      language: getLocale(),
      outline: Array.isArray(deckState.outline) ? deckState.outline : slides.map((slide) => slide.title),
      researchReport: {
        summary: sources.summary,
        verifiedFacts: sources.facts,
        warnings: sources.warnings,
      },
    },
    slidePlans: slides.map((slide, index) => ({
      ...slide,
      slideNumber: index + 1,
      slideId: normalizeSlideMarkerId(slide.id || slide.slideId, `slide-${index + 1}`),
      visualTreatment: slide.visualTreatment || slide.proofObject,
      bullets: Array.isArray(slide.bullets)
        ? slide.bullets
        : (slide.elements || []).find((element) => element?.type === 'list')?.items,
    })),
    baseDocument,
    style: deckState.style,
  });
  const content = mergeDeckManuscript(baseDocument, generatedContent, mutation);
  return commitGeneratedContent(content, baseDocument, reason);
}

export async function resetManuscriptForNewDeck({ baseDocument, style } = {}) {
  const content = buildPlanManuscript({
    plan: { title: 'Untitled deck', language: getLocale(), outline: [] },
    slidePlans: [],
    baseDocument,
    style,
  });
  return commitGeneratedContent(content, baseDocument, 'new-deck');
}
