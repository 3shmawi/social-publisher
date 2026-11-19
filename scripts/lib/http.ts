// fetch with retries for network errors, 429 and 5xx, and errors that never
// include request headers (where the tokens are).

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function request(
  url: string,
  init: RequestInit & { label: string; retries?: number },
): Promise<Response> {
  const { label, retries = 3, ...rest } = init;
  let attempt = 0;
  for (;;) {
    attempt++;
    let response: Response;
    try {
      response = await fetch(url, rest);
    } catch (err) {
      if (attempt > retries) throw new Error(`${label}: network error (${(err as Error).message})`);
      await sleep(attempt * 2000);
      continue;
    }
    if ((response.status === 429 || response.status >= 500) && attempt <= retries) {
      const retryAfter = Number(response.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : attempt * 3000);
      continue;
    }
    return response;
  }
}

/** Request and parse JSON; throws HttpError with a short body on non-2xx. */
export async function requestJson<T>(
  url: string,
  init: RequestInit & { label: string; retries?: number },
): Promise<T> {
  const response = await request(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new HttpError(`${init.label}: HTTP ${response.status} ${truncate(text)}`, response.status, text);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export function truncate(text: string, max = 500): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
