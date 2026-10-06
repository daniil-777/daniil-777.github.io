type BookHandle = { unmount(): void };

function mountWidgets(root: HTMLElement) {
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[data-widget-tab]')];
  const panels = [...root.querySelectorAll<HTMLElement>('[data-widget-panel]')];
  let book: BookHandle | undefined;
  let loading: Promise<void> | undefined;
  let disposed = false;
  const select = (name: string, focus = false) => {
    for (const tab of tabs) {
      const selected = tab.dataset.widgetTab === name;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    }
    for (const panel of panels) {
      const active = panel.dataset.widgetPanel === name;
      panel.hidden = !active;
      panel.toggleAttribute('data-widget-active', active);
      panel.querySelector('[data-book]')?.dispatchEvent(new Event(active ? 'ai-widget-show' : 'ai-widget-hide'));
    }
    if (name === 'book' && !book && !loading) {
      loading = import('../lib/book/app').then(({ mountAiBook }) => {
        if (disposed) return;
        const element = root.querySelector<HTMLElement>('[data-book]');
        if (element) book = mountAiBook(element);
      }).catch(() => {
        const status = root.querySelector('[data-book-status]');
        if (status) status.textContent = 'The local model could not write a thought. Try again or replay the sample.';
      }).finally(() => { loading = undefined; });
    }
  };
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('click', () => select(tab.dataset.widgetTab!));
    tab.addEventListener('keydown', event => {
      let next: number;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else return;
      event.preventDefault();
      select(tabs[next].dataset.widgetTab!, true);
    });
  }
  const hash = () => { if (location.hash.startsWith('#ai-book')) select('book'); else if (location.hash === '#smart-watch') select('watch'); };
  select('watch');
  hash();
  window.addEventListener('hashchange', hash);
  window.addEventListener('pageshow', () => { if (!disposed && !root.querySelector<HTMLElement>('[data-widget-panel="book"]')?.hidden) root.querySelector('[data-book]')?.dispatchEvent(new Event('ai-widget-show')); });
  window.addEventListener('pagehide', event => {
    if (event.persisted) return;
    disposed = true;
    book?.unmount();
    window.removeEventListener('hashchange', hash);
  });
}

document.querySelectorAll<HTMLElement>('[data-ai-widgets]').forEach(mountWidgets);
