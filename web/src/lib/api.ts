/** Fetch wrapper. All mutating requests carry X-CyberDome: 1 (server-side CSRF guard). */
export class ApiError extends Error {
  status: number;
  issues?: { path: string; message: string }[];
  details?: unknown;
  constructor(status: number, message: string, issues?: any, details?: unknown) {
    super(message);
    this.status = status;
    this.issues = issues;
    this.details = details;
  }
}

async function handle<T>(res: Response): Promise<T> {
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('application/json') ? await res.json().catch(() => null) : await res.text().catch(() => null);
  if (!res.ok) {
    const msg = (body && typeof body === 'object' && (body as any).error) || (res.status === 0 ? 'The server is unreachable.' : `Request failed (${res.status}).`);
    throw new ApiError(res.status, msg, (body as any)?.issues, (body as any)?.details);
  }
  return body as T;
}

/**
 * Read-only preview mode (static hosting): GET requests are answered from a captured snapshot of
 * real API responses; every change is refused. Enabled only in builds made with VITE_PREVIEW=1.
 */
export const PREVIEW = import.meta.env.VITE_PREVIEW === '1';
let snapshot: Record<string, unknown> | null = null;
export function setSnapshot(s: Record<string, unknown>) {
  snapshot = s;
}
export function snapshotKey(url: string): string {
  const u = new URL(url, 'http://x');
  const params = [...u.searchParams.entries()].filter(([, v]) => v !== '').sort(([a], [b]) => a.localeCompare(b));
  return u.pathname + (params.length ? '?' + params.map(([k, v]) => `${k}=${v}`).join('&') : '');
}
function fromSnapshot<T>(method: string, url: string): T {
  if (method !== 'GET')
    throw new ApiError(405, 'This is a read-only preview. Run CyberDome locally (npm start) to import evidence and make changes.');
  const key = snapshotKey(url);
  if (snapshot && key in snapshot) return structuredClone(snapshot[key]) as T;
  // Only fall back to the unparameterized capture for pure paging/sorting params; never show
  // unfiltered data in place of a filtered request.
  const [bare, q = ''] = key.split('?');
  const onlyPaging = q.split('&').filter(Boolean).every((kv) => /^(limit|offset|sort|dir)=/.test(kv));
  if (snapshot && onlyPaging && bare in snapshot) return structuredClone(snapshot[bare]) as T;
  throw new ApiError(404, 'This view was not captured in the read-only preview. Run CyberDome locally to use it.');
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  if (PREVIEW) return fromSnapshot<T>(method, url);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body instanceof FormData ? { 'X-CyberDome': '1' } : { 'Content-Type': 'application/json', 'X-CyberDome': '1' },
      body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the CyberDome server. Check that it is running (npm start).');
  }
  return handle<T>(res);
}

export const api = {
  get: <T = any>(url: string) => req<T>('GET', url),
  post: <T = any>(url: string, body?: unknown) => req<T>('POST', url, body ?? {}),
  put: <T = any>(url: string, body?: unknown) => req<T>('PUT', url, body ?? {}),
  patch: <T = any>(url: string, body?: unknown) => req<T>('PATCH', url, body ?? {}),
  del: <T = any>(url: string, body?: unknown) => req<T>('DELETE', url, body),
  upload: <T = any>(url: string, form: FormData) => req<T>('POST', url, form),
};

/** Build a query string, dropping empty values. */
export function qs(params: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.issues?.length) return `${e.message} ${e.issues.map((i) => `${i.path ? i.path + ': ' : ''}${i.message}`).join('; ')}`;
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}
