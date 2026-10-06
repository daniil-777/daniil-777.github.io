/** Compact, keyboard-accessible model picker beneath the composer. */
import { COPY } from '../../data/chat.ts';
import type { Mode, ModeOption } from './view.ts';

function svg(paths: string[], className: string) {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [name, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: className })) icon.setAttribute(name, value);
  for (const d of paths) { const path = document.createElementNS(icon.namespaceURI, 'path'); path.setAttribute('d', d); icon.append(path); }
  return icon;
}
const symbols = {
  cloud: ['m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z'],
  device: ['M7 7h10v10H7Z', 'M9 3v4m6-4v4M9 17v4m6-4v4M3 9h4m-4 6h4m10-6h4m-4 6h4'],
  quotes: ['M5 4h14v16H5Z', 'M9 8h6m-6 4h6m-6 4h3'],
};
const descriptions = { cloud: 'Conversational answers with portfolio sources', device: 'Private answers on this device', quotes: 'Instant sources, documents and videos' };
export function createModelSelector(select: (mode: Mode) => void) {
  const element = document.createElement('div'); element.className = 'chat__model-picker';
  const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'chat__model-trigger';
  trigger.setAttribute('data-model-select', ''); trigger.setAttribute('aria-haspopup', 'menu'); trigger.setAttribute('aria-expanded', 'false');
  const menu = document.createElement('div'); menu.className = 'chat__model-menu'; menu.hidden = true; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Choose a model');
  element.append(trigger, menu);
  const buttons = () => [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
  const close = (focus = false) => { menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); if (focus && !trigger.disabled) trigger.focus(); };
  function open() {
    if (trigger.disabled) return;
    menu.hidden = false; trigger.setAttribute('aria-expanded', 'true');
    (buttons().find(b => b.getAttribute('aria-checked') === 'true') ?? buttons()[0])?.focus();
  }
  trigger.addEventListener('click', () => menu.hidden ? open() : close(true));
  trigger.addEventListener('keydown', event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); open(); } });
  element.addEventListener('keydown', event => {
    if (menu.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (event.key === 'Tab') { close(true); return; }
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const choices = buttons(), at = choices.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
    choices[next]?.focus();
  });
  document.addEventListener('pointerdown', event => { if (!element.contains(event.target as Node)) close(); });
  return { element, close,
    busy(on: boolean) { trigger.disabled = on; if (on) close(); },
    update(options: ModeOption[], current: Mode) {
      const focused = menu.contains(document.activeElement) ? (document.activeElement as HTMLButtonElement).dataset.modelOption : undefined;
      const selected = options.find(option => option.mode === current);
      trigger.replaceChildren(svg(symbols[current], 'chat__model-icon'), document.createTextNode(selected?.label ?? COPY.modes[current].option), svg(['m8 10 4 4 4-4'], 'chat__model-caret'));
      trigger.setAttribute('aria-label', `Choose a model. Current: ${selected?.label ?? COPY.modes[current].option}`);
      menu.replaceChildren(...options.map(option => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'chat__model-option'; button.disabled = option.disabled !== undefined;
        button.dataset.modelOption = option.mode; button.setAttribute('role', 'menuitemradio'); button.setAttribute('aria-checked', String(option.mode === current)); button.tabIndex = -1;
        const text = document.createElement('span'), name = document.createElement('strong'), detail = document.createElement('small');
        name.textContent = option.label ?? COPY.modes[option.mode].option; detail.textContent = option.disabled || option.description || descriptions[option.mode]; text.append(name, detail);
        button.append(svg(symbols[option.mode], 'chat__model-icon'), text, svg(['m6 12 4 4 8-8'], 'chat__model-check'));
        button.addEventListener('click', () => { close(); select(option.mode); if (!trigger.disabled) trigger.focus(); });
        return button;
      }));
      if (!menu.hidden && focused) (buttons().find(button => button.dataset.modelOption === focused) ?? buttons()[0] ?? trigger).focus();
    },
  };
}
