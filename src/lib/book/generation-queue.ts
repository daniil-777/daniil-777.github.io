/** One local model and stopping criterion can serve only one generation at a time. */
export function createBookGenerationQueue<Job extends { id: number }>(options: {
  run(job: Job): Promise<void>;
  interrupt(): void;
  cancelled(id: number): void;
}) {
  let tail = Promise.resolve(), active: number | undefined, interrupted = false;
  const waiting = new Map<number, { job: Job; cancelled: boolean }>();
  return {
    enqueue(job: Job): Promise<void> {
      if (!Number.isSafeInteger(job.id) || job.id < 1 || active === job.id || waiting.has(job.id)) return Promise.reject(new Error('Invalid or duplicate book generation ID'));
      const entry = { job, cancelled: false };
      waiting.set(job.id, entry);
      const result = tail.then(async () => {
        waiting.delete(job.id);
        if (entry.cancelled) { options.cancelled(job.id); return; }
        active = job.id; interrupted = false;
        try { await options.run(job); }
        finally { active = undefined; interrupted = false; }
      });
      // A failed request is reported to its caller without poisoning later work.
      tail = result.catch(() => {});
      return result;
    },
    stop(id?: number): void {
      if (id !== undefined && (!Number.isSafeInteger(id) || id < 1)) return;
      if (id === undefined) for (const entry of waiting.values()) entry.cancelled = true;
      else { const entry = waiting.get(id); if (entry) entry.cancelled = true; }
      if (active !== undefined && (id === undefined || id === active) && !interrupted) {
        interrupted = true; options.interrupt();
      }
    },
  };
}
