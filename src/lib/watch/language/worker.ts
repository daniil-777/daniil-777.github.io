/// <reference lib="webworker" />
import type { LanguageCommand, LanguageEvent } from './protocol.ts';
import { LocalLanguageRuntime } from './runtime.ts';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const runtime = new LocalLanguageRuntime((event: LanguageEvent) => scope.postMessage(event));
let queue: Promise<void> = Promise.resolve();
let activeId: string | undefined;
let runningId: string | undefined;
let revision = 0;
scope.addEventListener('message', (event: MessageEvent<LanguageCommand>) => {
  const command = event.data;
  if (command.type === 'cancel') {
    runtime.cancel(command.requestId);
    if (activeId === command.requestId) { activeId = undefined; ++revision; }
    return;
  }
  if (command.type === 'generate' || command.type === 'load' || command.type === 'dispose') {
    if (runningId) runtime.cancel(runningId);
    activeId = command.type === 'generate' ? command.request.requestId : undefined;
  }
  const requestId = command.type === 'generate' ? command.request.requestId : command.requestId;
  const current = ++revision;
  // Mutations are serialized; cancellation is immediate and checked at each next-token boundary.
  queue = queue.then(async () => {
    if (current !== revision && command.type !== 'dispose') {
      scope.postMessage({ type: 'cancelled', requestId } satisfies LanguageEvent); return;
    }
    runningId = requestId;
    try {
      if (command.type === 'load') await runtime.load(requestId, command.manifestUrl);
      else if (command.type === 'generate') await runtime.generate(command.request);
      else if (command.type === 'dispose') await runtime.dispose(requestId);
    } finally { if (runningId === requestId) runningId = undefined; }
  }).catch(error => scope.postMessage({ type: 'error', requestId, message: error instanceof Error ? error.message : 'Local inference failed' } satisfies LanguageEvent));
});
