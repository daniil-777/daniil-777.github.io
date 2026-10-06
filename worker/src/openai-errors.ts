/** Provider billing failures are different from retryable traffic limits. */
import { readCapped } from './logic.ts';

const BILLING_CODES = new Set(['credit_balance_exhausted', 'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded', 'organization_usage_limit_exceeded', 'insufficient_quota']);
type Code = 'credits' | 'overloaded' | 'upstream';
export function openAIError(value: unknown, status?: number): Code {
  const error = typeof value === 'object' && value !== null ? value as { code?: unknown; type?: unknown } : {};
  if (BILLING_CODES.has(String(error.code)) || error.type === 'insufficient_quota') return 'credits';
  if (status === 429 || ['rate_limit_exceeded', 'rate_limit_error', 'slow_down', 'server_is_overloaded'].includes(String(error.code)) || error.type === 'rate_limit_error') return 'overloaded';
  return 'upstream';
}
export async function openAIHttpError(response: Response): Promise<Code> {
  // Never expose upstream messages or let an error body grow without a cap.
  const text = await readCapped(response, 16_384);
  let error: unknown;
  try { error = text ? JSON.parse(text)?.error : undefined; } catch { /* unstructured upstream error */ }
  return openAIError(error, response.status);
}
