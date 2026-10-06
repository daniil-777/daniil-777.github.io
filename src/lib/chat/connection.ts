import { CLOUD_ENABLED } from '../../data/chat.ts';

/** One endpoint resolution for Ask AI and the book; keys remain server-side. */
export function chatConnection(environment: { PUBLIC_LOCAL_CHAT_ENDPOINT?: string; PUBLIC_CHAT_ENDPOINT?: string } = import.meta.env ?? {}) {
  const configuredLocal = String(environment.PUBLIC_LOCAL_CHAT_ENDPOINT ?? '').trim();
  const local = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/?$/.test(configuredLocal) ? configuredLocal : '';
  return { local, endpoint: local || (CLOUD_ENABLED ? String(environment.PUBLIC_CHAT_ENDPOINT ?? '').trim() : '') };
}
