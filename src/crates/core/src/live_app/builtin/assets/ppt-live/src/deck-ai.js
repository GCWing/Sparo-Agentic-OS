import { translate as t, getLocale } from './i18n.js';
import { clone, ensureState, makeSlide, methodologyFor, normalizeSlide, uid } from './state.js';

export function buildBriefFromInputs(state) {
  const methodology = methodologyFor(state.brief?.deckType);
  return {
    ...state.brief,
    title: state.title,
    currentOutline: state.outline,
    style: state.style,
    methodology,
    sources: state.sources || null,
    locale: getLocale(),
  };
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
    `Brief: ${JSON.stringify(buildBriefFromInputs(state))}.`,
    'If source material is thin, create a source-aware outline that marks verification needs; do not invent metrics or product claims.',
    'Create a concise slide-by-slide narrative using a professional claim spine.',
    'Every slide title must be a conclusion or decision claim, not a generic topic label.',
    'Sequence the outline as thesis -> context -> friction -> proof -> implications -> decision.',
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
        role: 'cover|context|problem|solution|workflow|proof|risk|decision',
        title: 'Conclusion-style slide title',
        kicker: '1-3 word slide role',
        claim: 'Conclusion sentence that the slide proves',
        proofObject: 'source summary|workflow|architecture map|capability matrix|evidence list|risk register|decision table|chart',
        supportNote: 'Concise factual support note and assumptions',
        sourceNote: 'Source or verification note',
        facts: ['Source-backed fact or clearly marked assumption'],
        bullets: ['Short supporting point'],
        metric: { value: 'Only if explicitly present in source', label: 'Metric label' },
        chartData: [{ label: 'Only source-backed label', value: 0 }],
        notes: 'Speaker notes',
        layout: 'cover|brief|matrix|process|evidence|risk|decision',
      },
    ],
  };
  const prompt = [
    'Return strict JSON only, no markdown fences.',
    `Shape: ${JSON.stringify(schema)}.`,
    `Locale: ${getLocale()}.`,
    `Brief: ${JSON.stringify(buildBriefFromInputs(state))}.`,
    `Confirmed outline: ${JSON.stringify(state.outline)}.`,
    'Generate a source-grounded presentation blueprint, not positioned slide elements.',
    'Every non-cover slide must have exactly one dominant proof object.',
    'Use chart-first storytelling only when numeric data exists in the supplied source. Never invent precise numbers.',
    'If a URL could not be fetched or source material is insufficient, still generate a useful draft deck, but mark assumptions clearly and avoid precise invented metrics.',
    'Make slide titles claims that remain meaningful after replacing the company/topic name.',
    'Include speaker notes for every slide: lead with takeaway, explain proof, name the decision or next action.',
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
        role: 'cover|context|problem|solution|workflow|proof|risk|decision',
        title: 'Conclusion-style slide title',
        kicker: '1-3 word slide role',
        claim: 'Conclusion sentence that the slide proves',
        proofObject: 'dominant proof object',
        supportNote: 'Concise factual support note and assumptions',
        sourceNote: 'Source or verification note',
        facts: ['Source-backed fact or clearly marked assumption'],
        bullets: ['Short supporting point'],
        metric: { value: 'Only if explicitly present in source', label: 'Metric label' },
        chartData: [{ label: 'Only source-backed label', value: 0 }],
        notes: 'Speaker notes',
        layout: 'cover|brief|matrix|process|evidence|risk|decision',
      },
    ],
  };
  const prompt = [
    'Return strict JSON only, no markdown fences.',
    `Shape: ${JSON.stringify(schema)}.`,
    `Locale: ${getLocale()}.`,
    `User revision request: ${instruction || ''}.`,
    `Deck brief: ${JSON.stringify(buildBriefFromInputs(state))}.`,
    `Current editable deck: ${JSON.stringify({ title: state.title, outline: state.outline, slides: state.slides })}.`,
    'Revise the whole deck as a coherent presentation. Preserve source constraints and never invent precise facts.',
    'Keep the same approximate slide count unless the user explicitly requests a different structure.',
    'Make every slide title a claim and every non-cover slide revolve around one proof object.',
  ].join('\n');
  const data = await askAi(prompt, 3200);
  if (!Array.isArray(data?.slides) || data.slides.length === 0) throw new Error('Invalid deck revision');
  return compileBlueprint({ title: data.title || state.title, slides: data.slides }, state);
}

export async function insertSlideWithAi(state, instruction) {
  const index = Math.min(state.slides.length, Math.max(0, state.slides.findIndex((slide) => slide.id === state.activeSlideId) + 1));
  const prompt = [
    'Return strict JSON only, no markdown fences.',
    'Return one slide using the same editable JSON format as the surrounding slides.',
    `Locale: ${getLocale()}.`,
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
  const method = methodologyFor(state.brief.deckType);
  const claims = method.arc.map((role, index) => claimTitleFor(topic, role, index, state));
  claims[0] = topic;
  return claims.slice(0, state.brief.slideTarget);
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

export function compileBlueprint(blueprint, state) {
  const sourceCount = state.sources?.items?.length || 0;
  const slides = (blueprint.slides || []).slice(0, state.brief.slideTarget).map((item, index, all) => {
    const role = item.role || roleForIndex(index, all.length);
    const slide = {
      id: uid('slide'),
      title: cleanTitle(item.title || item.claim || state.outline[index] || t('newSlideTitle')),
      subtitle: '',
      kicker: String(item.kicker || role).replace(/[-_]/g, ' ').toUpperCase(),
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

function localBlueprint(state, outline) {
  const topic = displayTopic(state.brief.topic || outline[0] || t('defaultDeckTitle'));
  const facts = state.sources?.facts?.length ? state.sources.facts : sourceFallbackFacts(state);
  const hasSource = hasGroundedSource(state);
  const roles = ['cover', 'context', 'problem', 'solution', 'workflow', 'proof', 'risk', 'decision'];
  const titles = [
    topic,
    hasSource ? t('bpContextTitle', { topic }) : t('bpSourceNeededTitle', { topic }),
    t('bpProblemTitle'),
    t('bpSolutionTitle', { topic }),
    t('bpWorkflowTitle'),
    hasSource ? t('bpProofTitle') : t('bpVerificationTitle'),
    t('bpRiskTitle'),
    t('bpDecisionTitle'),
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

function claimTitleFor(topic, role, index, state) {
  const audience = state.brief.audience || 'the audience';
  if (getLocale().startsWith('zh')) {
    const zhAudience = state.brief.audience || '目标受众';
    const zhTitles = {
      thesis: `${topic} 需要一条清晰的决策主线，而不是信息堆砌。`,
      context: `${zhAudience} 需要先看懂变化，再判断选择。`,
      friction: `当前痛点不在信息不足，而在信号没有被组织成决策。`,
      'strategic bet': `关键策略是让证据对象承担页面论证。`,
      'operating model': `从素材到大纲再到页面的闭环，决定输出质量。`,
      proof: `最强证据必须在缩略图尺寸下也能看懂。`,
      risks: `风险可控的前提，是把假设和边界提前说清。`,
      decision: `下一步需要明确负责人、时间点和验收标准。`,
      outcome: `${topic} 应先讲客户结果，再讲产品能力。`,
      pain: `真正的成本来自反复改写，而不是缺少模板。`,
      solution: `方案价值在于把素材转成可编辑的叙事。`,
      traction: `牵引力必须能连接到真实行为或业务结果。`,
      ask: `本轮诉求要直接对应下一阶段里程碑。`,
    };
    return zhTitles[role] || `${topic} 需要用一个证据对象讲清 ${role}。`;
  }
  const titles = {
    thesis: `${topic} needs one decision spine before design starts.`,
    context: `${audience} needs the market shift translated into choices.`,
    friction: `The current workflow hides the signal decision-makers need.`,
    'strategic bet': `The right bet is to make evidence the center of every slide.`,
    'operating model': `A repeatable outline-to-deck loop keeps quality controllable.`,
    proof: `The strongest proof object should carry the argument at thumbnail size.`,
    risks: `Risks are manageable when assumptions are named early.`,
    decision: `The next step is a clear owner, deadline, and acceptance bar.`,
    outcome: `${topic} should start with the buyer outcome, not the product.`,
    pain: `The pain is expensive because teams rewrite instead of deciding.`,
    solution: `The solution wins when it converts source material into editable narrative.`,
    traction: `Traction is credible only when the metric links to behavior.`,
    ask: `The ask should map directly to the next milestone.`,
  };
  return titles[role] || `${topic} becomes clearer when ${role} has one proof object.`;
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
  if (role === 'decision' || index === total - 1) return 'closing';
  if (role === 'workflow') return 'process';
  if (role === 'proof') return 'comparison';
  if (role === 'risk') return 'split';
  return index % 2 ? 'metric' : 'split';
}

function proofForRole(role, sourceCount) {
  const withSource = sourceCount > 0;
  const map = {
    cover: withSource ? t('proofSourceSummary') : t('proofVerificationPlan'),
    context: withSource ? t('proofSourceSummary') : t('proofVerificationPlan'),
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
  if (index === total - 1) return 'decision';
  return ['context', 'problem', 'solution', 'workflow', 'proof', 'risk'][Math.max(0, index - 1) % 6];
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
  return Array.from(new Set(String(value || '').match(/https?:\/\/[^\s)）]+/g) || []));
}

function stripUrls(value) {
  return String(value || '').replace(/https?:\/\/[^\s)）]+/g, '').replace(/\s+/g, ' ');
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
      found.push({
        kind: target.kind,
        title: target.title || target.url,
        url: target.url,
        text: text.slice(0, 9000),
      });
    } catch (error) {
      lastError = error;
    }
  }
  if (found.length) return found;
  throw lastError || new Error('fetch failed');
}

function sourceTargets(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'github.com') {
      const [, owner, repo] = parsed.pathname.split('/');
      if (owner && repo) {
        return [
          {
            kind: 'github-readme',
            title: `${owner}/${repo} README`,
            url: `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/README.md`,
            accept: 'text/plain',
          },
          {
            kind: 'github-api',
            title: `${owner}/${repo}`,
            url: `https://api.github.com/repos/${owner}/${repo}`,
            accept: 'application/vnd.github+json',
          },
          { kind: 'web-page', title: url, url },
        ];
      }
    }
  } catch {
    return [{ kind: 'web-page', title: url, url }];
  }
  return [{ kind: 'web-page', title: url, url }];
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
