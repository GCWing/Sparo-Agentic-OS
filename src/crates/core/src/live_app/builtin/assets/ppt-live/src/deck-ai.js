import { translate as t, getLocale } from './i18n.js';
import { clone, ensureState, makeSlide, normalizeSlide, uid } from './state.js';

const DAMING_PPT_AGENT_TEAM_SKILL = [
  'You are PPT Live, a presentation generation engine running as a fallback path.',
  'The user is the final decision maker. Execute the PPT task end to end and do not impose any fixed content agenda on the topic.',
  '',
  'Production method:',
  '1. Understand the order, decompose the task, coordinate stages, and check final delivery.',
  '2. Research the assigned topic/source, prioritize reliable sources, and produce structured findings with source notes.',
  '3. Verify facts, URLs, data, and examples; separate verified material from assumptions and gaps.',
  '4. Convert the verified material into a TED 3S outline. Story: hook, progression, climax, landing point. Simplicity: one core message per page, no text walls. Structure: titles connect the logic and visual cues strengthen understanding.',
  '5. Decide which pages need images or visual treatment, and describe the visual direction only when it serves the outline.',
  '6. Assemble the final editable deck from the outline and visual plan, preserving page count, content, and one-focus-per-page design.',
  '',
  'Design principles from the original workflow:',
  '- Use the user order and verified material as the only content authority.',
  '- Every page carries one core message and keeps visible text concise.',
  '- Use story rhythm and structure, not any preselected topic formula.',
  '- Keep titles concrete and connected to the actual subject.',
  '- If material is thin, clearly mark unknowns and verification notes while still producing a useful draft.',
].join('\n');

export function buildBriefFromInputs(state) {
  return {
    ...state.brief,
    title: state.title,
    currentOutline: state.outline,
    style: state.style,
    sources: state.sources || null,
    locale: getLocale(),
  };
}

export async function planPresentationTaskWithAi(state, instruction) {
  const schema = {
    operation: 'generate_deck|revise_deck|revise_slide|insert_slide|delete_slide|update_outline',
    scope: 'deck|current_slide|slide_index',
    slideIndex: null,
    briefPatch: {
      topic: 'optional refined topic',
      audience: 'optional refined audience',
      slideTarget: 8,
      intent: 'free-form inferred purpose, only if stated or strongly implied',
      tone: 'free-form tone, only if stated or strongly implied',
    },
    needsSources: true,
    reason: 'why this operation is the right next step',
    steps: [
      { stage: 'brief|research|verification|outline|visual|assembly', task: 'work to do', deliverable: 'expected output' },
    ],
    acceptanceCriteria: ['What must be true when done'],
  };
  const prompt = [
    'Return strict JSON only, no markdown fences.',
    `Shape: ${JSON.stringify(schema)}.`,
    `Locale: ${getLocale()}.`,
    DAMING_PPT_AGENT_TEAM_SKILL,
    `User order: ${instruction || ''}.`,
    `Current deck state: ${JSON.stringify({
      title: state.title,
      brief: state.brief,
      slideCount: state.slides?.length || 0,
      activeSlideIndex: Math.max(0, state.slides?.findIndex((slide) => slide.id === state.activeSlideId) ?? 0),
      outline: state.outline,
      currentSlide: state.slides?.find((slide) => slide.id === state.activeSlideId) || state.slides?.[0] || null,
    })}.`,
    'Choose the next executable operation autonomously. Prefer deck-level work when the user asks for a presentation outcome, structural change, rewrite, expansion, deletion by theme, or ambiguous improvement.',
    'Choose current-slide revision only when the user clearly targets the current page/slide.',
    'Choose delete_slide only when the user clearly asks to remove the current slide or a numbered slide. For deleting duplicate, weak, or irrelevant content, choose revise_deck so the deck can be reorganized.',
    'Set briefPatch only for fields inferred from the user order. Keep steps short and operational.',
  ].join('\n');
  const data = await askAi(prompt, 1200);
  return normalizeAgentPlan(data, state);
}

export async function enrichSources(state) {
  const urls = extractUrls(`${state.brief.topic || ''}\n${state.brief.material || ''}`);
  const manual = stripUrls(`${state.brief.topic || ''}\n${state.brief.material || ''}`).trim();
  const sources = {
    items: [],
    facts: [],
    warnings: [],
    summary: '',
    fetchedAt: Date.now(),
  };
  if (manual.length >= 20) {
    sources.items.push({ kind: 'user-text', title: t('sourceManualTitle'), url: '', text: manual.slice(0, 5000) });
  }
  for (const url of urls.slice(0, 3)) {
    try {
      const fetched = await fetchReadableSources(url);
      sources.items.push(...fetched);
    } catch (error) {
      window.app?.log?.warn?.('PPT Live source fetch failed', { url, error: String(error) });
      sources.warnings.push(t('sourceFetchFailed', { url }));
    }
  }
  const combined = sources.items.map((item) => `${item.title}\n${item.text}`).join('\n\n').slice(0, 14000);
  sources.facts = extractFacts(combined);
  sources.summary = summarizeSource(combined, sources);
  if (!sources.items.length) sources.warnings.push(t('sourceMissingWarning'));
  state.sources = sources;
  return sources;
}

export async function generateOutlineWithAi(state) {
  const prompt = [
    'Return strict JSON only, no markdown fences.',
    'Shape: {"title":"deck title","outline":["slide title", "..."]}.',
    `Locale: ${getLocale()}.`,
    DAMING_PPT_AGENT_TEAM_SKILL,
    `Brief: ${JSON.stringify(buildBriefFromInputs(state))}.`,
    'Generate the PPT outline as the Story academy.',
    'The outline must directly answer the user order and the fetched/pasted source. Do not substitute any preselected content agenda.',
    'Use TED 3S: Hook -> context -> core evidence -> shift -> takeaway. One concrete idea per slide.',
    'Every slide title must use concrete nouns from the user topic or source instead of abstract placeholders.',
    'Respect the requested page count. If no count is requested, use the deck brief slideTarget.',
  ].join('\n');
  const data = await askAi(prompt, 1000);
  if (!Array.isArray(data?.outline) || data.outline.length === 0) throw new Error('Invalid outline');
  const target = Number(state.brief.slideTarget) || 8;
  return {
    title: data.title || data.outline[0] || state.title,
    outline: data.outline.slice(0, target).map(String),
  };
}

export async function generateDeckWithAi(state) {
  const schema = {
    title: 'Deck title',
    slides: [
      {
        role: 'cover|content|data|transition|closing',
        narrativeStage: 'hook|context|core|shift|takeaway',
        title: 'Source-specific slide title',
        kicker: '1-3 word slide role',
        claim: 'One concrete idea this slide communicates',
        proofObject: 'source-backed proof or visual direction for this page',
        supportNote: 'What source fact or assumption supports this slide',
        sourceNote: 'Source URL/name or verification note',
        facts: ['Source-backed fact or clearly marked assumption, using source vocabulary'],
        bullets: ['Short visible text, max 12 Chinese chars or 8 English words when possible'],
        metric: { value: 'Only if explicitly present in source', label: 'Metric label' },
        chartData: [{ label: 'Only source-backed label', value: 0 }],
        notes: 'Speaker notes',
        layout: 'cover|brief|evidence|process|comparison|quote|data|closing',
      },
    ],
  };
  const prompt = [
    'Return strict JSON only, no markdown fences.',
    `Shape: ${JSON.stringify(schema)}.`,
    `Locale: ${getLocale()}.`,
    DAMING_PPT_AGENT_TEAM_SKILL,
    `Brief: ${JSON.stringify(buildBriefFromInputs(state))}.`,
    `Confirmed outline: ${JSON.stringify(state.outline)}.`,
    'Generate the final editable deck blueprint after internal research, verification, outline, visual planning, and assembly steps.',
    'Content fidelity is the top priority. Every slide must be about the user-requested topic/source. Do not introduce unrelated framing unless it is present in the user order or source.',
    'Use the user brief and source vocabulary aggressively: names, concepts, claims, examples, data, constraints, and domain-specific terms that actually appear in the material.',
    'Every non-cover slide must have exactly one dominant message and, when useful, a visual direction selected by the content.',
    'Visible text should be concise and presentation-ready. Speaker notes can carry explanation.',
    'Use chart/data slides only when numeric data exists in the source. Never invent precise numbers.',
    'If a source could not be read, mark that specific source as unavailable. If a source was read, do not say it was unread.',
    'Before returning JSON, self-check: (1) each title mentions the actual subject, (2) bullets are grounded in the order/source, (3) no preselected agenda, (4) requested page count is respected.',
  ].join('\n');
  const data = await askAi(prompt, 2800);
  if (!Array.isArray(data?.slides) || data.slides.length === 0) throw new Error('Invalid deck');
  return compileBlueprint({ title: data.title || state.title, slides: data.slides }, state);
}

export async function applySlideInstructionWithAi(state, action, instruction) {
  const current = state.slides.find((slide) => slide.id === state.activeSlideId) || state.slides[0];
  if (!current) return null;
  const prompt = [
    'Return strict JSON only, no markdown fences.',
    'Return one slide using the same editable JSON format as the current slide.',
    `Locale: ${getLocale()}.`,
    DAMING_PPT_AGENT_TEAM_SKILL,
    `Action: ${action}.`,
    `User instruction: ${instruction || ''}.`,
    `Deck brief: ${JSON.stringify(buildBriefFromInputs(state))}.`,
    `Current slide: ${JSON.stringify(current)}.`,
    'Preserve the core message, but improve content, layout, hierarchy, speaker notes, and visual clarity.',
    'Maintain a slide role, claim, proofObject, supportNote, and sourceNote. Strengthen the proof object before adding more text.',
  ].join('\n');
  const data = await askAi(prompt, 1800);
  if (!data?.elements?.length) throw new Error('Invalid slide');
  return normalizeSlide({ ...current, ...data, id: current.id }, state.slides.indexOf(current), state);
}

export async function applyDeckInstructionWithAi(state, instruction) {
  const schema = {
    title: 'Deck title',
    slides: [
      {
        role: 'cover|content|data|transition|closing',
        narrativeStage: 'hook|context|core|shift|takeaway',
        title: 'Source-specific slide title',
        kicker: '1-3 word slide role',
        claim: 'One concrete idea this slide communicates',
        proofObject: 'source-backed proof or visual direction for this page',
        supportNote: 'What source fact or assumption supports this slide',
        sourceNote: 'Source or verification note',
        facts: ['Source-backed fact or clearly marked assumption, using source vocabulary'],
        bullets: ['Short visible text'],
        metric: { value: 'Only if explicitly present in source', label: 'Metric label' },
        chartData: [{ label: 'Only source-backed label', value: 0 }],
        notes: 'Speaker notes',
        layout: 'cover|brief|evidence|process|comparison|quote|data|closing',
      },
    ],
  };
  const prompt = [
    'Return strict JSON only, no markdown fences.',
    `Shape: ${JSON.stringify(schema)}.`,
    `Locale: ${getLocale()}.`,
    DAMING_PPT_AGENT_TEAM_SKILL,
    `User revision request: ${instruction || ''}.`,
    `Deck brief: ${JSON.stringify(buildBriefFromInputs(state))}.`,
    `Current editable deck: ${JSON.stringify({ title: state.title, outline: state.outline, slides: state.slides })}.`,
    'Act as an end-to-end presentation agent, not a single-slide editor.',
    'Revise the whole deck as a coherent presentation while staying loyal to the user order and source material.',
    'You may generate a complete new deck, add slides, delete slides, reorder slides, merge duplicate slides, or rewrite existing slides when the user request calls for it.',
    'Preserve source constraints and never invent precise facts. Do not introduce a generic content formula unless the source or user asks for it.',
    'Keep the same approximate slide count only when the user asks for a style/content rewrite without structural change.',
    'Make every slide title source-specific and every slide revolve around one core message.',
  ].join('\n');
  const data = await askAi(prompt, 3200);
  if (!Array.isArray(data?.slides) || data.slides.length === 0) throw new Error('Invalid deck revision');
  return compileBlueprint({ title: data.title || state.title, slides: data.slides }, state, { respectSlideTarget: false });
}

export async function insertSlideWithAi(state, instruction) {
  const index = Math.min(state.slides.length, Math.max(0, state.slides.findIndex((slide) => slide.id === state.activeSlideId) + 1));
  const prompt = [
    'Return strict JSON only, no markdown fences.',
    'Return one slide using the same editable JSON format as the surrounding slides.',
    `Locale: ${getLocale()}.`,
    DAMING_PPT_AGENT_TEAM_SKILL,
    `Insertion request: ${instruction || ''}.`,
    `Deck brief: ${JSON.stringify(buildBriefFromInputs(state))}.`,
    `Insert after slide index: ${index}.`,
    `Deck outline: ${JSON.stringify(state.outline)}.`,
    `Previous slide: ${JSON.stringify(state.slides[index - 1] || null)}.`,
    `Next slide: ${JSON.stringify(state.slides[index] || null)}.`,
    'The inserted page must advance the story, not duplicate neighboring pages.',
    'Maintain a slide role, claim, proofObject, supportNote, sourceNote, speaker notes, and editable elements.',
  ].join('\n');
  const data = await askAi(prompt, 1800);
  if (!data?.elements?.length) throw new Error('Invalid inserted slide');
  return normalizeSlide(data, index, { ...state, slides: [...state.slides, data] });
}

export function localOutline(state) {
  const topic = displayTopic(state.brief.topic || t('defaultDeckTitle'));
  const facts = sourceFallbackFacts(state).filter(Boolean);
  const base = [
    topic,
    `${topic} 是什么，以及为什么值得关注`,
    facts[0] || `${topic} 的核心能力来自已有素材`,
    facts[1] || `${topic} 的工作方式需要用一个流程讲清楚`,
    facts[2] || `${topic} 的典型场景决定它的价值`,
    `${topic} 的证据和待验证问题`,
    `${topic} 适合谁，以及不适合谁`,
    `${topic} 的最终落点`,
  ];
  return base.slice(0, state.brief.slideTarget).map(cleanTitle);
}

export function localDeck(state) {
  const outline = state.outline?.length ? state.outline : localOutline(state);
  const next = ensureState({ ...clone(state), outline });
  const blueprint = localBlueprint(next, outline);
  const compiled = compileBlueprint(blueprint, next);
  next.slides = compiled.slides;
  next.title = compiled.title;
  next.activeSlideId = next.slides[0]?.id || '';
  next.selectedElementId = next.slides[0]?.elements[0]?.id || '';
  return next;
}

export function compileBlueprint(blueprint, state, options = {}) {
  const sourceCount = state.sources?.items?.length || 0;
  const requestedSlides = blueprint.slides || [];
  const target = options.respectSlideTarget === false
    ? clampSlideCount(requestedSlides.length || state.brief.slideTarget)
    : state.brief.slideTarget;
  const slides = requestedSlides.slice(0, target).map((item, index, all) => {
    const role = item.role || roleForIndex(index, all.length);
    const slide = {
      id: uid('slide'),
      title: cleanTitle(item.title || item.claim || state.outline[index] || t('newSlideTitle')),
      subtitle: '',
      kicker: displayKicker(item.kicker || role),
      claim: item.claim || item.title || '',
      proofObject: item.proofObject || proofForRole(role, sourceCount),
      supportNote: item.supportNote || supportForBlueprint(item, state),
      sourceNote: item.sourceNote || sourceNoteForBlueprint(state),
      notes: item.notes || t('defaultSpeakerNote', { title: item.title || item.claim || '' }),
      layout: item.layout || layoutForRole(role, index, all.length),
      theme: themeFor(state, index),
      elements: elementsForBlueprint(item, role, index, all.length, state),
    };
    return normalizeSlide(slide, index, state);
  });
  return {
    title: cleanTitle(blueprint.title || state.brief.topic || slides[0]?.title || state.title),
    slides,
  };
}

function clampSlideCount(value) {
  return Math.max(1, Math.min(24, Number(value) || 1));
}

function displayKicker(value) {
  const raw = String(value || '').replace(/[-_]/g, ' ').trim();
  const normalized = raw.toLowerCase();
  if (getLocale().startsWith('zh')) {
    const zh = {
      cover: '开场',
      content: '核心',
      data: '数据',
      transition: '转场',
      closing: '落点',
      hook: '开场',
      context: '背景',
      finding: '发现',
      takeaway: '结论',
    };
    return zh[normalized] || raw;
  }
  return raw.toUpperCase();
}

function normalizeAgentPlan(value, state) {
  const allowed = new Set(['generate_deck', 'revise_deck', 'revise_slide', 'insert_slide', 'delete_slide', 'update_outline']);
  const operation = allowed.has(value?.operation) ? value.operation : (state.slides?.length ? 'revise_deck' : 'generate_deck');
  const slideCount = state.slides?.length || 0;
  const slideIndex = value?.slideIndex === null || value?.slideIndex === undefined
    ? null
    : Math.max(0, Math.min(slideCount - 1, Number(value.slideIndex) || 0));
  const scope = ['deck', 'current_slide', 'slide_index'].includes(value?.scope) ? value.scope : (operation === 'revise_slide' ? 'current_slide' : 'deck');
  return {
    operation,
    scope,
    slideIndex,
    briefPatch: normalizeBriefPatch(value?.briefPatch),
    needsSources: Boolean(value?.needsSources),
    reason: String(value?.reason || ''),
    steps: Array.isArray(value?.steps) ? value.steps.slice(0, 8).map(normalizePlanStep) : [],
    acceptanceCriteria: Array.isArray(value?.acceptanceCriteria) ? value.acceptanceCriteria.map(String).slice(0, 6) : [],
  };
}

function normalizePlanStep(step) {
  return {
    agent: String(step?.agent || step?.stage || 'brief'),
    task: String(step?.task || ''),
    deliverable: String(step?.deliverable || ''),
  };
}

function normalizeBriefPatch(value = {}) {
  const patch = {};
  const topic = cleanPatchText(value.topic);
  const audience = cleanPatchText(value.audience);
  const intent = cleanPatchText(value.intent);
  const tone = cleanPatchText(value.tone);
  if (topic) patch.topic = topic;
  if (audience) patch.audience = audience;
  if (intent) patch.deckType = intent;
  if (tone) patch.tone = tone;
  const slideTarget = Number(value.slideTarget);
  if (Number.isFinite(slideTarget)) patch.slideTarget = Math.max(3, Math.min(24, slideTarget));
  return patch;
}

function cleanPatchText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || /^optional\b/i.test(text)) return '';
  return text;
}

function localBlueprint(state, outline) {
  const topic = displayTopic(state.brief.topic || outline[0] || t('defaultDeckTitle'));
  const facts = state.sources?.facts?.length ? state.sources.facts : sourceFallbackFacts(state);
  const hasSource = hasGroundedSource(state);
  const roles = ['cover', 'content', 'content', 'content', 'content', 'data', 'transition', 'closing'];
  const titles = [
    topic,
    hasSource ? `${topic} 的源材料提供了第一组线索` : `${topic} 需要先补充可验证材料`,
    facts[0] || `${topic} 的定义和边界需要讲清楚`,
    facts[1] || `${topic} 的结构可以拆成几个关键模块`,
    facts[2] || `${topic} 的使用流程决定理解速度`,
    facts[3] || `${topic} 需要用例来证明价值`,
    facts[4] || `${topic} 需要把已知事实和未知问题分开呈现`,
    `${topic} 的结尾要留下一个清晰记忆点`,
  ];
  return {
    title: topic,
    slides: roles.slice(0, state.brief.slideTarget).map((role, index) => ({
      role,
      title: titles[index] || outline[index] || t('newSlideTitle'),
      kicker: role,
      claim: titles[index] || outline[index] || '',
      proofObject: proofForRole(role, hasSource ? 1 : 0),
      supportNote: hasSource ? t('bpSupportSource') : t('bpSupportMissing'),
      sourceNote: sourceNoteForBlueprint(state),
      facts: rotateFacts(facts, index, 3),
      bullets: rotateFacts(facts, index + 1, 3),
      notes: t('defaultSpeakerNote', { title: titles[index] || topic }),
      layout: layoutForRole(role, index, roles.length),
    })),
  };
}

export function localSlideUpdate(state, action, instruction) {
  const slide = clone(state.slides.find((item) => item.id === state.activeSlideId) || state.slides[0]);
  if (!slide) return null;
  const titleElement = slide.elements.find((element) => element.type === 'text');
  const listElement = slide.elements.find((element) => element.type === 'list');
  if (action === 'condense' && listElement) {
    listElement.items = listElement.items.slice(0, 2).map((item) => item.replace(/\s+and\s+/i, ' / '));
  } else if (action === 'professional' && titleElement) {
    titleElement.text = titleElement.text.replace(/\bmake\b/gi, 'deliver').replace(/\buse\b/gi, 'apply');
  } else if (action === 'notes') {
    slide.notes = `Takeaway: ${slide.claim || slide.title}\nProof: Walk through the ${slide.proofObject || 'dominant proof object'} and call out the strongest evidence.\nDecision: Close by naming the owner, timing, or next action. ${instruction || ''}`.trim();
  } else if (action === 'visual' || action === 'redesign') {
    const index = state.slides.findIndex((item) => item.id === slide.id);
    const replacement = makeSlide(slide.title, index + 1, state.slides.length + 1, state);
    replacement.id = slide.id;
    replacement.notes = slide.notes;
    return replacement;
  } else if (titleElement) {
    titleElement.text = instruction || titleElement.text;
  }
  return normalizeSlide(slide, state.slides.findIndex((item) => item.id === slide.id), state);
}

export function localDeckUpdate(state, instruction) {
  const next = clone(state);
  const suffix = instruction ? ` ${instruction}` : '';
  next.slides = next.slides.map((slide, index) => normalizeSlide({
    ...slide,
    supportNote: `${slide.supportNote || ''}${suffix}`.trim(),
    notes: `${slide.notes || ''}\nRevision request: ${instruction || 'Improve clarity and flow.'}`.trim(),
  }, index, next));
  next.outline = next.slides.map((slide) => slide.title);
  return { title: next.title, slides: next.slides };
}

export function localInsertedSlide(state, instruction) {
  const index = Math.min(state.slides.length, Math.max(0, state.slides.findIndex((slide) => slide.id === state.activeSlideId) + 1));
  const title = instruction || t('newSlideTitle');
  return makeSlide(title, index, state.slides.length + 1, state);
}

function elementsForBlueprint(item, role, index, total, state) {
  const title = cleanTitle(item.title || item.claim || state.outline[index] || t('newSlideTitle'));
  const claim = cleanTitle(item.claim || title);
  const trusted = hasGroundedSource(state);
  const facts = trusted ? ensureBullets(item.facts?.length ? item.facts : item.bullets, state) : sourceFallbackFacts(state);
  const bullets = trusted ? ensureBullets(item.bullets?.length ? item.bullets : facts, state) : sourceFallbackFacts(state);
  if (role === 'cover' || index === 0) {
    const coverTitleSize = title.length > 58 ? 25 : title.length > 42 ? 29 : 40;
    return [
      shape(7, 15, 4, 56, 'primary', 1, 99),
      text(title, 14, 18, 62, 28, coverTitleSize, 840, 'ink'),
      text(claim, 15, 50, 56, 12, 18, 540, 'muted'),
      metric(String(total), t('slidesUnit'), 75, 53, 15, 18),
    ];
  }
  if (role === 'workflow' || item.layout === 'process') {
    return [
      text(title, 8, 13, 68, 13, 31, 810, 'ink'),
      text(claim, 9, 29, 54, 9, 15, 540, 'muted'),
      shape(10, 51, 78, 2, 'primary', 0.18, 99),
      ...bullets.slice(0, 3).map((point, pointIndex) => metric(`0${pointIndex + 1}`, point, 10 + pointIndex * 27, 39, 22, 27, 28)),
    ];
  }
  if (role === 'proof' && Array.isArray(item.chartData) && item.chartData.length >= 2 && hasSourceNumbers(state)) {
    return [
      text(title, 8, 12, 68, 13, 31, 810, 'ink'),
      chart(item.proofObject || t('proofTrendChart'), item.chartData, 10, 34, 54, 36),
      text(item.supportNote || bullets[0], 69, 38, 20, 25, 17, 700, 'primary', 'soft', 14),
    ];
  }
  if (role === 'risk' || item.layout === 'risk') {
    return [
      text(title, 8, 12, 68, 13, 31, 810, 'ink'),
      list(bullets.slice(0, 4), 9, 34, 47, 38, 19, 'panel'),
      text(item.supportNote || t('bpSupportMissing'), 61, 36, 28, 30, 17, 650, 'muted', 'soft', 14),
    ];
  }
  if (role === 'decision' || index === total - 1) {
    return [
      text(title, 9, 15, 70, 15, 38, 820, 'ink'),
      list([t('closeConfirm'), t('closeOwner'), t('closeIteration')], 12, 42, 45, 32, 22),
      text(bullets[0] || item.supportNote || '', 63, 42, 27, 24, 18, 720, 'primary', 'soft', 16),
    ];
  }
  return [
    text(title, 8, 12, 68, 13, 31, 810, 'ink'),
    text(claim, 9, 29, 52, 9, 15, 540, 'muted'),
    list(bullets.slice(0, 3), 9, 42, 39, 31, 18),
    text(facts[0] || item.supportNote || '', 55, 38, 34, 29, 18, 700, 'primary', 'soft', 14),
  ];
}

function text(value, x, y, w, h, fontSize, fontWeight, color, background = 'transparent', borderRadius = 0) {
  return {
    type: 'text',
    text: String(value || ''),
    label: '',
    items: [],
    data: [],
    x,
    y,
    w,
    h,
    style: { fontSize, fontWeight, color, background, borderRadius, opacity: 1, align: 'left' },
  };
}

function list(items, x, y, w, h, fontSize = 19, background = 'transparent') {
  return {
    type: 'list',
    text: '',
    label: '',
    items: ensureArray(items).slice(0, 5),
    data: [],
    x,
    y,
    w,
    h,
    style: { fontSize, fontWeight: 560, color: 'ink', background, borderRadius: background === 'panel' ? 14 : 0, opacity: 1, align: 'left' },
  };
}

function metric(value, label, x, y, w, h, fontSize = 40) {
  return {
    type: 'metric',
    text: String(value || ''),
    label: String(label || ''),
    items: [],
    data: [],
    x,
    y,
    w,
    h,
    style: { fontSize, fontWeight: 820, color: 'primary', background: 'panel', borderRadius: 14, opacity: 1, align: 'left' },
  };
}

function chart(title, data, x, y, w, h) {
  return {
    type: 'chart',
    text: String(title || t('proofTrendChart')),
    label: '',
    items: [],
    data: ensureArray(data).map((point, index) => ({
      label: String(point.label || `#${index + 1}`),
      value: Number(point.value || 0),
    })),
    x,
    y,
    w,
    h,
    style: { fontSize: 18, fontWeight: 700, color: 'ink', background: 'panel', borderRadius: 14, opacity: 1, align: 'left' },
  };
}

function shape(x, y, w, h, background, opacity, borderRadius) {
  return {
    type: 'shape',
    text: '',
    label: '',
    items: [],
    data: [],
    x,
    y,
    w,
    h,
    style: { fontSize: 18, fontWeight: 600, color: 'accent', background, borderRadius, opacity, align: 'center' },
  };
}

function themeFor(state, index) {
  const primary = state.style?.brandPrimary || '#0f766e';
  const accent = state.style?.brandAccent || '#f97316';
  return {
    background: '#fbfcff',
    ink: '#111827',
    muted: '#5b6575',
    primary: index % 2 ? accent : primary,
    accent: index % 2 ? primary : accent,
    panel: '#ffffff',
  };
}

function layoutForRole(role, index, total) {
  if (role === 'cover' || index === 0) return 'cover';
  if (role === 'closing' || role === 'takeaway' || index === total - 1) return 'closing';
  if (role === 'transition') return 'quote';
  if (role === 'workflow' || role === 'architecture') return 'process';
  if (role === 'comparison' || role === 'data') return 'comparison';
  if (role === 'content' || role === 'example' || role === 'finding' || role === 'context' || role === 'hook') return 'split';
  return index % 2 ? 'metric' : 'split';
}

function proofForRole(role, sourceCount) {
  const withSource = sourceCount > 0;
  const map = {
    cover: withSource ? t('proofSourceSummary') : t('proofVerificationPlan'),
    content: withSource ? t('proofEvidenceList') : t('proofVerificationPlan'),
    data: t('proofMetricBridge'),
    transition: t('proofVisualProof'),
    closing: t('proofDecisionTable'),
    hook: withSource ? t('proofSourceSummary') : t('proofVerificationPlan'),
    context: withSource ? t('proofSourceSummary') : t('proofVerificationPlan'),
    finding: withSource ? t('proofEvidenceList') : t('proofVerificationPlan'),
    architecture: t('proofProductDiagram'),
    example: t('proofWorkedExample'),
    comparison: t('proofComparison'),
    data: t('proofMetricBridge'),
    takeaway: t('proofDecisionTable'),
    problem: t('proofComparison'),
    solution: t('proofCapabilityMatrix'),
    workflow: t('proofOperatingModel'),
    proof: withSource ? t('proofEvidenceList') : t('proofVerificationPlan'),
    risk: t('proofRiskRegister'),
    decision: t('proofDecisionTable'),
  };
  return map[role] || t('proofVisualProof');
}

function roleForIndex(index, total) {
  if (index === 0) return 'cover';
  if (index === total - 1) return 'closing';
  return ['content', 'content', 'data', 'transition'][Math.max(0, index - 1) % 4];
}

function supportForBlueprint(item, state) {
  if (!hasGroundedSource(state)) return t('bpSupportMissing');
  if (item.facts?.length) return item.facts[0];
  return state.sources?.items?.length ? t('bpSupportSource') : t('bpSupportMissing');
}

function sourceNoteForBlueprint(state) {
  const urls = state.sources?.items?.filter((item) => item.url).map((item) => item.url);
  if (urls?.length) return t('sourceFetchedNote', { count: urls.length });
  if (hasGroundedSource(state)) return t('sourceUserMaterial');
  return t('sourceDraftAssumption');
}

function hasGroundedSource(state) {
  return Boolean(state.sources?.facts?.length || state.sources?.items?.some((item) => String(item.text || '').length >= 120));
}

function hasSourceNumbers(state) {
  return Boolean(state.sources?.facts?.some((fact) => /\d/.test(String(fact))));
}

function sourceFallbackFacts(state) {
  return state.sources?.warnings?.length
    ? state.sources.warnings
    : [t('bpMissingFact1'), t('bpMissingFact2'), t('bpMissingFact3')];
}

function rotateFacts(facts, offset, count) {
  const source = ensureArray(facts).filter(Boolean);
  if (!source.length) return [];
  return Array.from({ length: Math.min(count, source.length) }, (_, index) => source[(offset + index) % source.length]);
}

function ensureBullets(items, state) {
  const source = ensureArray(items).map((item) => String(item).trim()).filter(Boolean);
  if (source.length) return source;
  return sourceFallbackFacts(state);
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanTitle(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function displayTopic(value) {
  const raw = cleanTitle(value);
  const withoutUrls = stripUrls(raw).trim() || raw;
  const normalized = withoutUrls
    .replace(/^create\s+(an?|the)?\s*\d+\s*[- ]?\s*(page|slide)\s+/i, '')
    .replace(/^create\s+(an?|the)?\s+/i, '')
    .replace(/^make\s+(an?|the)?\s+/i, '')
    .replace(/^build\s+(an?|the)?\s+/i, '')
    .replace(/^add\s+(an?|the)?\s*(page|slide)\s+(about|on|for)?\s*/i, '')
    .trim();
  const firstSentence = normalized.split(/[.!?。！？]/)[0]?.trim() || normalized;
  const concise = firstSentence.length > 72 ? firstSentence.slice(0, 69).trimEnd() + '...' : firstSentence;
  const urls = extractUrls(raw);
  if (!urls.length) return concise || raw;
  try {
    const parsed = new URL(urls[0]);
    if (parsed.hostname === 'github.com') {
      const [, owner, repo] = parsed.pathname.split('/');
      if (owner && repo) return `${owner}/${repo}`;
    }
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return concise || raw.replace(urls[0], '').trim() || urls[0];
  }
}

function extractUrls(value) {
  const matches = String(value || '').match(/https?:\/\/[^\s<>"'`]+/g) || [];
  return Array.from(new Set(matches.map(cleanUrlToken).filter(Boolean)));
}

function stripUrls(value) {
  return String(value || '').replace(/https?:\/\/[^\s<>"'`]+/g, '').replace(/\s+/g, ' ');
}

function cleanUrlToken(value) {
  let url = String(value || '').trim();
  while (/[.,，。;；:：!?！？、\])}\u300b\u300d\u300f]$/.test(url)) {
    url = url.slice(0, -1);
  }
  return url;
}

async function fetchReadableSources(url) {
  const host = window.app;
  if (!host?.net?.fetch) throw new Error('net unavailable');
  const targets = sourceTargets(url);
  let lastError = null;
  const found = [];
  for (const target of targets) {
    try {
      const response = await host.net.fetch(target.url, {
        headers: {
          Accept: target.accept || 'text/html,text/plain,application/json',
          'User-Agent': 'PPT-Live/1.0',
        },
      });
      if (Number(response.status) < 200 || Number(response.status) >= 300) throw new Error(`HTTP ${response.status}`);
      const text = readableText(response.body || '', target.url);
      if (text.length < 80) throw new Error('source too small');
      host.log?.info?.('PPT Live source fetched', { url: target.url, kind: target.kind, textLength: text.length });
      found.push({
        kind: target.kind,
        title: target.title || target.url,
        url: target.url,
        text: text.slice(0, 9000),
      });
    } catch (error) {
      host.log?.warn?.('PPT Live source target failed', { url: target.url, kind: target.kind, error: String(error) });
      lastError = error;
    }
  }
  if (found.length) return found;
  throw lastError || new Error('fetch failed');
}

function sourceTargets(url) {
  try {
    const parsed = new URL(cleanUrlToken(url));
    if (parsed.hostname === 'github.com') {
      const [, owner, repo] = parsed.pathname.split('/');
      if (owner && repo) {
        const cleanRepo = repo.replace(/\.git$/i, '');
        return [
          {
            kind: 'github-readme',
            title: `${owner}/${cleanRepo} README`,
            url: `https://raw.githubusercontent.com/${owner}/${cleanRepo}/HEAD/README.md`,
            accept: 'text/plain',
          },
          {
            kind: 'github-api',
            title: `${owner}/${cleanRepo}`,
            url: `https://api.github.com/repos/${owner}/${cleanRepo}`,
            accept: 'application/vnd.github+json',
          },
          { kind: 'web-page', title: cleanUrlToken(url), url: cleanUrlToken(url) },
        ];
      }
    }
  } catch {
    return [{ kind: 'web-page', title: cleanUrlToken(url), url: cleanUrlToken(url) }];
  }
  return [{ kind: 'web-page', title: cleanUrlToken(url), url: cleanUrlToken(url) }];
}

function readableText(body, url) {
  const raw = String(body || '');
  if (url.includes('api.github.com/repos/')) {
    try {
      const data = JSON.parse(raw);
      return [
        data.full_name,
        data.description,
        `Stars: ${data.stargazers_count ?? 'unknown'}`,
        `Forks: ${data.forks_count ?? 'unknown'}`,
        `Language: ${data.language || 'unknown'}`,
        `Topics: ${(data.topics || []).join(', ')}`,
        `Updated: ${data.updated_at || 'unknown'}`,
        data.homepage ? `Homepage: ${data.homepage}` : '',
      ].filter(Boolean).join('\n');
    } catch {
      return raw;
    }
  }
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractFacts(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  const sentences = clean
    .split(/(?<=[。！？.!?])\s+|[\n\r]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 16 && item.length <= 180);
  const numeric = sentences.filter((item) => /\d/.test(item));
  return [...numeric, ...sentences].slice(0, 12);
}

function summarizeSource(text, sources) {
  const facts = extractFacts(text).slice(0, 6);
  if (!facts.length) return '';
  return [t('sourceDigestTitle'), ...facts.map((fact) => `- ${fact}`), ...(sources.warnings || []).map((warning) => `- ${warning}`)].join('\n');
}

async function askAi(prompt, maxTokens) {
  const host = window.app;
  if (!host?.ai?.complete) throw new Error('AI unavailable');
  const result = await host.ai.complete(prompt, {
    systemPrompt: 'You are a senior presentation designer. Return strict JSON only.',
    maxTokens,
    temperature: 0.58,
  });
  return extractJson(result?.text || result);
}

function extractJson(value) {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  }
}
