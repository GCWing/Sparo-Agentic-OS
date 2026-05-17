const STRINGS = {
  'en-US': {
    eyebrow: 'Built-in App',
    title: 'Personal Desk',
    lede: 'A quiet desk for turning messy life and work concerns into next moves, missing context, and gentle follow-through.',
    makeMine: 'Make this mine',
    remixMove: 'Moving plan',
    remixWork: 'Work chaos',
    stateLabel: 'Focus',
    stateValue: 'Small enough to move',
    memoryLabel: 'Threads',
    memoryValue: 'Editable, saved locally',
    agentLabel: 'Assistant pattern',
    agentValue: 'Capture, structure, act, remember',
    inputLabel: 'What is taking space in your head?',
    inputPlaceholder: 'Drop the messy version here. No need to organize it first.',
    addConcern: 'Structure concern',
    resetDemo: 'Reset demo',
    deskTitle: 'Active desk',
    deskNote: 'Edit any field. Move threads to Waiting, Later, or Done instead of deleting the history.',
    added: 'Structured. Pick the smallest next move and keep going.',
    reset: 'Demo restored.',
    empty: 'Write one concern first.',
    copied: 'A personalized build prompt was copied for Live App Studio.',
    launching: 'Preparing a personal version prompt...',
    next: 'Next move',
    missing: 'Missing',
    risk: 'Watch',
    question: 'One useful question',
    tiny: '10-minute move',
    status: 'Status',
    active: 'Active',
    waiting: 'Waiting',
    later: 'Later',
    done: 'Done',
    ask: 'Ask me one thing',
    tinyMove: 'Tiny next step',
    archive: 'Archive done',
    showDone: 'Show done',
    hideDone: 'Hide done'
  },
  'zh-CN': {
    eyebrow: '\u5185\u7f6e\u5e94\u7528',
    title: '\u4e2a\u4eba\u4e8b\u52a1\u53f0',
    lede: '\u4e00\u4e2a\u5b89\u9759\u7684\u5de5\u4f5c\u53f0\uff0c\u628a\u751f\u6d3b\u548c\u5de5\u4f5c\u91cc\u4e71\u6210\u4e00\u56e2\u7684\u4e8b\uff0c\u53d8\u6210\u4e0b\u4e00\u6b65\u3001\u7f3a\u5931\u4fe1\u606f\u548c\u6e29\u548c\u7684\u8ddf\u8fdb\u3002',
    makeMine: '\u505a\u4e00\u4e2a\u6211\u7684\u7248\u672c',
    remixMove: '\u642c\u5bb6\u8ba1\u5212',
    remixWork: '\u5de5\u4f5c\u4e71\u9ebb',
    stateLabel: '\u7126\u70b9',
    stateValue: '\u5c0f\u5230\u80fd\u63a8\u8fdb',
    memoryLabel: '\u7ebf\u5934',
    memoryValue: '\u53ef\u7f16\u8f91\uff0c\u672c\u5730\u4fdd\u5b58',
    agentLabel: '\u52a9\u7406\u6a21\u5f0f',
    agentValue: '\u6355\u6349\u3001\u7ed3\u6784\u5316\u3001\u884c\u52a8\u3001\u8bb0\u4f4f',
    inputLabel: '\u73b0\u5728\u6700\u5360\u636e\u4f60\u6ce8\u610f\u529b\u7684\u662f\u4ec0\u4e48\uff1f',
    inputPlaceholder: '\u628a\u6df7\u4e71\u7248\u672c\u76f4\u63a5\u653e\u8fdb\u6765\uff0c\u4e0d\u9700\u8981\u5148\u6574\u7406\u3002',
    addConcern: '\u5e2e\u6211\u7ed3\u6784\u5316',
    resetDemo: '\u6062\u590d\u793a\u4f8b',
    deskTitle: '\u5f53\u524d\u4e8b\u52a1\u53f0',
    deskNote: '\u6bcf\u4e2a\u5b57\u6bb5\u90fd\u53ef\u4fee\u6539\u3002\u628a\u4e8b\u60c5\u79fb\u5230\u7b49\u5f85\u3001\u4ee5\u540e\u6216\u5b8c\u6210\uff0c\u800c\u4e0d\u662f\u76f4\u63a5\u5220\u6389\u5386\u53f2\u3002',
    added: '\u5df2\u7ed3\u6784\u5316\u3002\u5148\u9009\u4e00\u4e2a\u6700\u5c0f\u7684\u4e0b\u4e00\u6b65\u3002',
    reset: '\u793a\u4f8b\u5df2\u6062\u590d\u3002',
    empty: '\u5148\u5199\u4e0b\u4e00\u4ef6\u4e8b\u3002',
    copied: '\u4e2a\u4eba\u7248\u672c\u6784\u5efa\u63d0\u793a\u5df2\u590d\u5236\u3002',
    launching: '\u6b63\u5728\u51c6\u5907\u4e2a\u4eba\u7248\u672c\u63d0\u793a...',
    next: '\u4e0b\u4e00\u6b65',
    missing: '\u7f3a\u4ec0\u4e48',
    risk: '\u7559\u610f',
    question: '\u4e00\u4e2a\u6709\u7528\u7684\u95ee\u9898',
    tiny: '10 \u5206\u949f\u52a8\u4f5c',
    status: '\u72b6\u6001',
    active: '\u8fdb\u884c\u4e2d',
    waiting: '\u7b49\u5f85',
    later: '\u4ee5\u540e',
    done: '\u5b8c\u6210',
    ask: '\u95ee\u6211\u4e00\u4e2a\u95ee\u9898',
    tinyMove: '\u751f\u6210\u5c0f\u52a8\u4f5c',
    archive: '\u9690\u85cf\u5df2\u5b8c\u6210',
    showDone: '\u663e\u793a\u5df2\u5b8c\u6210',
    hideDone: '\u9690\u85cf\u5df2\u5b8c\u6210'
  }
};

const DEFAULT_THREADS = [
  { id: 'move', status: 'active', title: 'Move apartments without losing the plot', summary: 'Collect lease dates, deposit rules, moving budget, and the must-not-forget list.', next: 'Write the three immovable dates.', missing: 'Budget range and landlord requirements.', risk: 'Small admin tasks becoming invisible.', question: 'What date cannot move?', tiny: 'Open one note and list the dates.' },
  { id: 'work', status: 'waiting', title: 'Prepare the work update', summary: 'Turn a vague progress report into outcomes, blockers, asks, and a short meeting script.', next: 'List three shipped outcomes.', missing: 'The decision you need from others.', risk: 'Reporting activity instead of progress.', question: 'Who needs to decide what?', tiny: 'Write three bullet outcomes.' },
  { id: 'visa', status: 'later', title: 'Visa renewal packet', summary: 'Keep document status, questions, deadlines, and follow-up messages together.', next: 'Confirm the latest document checklist.', missing: 'Appointment window and photo rules.', risk: 'Using an outdated requirement.', question: 'Which source is official?', tiny: 'Bookmark the official checklist.' }
];

const CUSTOMIZE_PROMPT = `Build my own Personal Desk based on my current threads. Keep the old-friend assistant pattern: capture, structure, ask one useful question, suggest a tiny next step, and remember preferences.`;
const REMIX_PROMPTS = {
  move: `${CUSTOMIZE_PROMPT}\nAdapt it for moving homes: leases, deposits, packing, address changes, appointments, and must-not-forget tasks.`,
  work: `${CUSTOMIZE_PROMPT}\nAdapt it for work chaos: updates, blockers, stakeholders, decisions, and next messages.`
};

let state = { threads: structuredClone(DEFAULT_THREADS), showDone: false };
const $ = (id) => document.getElementById(id);
const locale = () => (window.app && window.app.locale) || 'en-US';
const t = (key) => (STRINGS[locale()] || STRINGS['en-US'])[key] || STRINGS['en-US'][key] || key;
const uid = () => `thread-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((node) => { node.textContent = t(node.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => { node.placeholder = t(node.dataset.i18nPlaceholder); });
}

async function load() {
  try {
    const saved = await app.storage.get('deskState');
    if (saved && Array.isArray(saved.threads)) state = { showDone: false, ...saved };
    state.threads = state.threads.map((thread, index) => ({
      id: thread.id || `thread-${index}`,
      status: thread.status || 'active',
      question: thread.question || 'What would make this easier to start?',
      tiny: thread.tiny || 'Spend 10 minutes on the first visible fact.',
      ...thread
    }));
  } catch (error) {
    app.log.warn('Failed to load desk state', { error: String(error) });
  }
}

function save() {
  app.storage.set('deskState', state).catch((error) => app.log.warn('Failed to save desk state', { error: String(error) }));
}

function inferThread(text) {
  const clean = text.trim();
  const first = clean.split(/[.!?\n\u3002\uff01\uff1f]/).map((part) => part.trim()).find(Boolean) || clean;
  const hasDate = /\d|today|tomorrow|week|month|deadline|date|今天|明天|周|月|截止/.test(clean);
  const hasPerson = /manager|landlord|client|parent|team|同事|客户|房东|家人|老师/.test(clean);
  return {
    id: uid(),
    status: 'active',
    title: first.length > 68 ? `${first.slice(0, 65)}...` : first,
    summary: clean,
    next: hasDate ? 'Put the immovable date on the desk.' : 'Name the smallest visible next step.',
    missing: [hasDate ? '' : 'Deadline', hasPerson ? '' : 'owner or person involved', 'success condition'].filter(Boolean).join(', '),
    risk: 'Letting the concern stay abstract.',
    question: hasPerson ? 'What do you need from that person?' : 'Who else is involved?',
    tiny: 'Set a 10-minute timer and write the first concrete fact.'
  };
}

function updateThread(id, field, value) {
  const thread = state.threads.find((item) => item.id === id);
  if (!thread) return;
  thread[field] = value;
  save();
}

function render() {
  const visible = state.threads.filter((thread) => state.showDone || thread.status !== 'done');
  const activeCount = state.threads.filter((thread) => thread.status !== 'done').length;
  const doneCount = state.threads.length - activeCount;
  $('threadCount').textContent = String(visible.length);
  $('toggleDone').textContent = state.showDone ? t('hideDone') : `${t('showDone')} (${doneCount})`;
  const list = $('threadList');
  list.innerHTML = '';
  visible.forEach((thread) => {
    const card = document.createElement('article');
    card.className = 'thread-card';
    card.innerHTML = `
      <div class="thread-top">
        <input class="inline-title" value="">
        <select class="status-select" aria-label="${t('status')}">
          <option value="active">${t('active')}</option>
          <option value="waiting">${t('waiting')}</option>
          <option value="later">${t('later')}</option>
          <option value="done">${t('done')}</option>
        </select>
      </div>
      <textarea class="inline-summary" rows="3"></textarea>
      <div class="thread-meta">
        ${['next', 'missing', 'risk', 'question', 'tiny'].map((field) => `
          <label class="meta-box"><span class="meta-label">${t(field)}</span><textarea data-field="${field}" rows="2"></textarea></label>
        `).join('')}
      </div>
      <div class="button-row">
        <button class="btn btn-secondary btn-sm ask" type="button">${t('ask')}</button>
        <button class="btn btn-secondary btn-sm tiny" type="button">${t('tinyMove')}</button>
      </div>
    `;
    card.querySelector('.inline-title').value = thread.title;
    card.querySelector('.inline-summary').value = thread.summary;
    card.querySelector('.status-select').value = thread.status;
    card.querySelector('.inline-title').addEventListener('input', (event) => updateThread(thread.id, 'title', event.target.value));
    card.querySelector('.inline-summary').addEventListener('input', (event) => updateThread(thread.id, 'summary', event.target.value));
    card.querySelector('.status-select').addEventListener('change', (event) => { updateThread(thread.id, 'status', event.target.value); render(); });
    card.querySelectorAll('[data-field]').forEach((fieldNode) => {
      const field = fieldNode.dataset.field;
      fieldNode.value = thread[field] || '';
      fieldNode.addEventListener('input', (event) => updateThread(thread.id, field, event.target.value));
    });
    card.querySelector('.ask').addEventListener('click', () => {
      thread.question = thread.missing ? `What would clarify "${thread.missing.split(',')[0]}"?` : 'What would make this easier to start?';
      save();
      render();
    });
    card.querySelector('.tiny').addEventListener('click', () => {
      thread.tiny = `Spend 10 minutes on: ${thread.next || 'the first visible fact'}`;
      save();
      render();
    });
    list.appendChild(card);
  });
}

function setStatus(message) { $('statusLine').textContent = message; }

async function openStudio(prompt = CUSTOMIZE_PROMPT) {
  setStatus(t('launching'));
  const payload = `${prompt}\n\nCurrent threads:\n${JSON.stringify(state.threads, null, 2)}`;
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
  render();
  $('addConcern').addEventListener('click', () => {
    const input = $('concernInput');
    if (!input.value.trim()) return setStatus(t('empty'));
    state.threads.unshift(inferThread(input.value));
    input.value = '';
    save();
    render();
    setStatus(t('added'));
  });
  $('resetDemo').addEventListener('click', () => { state = { threads: structuredClone(DEFAULT_THREADS), showDone: false }; save(); render(); setStatus(t('reset')); });
  $('toggleDone').addEventListener('click', () => { state.showDone = !state.showDone; save(); render(); });
  $('makeMine').addEventListener('click', () => openStudio());
  document.querySelectorAll('.remix-action').forEach((button) => button.addEventListener('click', () => openStudio(REMIX_PROMPTS[button.dataset.remix] || CUSTOMIZE_PROMPT)));
  if (window.app && typeof window.app.onLocaleChange === 'function') window.app.onLocaleChange(() => { applyI18n(); render(); });
}

init();
