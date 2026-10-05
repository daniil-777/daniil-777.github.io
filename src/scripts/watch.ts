/** Small initial loader. No model, simulation, worker or WASM downloads above the fold. */
const mounted = new WeakMap<HTMLElement, { unmount(): void; open(): void } | null>();
const observers = new Set<IntersectionObserver>();
const requestedOpen = new WeakSet<HTMLElement>();
let lifecycle = 0;
async function activate(root: HTMLElement, open = false) {
  if (open) requestedOpen.add(root);
  if (mounted.get(root)) { if (open) mounted.get(root)?.open(); return; }
  if (mounted.has(root)) return;
  mounted.set(root, null);
  const revision = lifecycle;
  try {
    const { mountSmartWatch } = await import('../lib/watch/app');
    if (revision !== lifecycle) return;
    if (!root.isConnected) { mounted.delete(root); return; }
    const handle = mountSmartWatch(root);
    mounted.set(root, handle);
    if (requestedOpen.has(root)) { requestedOpen.delete(root); handle.open(); }
  } catch {
    mounted.delete(root);
    const status = root.querySelector('[data-watch-status]');
    if (status) status.textContent = 'Watch could not load. Use Next thought or reopen it to retry.';
  }
}
function scan() {
  document.querySelectorAll<HTMLElement>('[data-watch]').forEach(root => {
    if (mounted.has(root) || root.dataset.watchObserved) return;
    root.dataset.watchObserved = 'true';
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        observer.disconnect(); observers.delete(observer); void activate(root);
      }, { rootMargin: '100px' });
      observers.add(observer); observer.observe(root);
    } else void activate(root);
  });
}
scan();
document.addEventListener('click', event => {
  const button = (event.target as Element).closest('[data-watch-open], [data-watch-next]');
  const root = button?.closest<HTMLElement>('[data-watch]');
  if (root && !mounted.get(root)) void activate(root, button!.hasAttribute('data-watch-open'));
});
document.addEventListener('astro:page-load', scan);
window.addEventListener('pagehide', () => {
  ++lifecycle;
  observers.forEach(observer => observer.disconnect()); observers.clear();
  document.querySelectorAll<HTMLElement>('[data-watch]').forEach(root => { mounted.get(root)?.unmount(); mounted.delete(root); delete root.dataset.watchObserved; });
});
window.addEventListener('pageshow', event => { if (event.persisted) scan(); });
