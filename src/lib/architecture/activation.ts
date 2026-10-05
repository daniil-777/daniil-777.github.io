/** One automatic activation, only while visible and permitted by visitor preferences. */
export function activateWhenVisible(element: Element, activate: () => void): () => void {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (reduced.matches || connection?.saveData) return () => {};
  let visible = false;
  let stopped = false;
  const stop = () => {
    stopped = true;
    observer.disconnect();
    document.removeEventListener('visibilitychange', check);
  };
  const check = () => {
    if (stopped || !visible || document.hidden || reduced.matches || connection?.saveData) return;
    stop();
    activate();
  };
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting && entry.intersectionRatio >= .2;
    check();
  }, { threshold: .2 });
  observer.observe(element);
  document.addEventListener('visibilitychange', check);
  return stop;
}
