const OPEN_SELECTS = new Set();

function closeSelect(wrap) {
  const menu = wrap.querySelector('.ppt-flat-select__menu');
  const trigger = wrap.querySelector('.ppt-flat-select__trigger');
  if (!menu || !trigger) return;
  menu.hidden = true;
  trigger.setAttribute('aria-expanded', 'false');
  wrap.classList.remove('is-open');
  OPEN_SELECTS.delete(wrap);
}

function closeAllExcept(exceptWrap) {
  OPEN_SELECTS.forEach((wrap) => {
    if (wrap !== exceptWrap) closeSelect(wrap);
  });
}

function syncFlatSelect(select) {
  const wrap = select.closest('.ppt-flat-select');
  if (!wrap) return;
  const label = wrap.querySelector('.ppt-flat-select__label');
  const menu = wrap.querySelector('.ppt-flat-select__menu');
  const selected = select.options[select.selectedIndex];
  if (label) label.textContent = selected?.textContent || '';
  if (!menu) return;

  const existing = new Map([...menu.querySelectorAll('.ppt-flat-select__option')].map((node) => [node.dataset.value, node]));
  [...select.options].forEach((opt) => {
    let item = existing.get(opt.value);
    if (!item) {
      item = document.createElement('button');
      item.type = 'button';
      item.className = 'ppt-flat-select__option';
      item.setAttribute('role', 'option');
      item.dataset.value = opt.value;
      item.addEventListener('click', () => {
        select.value = opt.value;
        syncFlatSelect(select);
        closeSelect(wrap);
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      menu.append(item);
    }
    item.textContent = opt.textContent;
    const isSelected = opt.value === select.value;
    item.classList.toggle('is-selected', isSelected);
    item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
  });

  [...menu.querySelectorAll('.ppt-flat-select__option')].forEach((node) => {
    if (![...select.options].some((opt) => opt.value === node.dataset.value)) node.remove();
  });
}

export function enhanceFlatSelect(select) {
  if (!select || select.dataset.flatSelect === 'true') return;
  select.dataset.flatSelect = 'true';
  select.classList.add('ppt-flat-select__native');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');

  const wrap = document.createElement('div');
  wrap.className = 'ppt-flat-select';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'ppt-flat-select__trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');

  const label = document.createElement('span');
  label.className = 'ppt-flat-select__label';
  trigger.append(label);

  const menu = document.createElement('div');
  menu.className = 'ppt-flat-select__menu';
  menu.hidden = true;
  menu.setAttribute('role', 'listbox');

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    const isOpen = wrap.classList.contains('is-open');
    closeAllExcept(null);
    if (isOpen) {
      closeSelect(wrap);
      return;
    }
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    wrap.classList.add('is-open');
    OPEN_SELECTS.add(wrap);
  });

  const parent = select.parentNode;
  parent.insertBefore(wrap, select);
  wrap.append(trigger, menu, select);
  syncFlatSelect(select);
}

export function enhanceFlatSelects(root = document) {
  root.querySelectorAll('select.ppt-flat-select, select#themeInput, select#slideTargetInput').forEach((select) => {
    enhanceFlatSelect(select);
  });
}

export function refreshFlatSelectLabels() {
  document.querySelectorAll('select[data-flat-select="true"]').forEach((select) => {
    syncFlatSelect(select);
  });
}

if (!window.__pptLiveFlatSelectBound) {
  window.__pptLiveFlatSelectBound = true;
  document.addEventListener('click', () => closeAllExcept(null));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAllExcept(null);
  });
}
