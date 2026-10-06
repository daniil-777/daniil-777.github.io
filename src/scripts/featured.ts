/** Selected work uses a list until the visitor explicitly chooses the grid. */
const section = document.querySelector<HTMLElement>('#featured');
const items = section?.querySelector<HTMLElement>('[data-featured-items]');

if (section && items) {
  const buttons = [...section.querySelectorAll<HTMLButtonElement>('[data-featured-view-btn]')];
  const images = [...items.querySelectorAll<HTMLImageElement>('.tile__media img')];
  const key = 'featured-view';

  function setView(view: 'list' | 'grid') {
    items!.dataset.view = view;
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.featuredViewBtn === view));
    for (const image of images) image.sizes = (view === 'list' ? image.dataset.listSizes : image.dataset.gridSizes) ?? image.sizes;
  }

  let saved: string | null = null;
  try { saved = localStorage.getItem(key); } catch { /* Storage can be unavailable in private browsing. */ }
  setView(saved === 'grid' ? 'grid' : 'list');

  for (const button of buttons) {
    button.addEventListener('click', () => {
      const view = button.dataset.featuredViewBtn === 'grid' ? 'grid' : 'list';
      setView(view);
      try { localStorage.setItem(key, view); } catch { /* Keep this visit's choice. */ }
    });
  }
}
