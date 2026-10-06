// Model failures a person can act on (redesign 4h): a refused key, no credit left, "slow down" (429) with how long
// to wait, a free tier used up for the day, a reply cut off, no network. Read from the AI SDK's errors (a provider's
// HTTP answer: status, headers, body), so jobs and screens say what happened instead of a raw message.
import { APICallError, RetryError } from 'ai';

export type ProviderFailure = 'key' | 'credits' | 'rate' | 'quota' | 'cut' | 'offline' | 'network';

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderFailure,
    message: string,
    readonly info: {
      /** The service, from the model ref ("google" in "google:gemini-3.8-flash"). */
      provider: string;
      model: string;
      status?: number;
      /** How long the service asked to wait (rate). */
      retryAfterMs?: number;
      /** When a daily quota starts again (epoch ms). */
      resetAt?: number;
    },
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** The service of a model ref ("fake" for the test model). */
export const serviceOf = (model: string): string => model.split(':')[0] ?? model;

/** Epoch ms of the next midnight in a time zone (a daily quota's reset: Google's is Pacific midnight). */
export function nextMidnightIn(timeZone: string, now = Date.now()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(now));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const localAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  // the zone's offset from UTC now (whole minutes)
  const offset = Math.round((localAsUtc - now) / 60000) * 60000;
  return Date.UTC(get('year'), get('month') - 1, get('day') + 1, 0, 0, 0) - offset;
}

/** How long a 429 asks to wait: `retry-after-ms`, `retry-after` (seconds or a date), or Gemini's `retryDelay`. */
export function retryAfterMs(
  headers: Record<string, string> | undefined,
  body: string | undefined,
  now = Date.now(),
): number | undefined {
  const h = Object.fromEntries(Object.entries(headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const ms = Number(h['retry-after-ms']);
  if (Number.isFinite(ms) && ms >= 0) return ms;
  const ra = h['retry-after'];
  if (ra !== undefined) {
    const s = Number(ra);
    if (Number.isFinite(s) && s >= 0) return s * 1000;
    const at = Date.parse(ra);
    if (!Number.isNaN(at)) return Math.max(0, at - now);
  }
  const delay = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body ?? '');
  if (delay) return Math.round(Number(delay[1]) * 1000);
  return undefined;
}

/** The wait a slow-down asks for, from an API answer. */
const retryOf = (api: APICallError | undefined, now: number): { retryAfterMs?: number } => {
  const ms = retryAfterMs(api?.responseHeaders, api?.responseBody, now);
  return ms !== undefined ? { retryAfterMs: ms } : {};
};

/** What a failed model call means for a person, or null when it is something else (a bug, a bad answer). */
export function classifyModelError(e: unknown, model: string, now = Date.now()): ProviderError | null {
  if (e instanceof ProviderError) return e;
  const err = RetryError.isInstance(e) ? e.lastError : e;
  const provider = serviceOf(model);
  const make = (kind: ProviderFailure, extra: Omit<ProviderError['info'], 'provider' | 'model'> = {}) =>
    new ProviderError(kind, `${provider}: ${(err as Error)?.message ?? String(err)}`.slice(0, 500), {
      provider,
      model,
      ...extra,
    });
  const api = APICallError.isInstance(err) ? err : undefined;
  const status = api?.statusCode;
  const body = `${api?.responseBody ?? ''} ${(err as Error)?.message ?? ''}`;
  if (status !== undefined) {
    // no credit left: OpenAI says "insufficient_quota" (with a 429), Anthropic a 400 "credit balance is too low",
    // xAI a 403 "doesn't have any credits"
    if (
      status === 402 ||
      /insufficient[_ ](quota|balance|credit|funds)|credit balance is too low|purchase credits|(doesn't|does not) have any credits/i.test(
        body,
      )
    )
      return make('credits', { status });
    // a 403 that is not about the key: a request flagged by moderation, a region the service does not serve
    if (status === 403 && /flagged|moderation|region|country|territory/i.test(body)) return null;
    if (status === 401 || status === 403 || (status === 400 && /api[ _-]?key/i.test(body)))
      return make('key', { status });
    // a service overloaded (Anthropic's 529, a 503 that says so): wait as for a slow-down
    if (status === 529 || (status === 503 && /overload/i.test(body)))
      return make('rate', { status, ...retryOf(api, now) });
    if (status === 429) {
      // a rolling limit that says when to try again ("try again in 8.6s") is a slow-down, not a day's quota
      const soon = /try again in (\d+(?:\.\d+)?)\s*s/i.exec(body);
      if (/PerDay|per[ _-]day|daily/i.test(body) && !soon)
        return make('quota', {
          status,
          ...(provider === 'google' ? { resetAt: nextMidnightIn('America/Los_Angeles', now) } : {}),
        });
      const wait = retryAfterMs(api?.responseHeaders, api?.responseBody, now);
      const ms = wait ?? (soon ? Math.ceil(Number(soon[1]) * 1000) : undefined);
      return make('rate', { status, ...(ms !== undefined ? { retryAfterMs: ms } : {}) });
    }
    if (status >= 500 || status === 408) return make('network', { status });
    return null;
  }
  // no answer at all: the network (or no network)
  const message = String((err as Error)?.message ?? err);
  if (
    (api && api.statusCode === undefined) ||
    /fetch failed|failed to fetch|load failed|appears to be offline|cannot connect|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|network/i.test(
      message,
    )
  )
    return make(
      (globalThis as { navigator?: { onLine?: boolean } }).navigator?.onLine === false ? 'offline' : 'network',
    );
  return null;
}
