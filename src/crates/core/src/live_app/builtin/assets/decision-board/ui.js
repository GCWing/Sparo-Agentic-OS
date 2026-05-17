const STRINGS = {
  'en-US': {
    eyebrow: 'Built-in App',
    title: 'Decision Board',
    lede: 'A decision workspace for keeping options, criteria, evidence, tradeoffs, and open questions in one place.',
    makeMine: 'Make this mine',
    remixSchool: 'School choice',
    remixPurchase: 'Purchase',
    stateLabel: 'Decision',
    stateValue: 'Evidence before confidence',
    evidenceLabel: 'Memo',
    evidenceValue: 'Reasons, gaps, next checks',
    agentLabel: 'Assistant pattern',
    agentValue: 'Compare, challenge, verify',
    optionLabel: 'Add an option',
    optionPlaceholder: 'Example: Refurbished 14-inch laptop',
    noteLabel: 'Evidence or concern',
    notePlaceholder: 'Paste notes, prices, constraints, concerns, or quotes.',
    addOption: 'Add option',
    resetDemo: 'Reset demo',
    boardTitle: 'Decision workspace',
    boardNote: 'A reliable board keeps uncertainty visible. It does not pretend a score is truth.',
    added: 'Option added. Add evidence before trusting a recommendation.',
    reset: 'Demo restored.',
    empty: 'Add a name or note first.',
    copied: 'A personalized build prompt was copied for Live App Studio.',
    launching: 'Preparing a personal version prompt...',
    upside: 'Upside',
    tradeoff: 'Tradeoff',
    question: 'Verify',
    remove: 'Remove',
    decisionQuestion: 'Decision question',
    questionPlaceholder: 'Example: Which laptop should I buy for work and study?',
    memo: 'Decision memo',
    generateMemo: 'Generate memo',
    leaning: 'Current leaning',
    why: 'Why',
    against: 'Strongest counterpoint',
    nextCheck: 'Next verification'
    ,
    addCriterion: 'Add criterion'
  },
  'zh-CN': {
    eyebrow: '\u5185\u7f6e\u5e94\u7528',
    title: '\u51b3\u7b56\u677f',
    lede: '\u4e00\u4e2a\u51b3\u7b56\u5de5\u4f5c\u7a7a\u95f4\uff0c\u628a\u9009\u9879\u3001\u6807\u51c6\u3001\u8bc1\u636e\u3001\u53d6\u820d\u548c\u5f85\u786e\u8ba4\u95ee\u9898\u653e\u5728\u540c\u4e00\u5904\u3002',
    makeMine: '\u505a\u4e00\u4e2a\u6211\u7684\u7248\u672c',
    remixSchool: '\u9009\u6821\u51b3\u7b56',
    remixPurchase: '\u8d2d\u4e70\u51b3\u7b56',
    stateLabel: '\u51b3\u7b56',
    stateValue: '\u5148\u770b\u8bc1\u636e\uff0c\u518d\u8c08\u4fe1\u5fc3',
    evidenceLabel: '\u5907\u5fd8\u5f55',
    evidenceValue: '\u7406\u7531\u3001\u7f3a\u53e3\u3001\u4e0b\u4e00\u6b65\u9a8c\u8bc1',
    agentLabel: '\u52a9\u7406\u6a21\u5f0f',
    agentValue: '\u6bd4\u8f83\u3001\u53cd\u9a73\u3001\u9a8c\u8bc1',
    optionLabel: '\u6dfb\u52a0\u9009\u9879',
    optionPlaceholder: '\u4f8b\u5982\uff1a\u4e8c\u624b 14 \u5bf8\u7b14\u8bb0\u672c',
    noteLabel: '\u8bc1\u636e\u6216\u62c5\u5fc3',
    notePlaceholder: '\u7c98\u8d34\u5907\u6ce8\u3001\u4ef7\u683c\u3001\u9650\u5236\u3001\u62c5\u5fc3\u70b9\u6216\u5f15\u7528\u3002',
    addOption: '\u6dfb\u52a0\u9009\u9879',
    resetDemo: '\u6062\u590d\u793a\u4f8b',
    boardTitle: '\u51b3\u7b56\u5de5\u4f5c\u53f0',
    boardNote: '\u53ef\u9760\u7684\u51b3\u7b56\u677f\u4f1a\u8ba9\u4e0d\u786e\u5b9a\u4fdd\u6301\u53ef\u89c1\uff0c\u4e0d\u4f1a\u628a\u5206\u6570\u5047\u88c5\u6210\u771f\u76f8\u3002',
    added: '\u5df2\u6dfb\u52a0\u3002\u5148\u8865\u8bc1\u636e\uff0c\u518d\u76f8\u4fe1\u5efa\u8bae\u3002',
    reset: '\u793a\u4f8b\u5df2\u6062\u590d\u3002',
    empty: '\u5148\u5199\u9009\u9879\u540d\u6216\u5907\u6ce8\u3002',
    copied: '\u4e2a\u4eba\u7248\u672c\u6784\u5efa\u63d0\u793a\u5df2\u590d\u5236\u3002',
    launching: '\u6b63\u5728\u51c6\u5907\u4e2a\u4eba\u7248\u672c\u63d0\u793a...',
    upside: '\u597d\u5904',
    tradeoff: '\u53d6\u820d',
    question: '\u9a8c\u8bc1',
    remove: '\u79fb\u9664',
    decisionQuestion: '\u51b3\u7b56\u95ee\u9898',
    questionPlaceholder: '\u4f8b\u5982\uff1a\u6211\u5e94\u8be5\u4e70\u54ea\u53f0\u9002\u5408\u5de5\u4f5c\u548c\u5b66\u4e60\u7684\u7535\u8111\uff1f',
    memo: '\u51b3\u7b56\u5907\u5fd8\u5f55',
    generateMemo: '\u751f\u6210\u5907\u5fd8\u5f55',
    leaning: '\u5f53\u524d\u503e\u5411',
    why: '\u539f\u56e0',
    against: '\u6700\u5f3a\u53cd\u65b9\u7406\u7531',
    nextCheck: '\u4e0b\u4e00\u6b65\u9a8c\u8bc1'
    ,
    addCriterion: '\u6dfb\u52a0\u6807\u51c6'
  }
};

const DEFAULT_CRITERIA = [
  { label: 'Budget', weight: 4 },
  { label: 'Reliability', weight: 5 },
  { label: 'Fit', weight: 4 },
  { label: 'Confidence', weight: 3 }
];

const DEFAULT_OPTIONS = [
  { id: 'refurb', name: 'Refurbished 14-inch laptop', note: 'Lower price, portable, enough for writing and browser work. Battery health needs verification.', evidence: 3, upside: 'Best budget fit and easy to carry.', tradeoff: 'May need warranty clarity.', question: 'Can the seller show battery cycle count?' },
  { id: 'new', name: 'New lightweight laptop', note: 'More expensive but predictable warranty, newer chip, better battery life.', evidence: 4, upside: 'Lowest risk over the next two years.', tradeoff: 'Costs more than the practical minimum.', question: 'Is the upgrade worth delaying other plans?' },
  { id: 'keep', name: 'Keep current machine', note: 'No purchase today. Performance is acceptable but meetings and multitasking feel fragile.', evidence: 2, upside: 'Preserves cash immediately.', tradeoff: 'The hidden cost is daily friction.', question: 'Which recurring pain is actually costing time?' }
];

const CUSTOMIZE_PROMPT = 'Build my own Decision Board with editable criteria, evidence strength, decision memos, and verification steps.';
const REMIX_PROMPTS = {
  school: `${CUSTOMIZE_PROMPT}\nAdapt it into a school/program decision board with tuition, location, outcomes, deadlines, visa risk, and personal fit.`,
  purchase: `${CUSTOMIZE_PROMPT}\nAdapt it into a major purchase decision board with reviews, total cost, warranty, must-haves, and deal-breakers.`
};

let state = {
  decisionQuestion: 'Which laptop should I buy for work and study?',
  criteria: structuredClone(DEFAULT_CRITERIA),
  options: structuredClone(DEFAULT_OPTIONS),
  memo: null
};

const $ = (id) => document.getElementById(id);
const locale = () => (window.app && window.app.locale) || 'en-US';
const t = (key) => (STRINGS[locale()] || STRINGS['en-US'])[key] || STRINGS['en-US'][key] || key;
const uid = () => `option-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((node) => { node.textContent = t(node.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => { node.placeholder = t(node.dataset.i18nPlaceholder); });
}

async function load() {
  try {
    const saved = await app.storage.get('decisionState');
    if (saved && Array.isArray(saved.options)) state = { ...state, ...saved };
  } catch (error) {
    app.log.warn('Failed to load decision state', { error: String(error) });
  }
}

function save() {
  app.storage.set('decisionState', state).catch((error) => app.log.warn('Failed to save decision state', { error: String(error) }));
}

function deriveOption(name, note) {
  const text = `${name} ${note}`.toLowerCase();
  const evidence = Math.max(1, Math.min(5, 2 + Number(/warranty|quote|price|review|deadline|proof|证据|报价|评价|截止/.test(text)) + Number(note.length > 90)));
  return {
    id: uid(),
    name: name.trim() || 'Untitled option',
    note: note.trim() || 'No evidence yet.',
    evidence,
    upside: /cheap|budget|低价|便宜/.test(text) ? 'The cost signal is favorable.' : 'There is at least one reason to keep this option visible.',
    tradeoff: /risk|expensive|担心|风险|贵/.test(text) ? 'The risk needs a clear boundary.' : 'The main tradeoff needs sharper wording.',
    question: 'What fact would change the decision?'
  };
}

function updateOption(id, field, value) {
  const option = state.options.find((item) => item.id === id);
  if (!option) return;
  option[field] = field === 'evidence' ? Number(value) : value;
  save();
}

function renderCriteria() {
  const list = $('criteriaList');
  list.innerHTML = '';
  state.criteria.forEach((criterion, index) => {
    const node = document.createElement('div');
    node.className = 'criterion';
    node.innerHTML = '<input class="criterion-name"><input class="criterion-weight" type="range" min="1" max="5"><strong></strong>';
    node.querySelector('.criterion-name').value = criterion.label;
    node.querySelector('.criterion-weight').value = criterion.weight;
    node.querySelector('strong').textContent = `${'●'.repeat(criterion.weight)}${'○'.repeat(5 - criterion.weight)}`;
    node.querySelector('.criterion-name').addEventListener('input', (event) => {
      state.criteria[index].label = event.target.value;
      save();
    });
    node.querySelector('.criterion-weight').addEventListener('input', (event) => {
      state.criteria[index].weight = Number(event.target.value);
      save();
      renderCriteria();
      renderMemo();
    });
    list.appendChild(node);
  });
  const add = document.createElement('button');
  add.className = 'btn btn-secondary btn-sm';
  add.type = 'button';
  add.textContent = t('addCriterion');
  add.addEventListener('click', () => {
    state.criteria.push({ label: 'New criterion', weight: 3 });
    save();
    renderCriteria();
    renderMemo();
  });
  list.appendChild(add);
}

function renderMemo() {
  let box = document.getElementById('decisionMemo');
  if (!box) {
    box = document.createElement('section');
    box.id = 'decisionMemo';
    box.className = 'memo-box';
    $('optionGrid').before(box);
  }
  const memo = state.memo || generateMemo(false);
  box.innerHTML = `
    <h3>${t('memo')}</h3>
    <p><strong>${t('leaning')}:</strong> ${memo.leaning}</p>
    <p><strong>${t('why')}:</strong> ${memo.why}</p>
    <p><strong>${t('against')}:</strong> ${memo.against}</p>
    <p><strong>${t('nextCheck')}:</strong> ${memo.nextCheck}</p>
    <button id="generateMemo" class="btn btn-secondary btn-sm" type="button">${t('generateMemo')}</button>
  `;
  box.querySelector('#generateMemo').addEventListener('click', () => { state.memo = generateMemo(true); save(); renderMemo(); });
}

function generateMemo(persist) {
  const ranked = [...state.options].sort((a, b) => b.evidence - a.evidence);
  const top = ranked[0] || { name: 'No option yet', upside: '', tradeoff: '', question: '' };
  const challenger = ranked[1] || top;
  const memo = {
    leaning: top.name,
    why: `${top.upside} Evidence strength is ${top.evidence || 0}/5, and the highest-weight criteria are ${state.criteria.slice().sort((a, b) => b.weight - a.weight).slice(0, 2).map((c) => c.label).join(' / ')}.`,
    against: challenger === top ? top.tradeoff : `${challenger.name} may still win if its open question is resolved.`,
    nextCheck: top.question || 'Add one piece of evidence that could change the decision.'
  };
  if (persist) state.memo = memo;
  return memo;
}

function renderOptions() {
  $('optionCount').textContent = String(state.options.length);
  const grid = $('optionGrid');
  grid.innerHTML = '';
  state.options.forEach((option) => {
    const card = document.createElement('article');
    card.className = 'option-card';
    card.innerHTML = `
      <header><input class="option-name" value=""><span class="score-pill">${option.evidence}/5</span></header>
      <textarea class="option-note" rows="4"></textarea>
      <label class="mini-label">Evidence strength <input class="evidence-range" type="range" min="1" max="5" value="${option.evidence}"></label>
      <div class="tradeoff">
        <label><span>${t('upside')}</span><textarea data-field="upside" rows="2"></textarea></label>
        <label><span>${t('tradeoff')}</span><textarea data-field="tradeoff" rows="2"></textarea></label>
        <label><span>${t('question')}</span><textarea data-field="question" rows="2"></textarea></label>
      </div>
      <button class="btn btn-secondary btn-sm remove" type="button">${t('remove')}</button>
    `;
    card.querySelector('.option-name').value = option.name;
    card.querySelector('.option-note').value = option.note;
    card.querySelector('.option-name').addEventListener('input', (event) => updateOption(option.id, 'name', event.target.value));
    card.querySelector('.option-note').addEventListener('input', (event) => updateOption(option.id, 'note', event.target.value));
    card.querySelector('.evidence-range').addEventListener('input', (event) => { updateOption(option.id, 'evidence', event.target.value); renderOptions(); renderMemo(); });
    card.querySelectorAll('[data-field]').forEach((node) => {
      node.value = option[node.dataset.field] || '';
      node.addEventListener('input', (event) => updateOption(option.id, node.dataset.field, event.target.value));
    });
    card.querySelector('.remove').addEventListener('click', () => { state.options = state.options.filter((item) => item.id !== option.id); save(); renderOptions(); renderMemo(); });
    grid.appendChild(card);
  });
  renderMemo();
}

function ensureQuestionInput() {
  if (document.getElementById('decisionQuestion')) return;
  const label = document.createElement('label');
  label.textContent = t('decisionQuestion');
  const input = document.createElement('input');
  input.id = 'decisionQuestion';
  input.placeholder = t('questionPlaceholder');
  input.value = state.decisionQuestion || '';
  input.addEventListener('input', (event) => { state.decisionQuestion = event.target.value; save(); });
  const panel = document.querySelector('.side-panel');
  panel.prepend(input);
  panel.prepend(label);
}

function setStatus(message) { $('statusLine').textContent = message; }

async function openStudio(prompt = CUSTOMIZE_PROMPT) {
  setStatus(t('launching'));
  const payload = `${prompt}\n\nDecision state:\n${JSON.stringify(state, null, 2)}`;
  try {
    await app.clipboard.writeText(payload);
    setStatus(t('copied'));
  } catch (error) {
    app.log.warn('Failed to copy customization prompt', { error: String(error) });
    setStatus(t('copied'));
  }
}

async function init() {
  await load();
  applyI18n();
  ensureQuestionInput();
  renderCriteria();
  renderOptions();
  $('addOption').addEventListener('click', () => {
    const name = $('optionName').value;
    const note = $('optionNote').value;
    if (!name.trim() && !note.trim()) return setStatus(t('empty'));
    state.options.unshift(deriveOption(name, note));
    $('optionName').value = '';
    $('optionNote').value = '';
    state.memo = null;
    save();
    renderOptions();
    setStatus(t('added'));
  });
  $('resetDemo').addEventListener('click', () => { state = { decisionQuestion: 'Which laptop should I buy for work and study?', criteria: structuredClone(DEFAULT_CRITERIA), options: structuredClone(DEFAULT_OPTIONS), memo: null }; save(); ensureQuestionInput(); $('decisionQuestion').value = state.decisionQuestion; renderCriteria(); renderOptions(); setStatus(t('reset')); });
  $('makeMine').addEventListener('click', () => openStudio());
  document.querySelectorAll('.remix-action').forEach((button) => button.addEventListener('click', () => openStudio(REMIX_PROMPTS[button.dataset.remix] || CUSTOMIZE_PROMPT)));
  if (window.app && typeof window.app.onLocaleChange === 'function') window.app.onLocaleChange(() => { applyI18n(); ensureQuestionInput(); renderCriteria(); renderOptions(); });
}

init();
