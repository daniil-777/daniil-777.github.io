import type { APIRoute } from 'astro';
import { getChatResources } from '../../lib/chat/resource-catalog';

export const GET: APIRoute = async () => Response.json(await getChatResources());
