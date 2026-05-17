const STRINGS = {
  'en-US': {
    eyebrow: 'Built-in App',
    title: 'Micro Operator',
    lede: 'A small operations cockpit for people, follow-ups, next actions, and ready-to-edit messages.',
    makeMine: 'Make this mine',
    remixTeacher: 'Teacher flow',
    remixCreator: 'Creator flow',
    stateLabel: 'Today',
    stateValue: 'Follow-ups first',
    draftLabel: 'Drafting',
    draftValue: 'Bound to selected record',
    agentLabel: 'Assistant pattern',
    agentValue: 'Track, draft, follow up',
    pipelineTitle: 'Follow-up pipeline',
    pipelineNote: 'Select a record to draft the next message. Due items stay visible until resolved.',
    contactLabel: 'Contact or item',
    contactPlaceholder: 'Example: Maya, trial class',
    noteLabel: 'What needs to happen?',
    notePlaceholder: 'Example: Send class notes, ask how the first session felt, and invite her to next week.',
    addRecord: 'Add record',
    resetDemo: 'Reset demo',
    draftTitle: 'Next message draft',
    copyDraft: 'Copy draft',
    added: 'Record added. The next follow-up is visible.',
    reset: 'Demo restored.',
    empty: 'Add a contact or note first.',
    copied: 'Draft copied.',
    promptCopied: 'A personalized build prompt was copied for Live App Studio.',
    launching: 'Preparing a personal version prompt...',
    advance: 'Advance',
    done: 'Done',
    due: 'Due',
    today: 'Today',
    tone: 'Tone',
    concise: 'Concise',
    warm: 'Warm',
    formal: 'Formal',
    select: 'Select'
    ,
    batchLabel: 'Paste scattered notes',
    batchPlaceholder: 'One item per line. Example: Maya - send trial class notes tomorrow',
    importNotes: 'Import notes',
    imported: 'Notes imported.'
  },
  'zh-CN': {
    eyebrow: '\u5185\u7f6e\u5e94\u7528',
    title: '\u5c0f\u8fd0\u8425\u53f0',
    lede: '\u4e00\u4e2a\u5c0f\u578b\u8fd0\u8425\u9a7e\u9a76\u8231\uff0c\u7ba1\u4eba\u3001\u8ddf\u8fdb\u3001\u4e0b\u4e00\u6b65\u548c\u53ef\u7f16\u8f91\u7684\u6d88\u606f\u8349\u7a3f\u3002',
    makeMine: '\u505a\u4e00\u4e2a\u6211\u7684\u7248\u672c',
    remixTeacher: '\u6559\u5e08\u6d41\u7a0b',
    remixCreator: '\u521b\u4f5c\u8005\u6d41\u7a0b',
    stateLabel: '\u4eca\u65e5',
    stateValue: '\u5148\u5904\u7406\u8ddf\u8fdb',
    draftLabel: '\u8349\u7a3f',
    draftValue: '\u7ed1\u5b9a\u9009\u4e2d\u8bb0\u5f55',
    agentLabel: '\u52a9\u7406\u6a21\u5f0f',
    agentValue: '\u8ddf\u8e2a\u3001\u8d77\u8349\u3001\u63a8\u8fdb',
    pipelineTitle: '\u8ddf\u8fdb\u6d41\u7a0b',
    pipelineNote: '\u9009\u4e2d\u4e00\u6761\u8bb0\u5f55\u5373\u53ef\u8d77\u8349\u4e0b\u4e00\u6761\u6d88\u606f\u3002\u5230\u671f\u4e8b\u9879\u4f1a\u4e00\u76f4\u53ef\u89c1\u3002',
    contactLabel: '\u8054\u7cfb\u4eba\u6216\u4e8b\u9879',
    contactPlaceholder: '\u4f8b\u5982\uff1aMaya\uff0c\u4f53\u9a8c\u8bfe',
    noteLabel: '\u63a5\u4e0b\u6765\u8981\u53d1\u751f\u4ec0\u4e48\uff1f',
    notePlaceholder: '\u4f8b\u5982\uff1a\u53d1\u9001\u8bfe\u7a0b\u7b14\u8bb0\uff0c\u8be2\u95ee\u7b2c\u4e00\u6b21\u4f53\u9a8c\u611f\u53d7\uff0c\u5e76\u9080\u8bf7\u5979\u53c2\u52a0\u4e0b\u5468\u8bfe\u7a0b\u3002',
    addRecord: '\u6dfb\u52a0\u8bb0\u5f55',
    resetDemo: '\u6062\u590d\u793a\u4f8b',
    draftTitle: '\u4e0b\u4e00\u6761\u6d88\u606f\u8349\u7a3f',
    copyDraft: '\u590d\u5236\u8349\u7a3f',
    added: '\u5df2\u6dfb\u52a0\u3002\u4e0b\u4e00\u6b21\u8ddf\u8fdb\u5df2\u7ecf\u53ef\u89c1\u3002',
    reset: '\u793a\u4f8b\u5df2\u6062\u590d\u3002',
    empty: '\u5148\u5199\u8054\u7cfb\u4eba\u6216\u5907\u6ce8\u3002',
    copied: '\u8349\u7a3f\u5df2\u590d\u5236\u3002',
    promptCopied: '\u4e2a\u4eba\u7248\u672c\u6784\u5efa\u63d0\u793a\u5df2\u590d\u5236\u3002',
    launching: '\u6b63\u5728\u51c6\u5907\u4e2a\u4eba\u7248\u672c\u63d0\u793a...',
    advance: '\u63a8\u8fdb',
    done: '\u5b8c\u6210',
    due: '\u5230\u671f',
    today: '\u4eca\u65e5',
    tone: '\u8bed\u6c14',
    concise: '\u7b80\u77ed',
    warm: '\u6e29\u548c',
    formal: '\u6b63\u5f0f',
    select: '\u9009\u4e2d'
    ,
    batchLabel: '\u7c98\u8d34\u96f6\u6563\u5907\u6ce8',
    batchPlaceholder: '\u6bcf\u884c\u4e00\u6761\u3002\u4f8b\u5982\uff1aMaya - \u660e\u5929\u53d1\u4f53\u9a8c\u8bfe\u7b14\u8bb0',
    importNotes: '\u5bfc\u5165\u5907\u6ce8',
    imported: '\u5907\u6ce8\u5df2\u5bfc\u5165\u3002'
  }
};

const STAGES = ['New', 'Needs reply', 'Waiting', 'Done'];
const today = () => new Date().toISOString().slice(0, 10);
const DEFAULT_RECORDS = [
  { id: 'maya', name: 'Maya - trial class', note: 'Send class notes, ask how the first session felt, and invite her to next week.', stage: 'Needs reply', due: today(), tone: 'warm' },
  { id: 'workshop', name: 'Corporate workshop', note: 'Confirm attendee count and send a short agenda before Friday.', stage: 'Waiting', due: today(), tone: 'formal' },
  { id: 'newsletter', name: 'June newsletter', note: 'Collect three student stories and draft the opening paragraph.', stage: 'New', due: '', tone: 'concise' }
];

const CUSTOMIZE_PROMPT = 'Build my own Micro Operator with records, pipeline stages, due follow-ups, selected-record drafting, and tone controls.';
const REMIX_PROMPTS = {
  teacher: `${CUSTOMIZE_PROMPT}\nAdapt it for teacher/student follow-up: trial classes, notes, feedback, renewals, and parent/student messages.`,
  creator: `${CUSTOMIZE_PROMPT}\nAdapt it for creator operations: sponsors, drafts, publishing status, follow-up messages, and content opportunities.`
};

let state = { records: structuredClone(DEFAULT_RECORDS), selectedId: 'maya' };
const $ = (id) => document.getElementById(id);
const locale = () => (window.app && window.app.locale) || 'en-US';
const t = (key) => (STRINGS[locale()] || STRINGS['en-US'])[key] || STRINGS['en-US'][key] || key;
const uid = () => `record-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((node) => { node.textContent = t(node.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => { node.placeholder = t(node.dataset.i18nPlaceholder); });
}

async function load() {
  try {
    const saved = await app.storage.get('operatorState');
    if (saved && Array.isArray(saved.records)) state = { selectedId: saved.records[0]?.id, ...saved };
  } catch (error) {
    app.log.warn('Failed to load operator state', { error: String(error) });
  }
}

function save() {
  app.storage.set('operatorState', state).catch((error) => app.log.warn('Failed to save operator state', { error: String(error) }));
}

function selectedRecord() {
  return state.records.find((record) => record.id === state.selectedId) || state.records.find((record) => record.stage !== 'Done') || state.records[0];
}

function draftFor(record) {
  if (!record) return 'Select a record and this becomes a ready-to-edit message.';
  const name = record.name.split('-')[0].trim();
  if (record.tone === 'formal') return `Hello ${name}, I wanted to follow up regarding: ${record.note} Please let me know the best next step when convenient.`;
  if (record.tone === 'concise') return `Hi ${name}, quick follow-up: ${record.note} Should I send the next step today?`;
  return `Hi ${name}, just wanted to gently follow up on this: ${record.note} Would it help if I sent the next step today?`;
}

function updateRecord(id, field, value) {
  const record = state.records.find((item) => item.id === id);
  if (!record) return;
  record[field] = value;
  save();
}

function recordFromLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const [rawName, ...rest] = trimmed.split(/\s[-:：]\s| - |: /);
  const note = rest.join(' - ').trim();
  return {
    id: uid(),
    name: rawName.trim() || 'Untitled follow-up',
    note: note || trimmed,
    stage: /wait|waiting|等|回复/.test(trimmed.toLowerCase()) ? 'Waiting' : 'New',
    due: /today|tonight|今天|今晚/.test(trimmed.toLowerCase()) ? today() : '',
    tone: 'warm'
  };
}

function renderDraft() {
  const record = selectedRecord();
  if (record) state.selectedId = record.id;
  $('draftText').textContent = draftFor(record);
}

function renderToday() {
  let box = document.getElementById('todayBox');
  if (!box) {
    box = document.createElement('section');
    box.id = 'todayBox';
    box.className = 'today-box';
    document.querySelector('.side-panel').insertBefore(box, document.querySelector('.draft-box'));
  }
  const due = state.records.filter((record) => record.stage !== 'Done' && record.due && record.due <= today());
  box.innerHTML = `<h2>${t('today')}</h2>${due.length ? due.map((record) => `<button class="today-item" data-id="${record.id}" type="button">${record.name}<span>${record.due}</span></button>`).join('') : `<p>${t('stateValue')}</p>`}`;
  box.querySelectorAll('.today-item').forEach((item) => item.addEventListener('click', () => { state.selectedId = item.dataset.id; save(); render(); }));
}

function render() {
  $('recordCount').textContent = String(state.records.length);
  const columns = $('columns');
  columns.innerHTML = '';
  STAGES.forEach((stage) => {
    const column = document.createElement('section');
    column.className = 'column';
    column.innerHTML = `<h3>${stage}</h3><div class="record-stack"></div>`;
    const stack = column.querySelector('.record-stack');
    state.records.filter((record) => record.stage === stage).forEach((record) => {
      const card = document.createElement('article');
      card.className = `record-card${record.id === state.selectedId ? ' is-selected' : ''}`;
      card.innerHTML = `
        <input class="record-name" value="">
        <textarea class="record-note" rows="3"></textarea>
        <label class="mini-label">${t('due')}<input class="record-due" type="date"></label>
        <label class="mini-label">${t('tone')}<select class="record-tone"><option value="concise">${t('concise')}</option><option value="warm">${t('warm')}</option><option value="formal">${t('formal')}</option></select></label>
        <div class="record-actions">
          <button class="btn btn-secondary btn-sm select" type="button">${t('select')}</button>
          <button class="btn btn-secondary btn-sm advance" type="button">${t('advance')}</button>
          <button class="btn btn-secondary btn-sm done" type="button">${t('done')}</button>
        </div>
      `;
      card.querySelector('.record-name').value = record.name;
      card.querySelector('.record-note').value = record.note;
      card.querySelector('.record-due').value = record.due || '';
      card.querySelector('.record-tone').value = record.tone || 'warm';
      card.querySelector('.record-name').addEventListener('input', (event) => updateRecord(record.id, 'name', event.target.value));
      card.querySelector('.record-note').addEventListener('input', (event) => updateRecord(record.id, 'note', event.target.value));
      card.querySelector('.record-due').addEventListener('input', (event) => { updateRecord(record.id, 'due', event.target.value); renderToday(); });
      card.querySelector('.record-tone').addEventListener('change', (event) => { updateRecord(record.id, 'tone', event.target.value); renderDraft(); });
      card.querySelector('.select').addEventListener('click', () => { state.selectedId = record.id; save(); render(); });
      card.querySelector('.advance').addEventListener('click', () => {
        const current = STAGES.indexOf(record.stage);
        record.stage = STAGES[Math.min(STAGES.length - 1, current + 1)];
        state.selectedId = record.id;
        save();
        render();
      });
      card.querySelector('.done').addEventListener('click', () => { record.stage = 'Done'; save(); render(); });
      stack.appendChild(card);
    });
    columns.appendChild(column);
  });
  renderToday();
  renderDraft();
}

function setStatus(message) { $('statusLine').textContent = message; }

async function openStudio(prompt = CUSTOMIZE_PROMPT) {
  setStatus(t('launching'));
  const payload = `${prompt}\n\nCurrent operation records:\n${JSON.stringify(state.records, null, 2)}`;
  try {
    await app.clipboard.writeText(payload);
    setStatus(t('promptCopied'));
  } catch (error) {
    app.log.warn('Failed to copy customization prompt', { error: String(error) });
    setStatus(t('promptCopied'));
  }
}

async function init() {
  await load();
  applyI18n();
  render();
  $('addRecord').addEventListener('click', () => {
    const name = $('contactName').value.trim();
    const note = $('contactNote').value.trim();
    if (!name && !note) return setStatus(t('empty'));
    const record = { id: uid(), name: name || 'Untitled follow-up', note: note || 'Clarify the next action.', stage: 'New', due: today(), tone: 'warm' };
    state.records.unshift(record);
    state.selectedId = record.id;
    $('contactName').value = '';
    $('contactNote').value = '';
    save();
    render();
    setStatus(t('added'));
  });
  $('importNotes').addEventListener('click', () => {
    const notes = $('batchNotes').value.split(/\r?\n/).map(recordFromLine).filter(Boolean);
    if (!notes.length) return setStatus(t('empty'));
    state.records = [...notes, ...state.records];
    state.selectedId = notes[0].id;
    $('batchNotes').value = '';
    save();
    render();
    setStatus(t('imported'));
  });
  $('resetDemo').addEventListener('click', () => { state = { records: structuredClone(DEFAULT_RECORDS), selectedId: 'maya' }; save(); render(); setStatus(t('reset')); });
  $('copyDraft').addEventListener('click', async () => {
    try {
      await app.clipboard.writeText($('draftText').textContent || '');
      setStatus(t('copied'));
    } catch (error) {
      app.log.warn('Failed to copy draft', { error: String(error) });
    }
  });
  $('makeMine').addEventListener('click', () => openStudio());
  $('draftText').setAttribute('contenteditable', 'true');
  document.querySelectorAll('.remix-action').forEach((button) => button.addEventListener('click', () => openStudio(REMIX_PROMPTS[button.dataset.remix] || CUSTOMIZE_PROMPT)));
  if (window.app && typeof window.app.onLocaleChange === 'function') window.app.onLocaleChange(() => { applyI18n(); render(); });
}

init();
