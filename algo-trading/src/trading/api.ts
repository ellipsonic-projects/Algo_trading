import { API_BASE } from '../config/env';

function getUrl(path: string): string {
  if (path.startsWith('/market/index-ltp')) {
    return `${API_BASE}/api/v1/chart/index-ltp${path.replace('/market/index-ltp', '')}`;
  }
  if (path === '/angel/margins') {
    return `${API_BASE}/api/v1/chart/margins`;
  }
  // Python Angel One Wrapper routes proxied via Node.js broker routing
  if (path.startsWith('/market') || path.startsWith('/angel') || path.startsWith('/instruments')) {
    return `${API_BASE}/api/v1/broker/angel${path}`;
  }
  // Node.js Main Backend routes (/chart, /trades, /strategies, /users, etc.)
  return `${API_BASE}/api/v1${path}`;
}

// Only force-redirect to /login when the user is on an authenticated page.
// If already on /login (e.g. during MPIN/TOTP entry), throw the error
// back to the caller so the UI can display it instead of hard-reloading.
function redirect401(): never {
  if (window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
  throw new Error('Session expired. Please sign in again.');
}

async function parseError(res: Response): Promise<string> {
  try {
    const json = await res.clone().json();
    return json.message || json.error || `Request failed (${res.status})`;
  } catch {
    return (await res.text()) || `Request failed (${res.status})`;
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const url = getUrl(path);

  const token = localStorage.getItem('jwt');
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, { headers, credentials: 'include' });
  if (res.status === 401) {
    redirect401();
  }
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const url = getUrl(path);

  const token = localStorage.getItem('jwt');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'include'
  });
  if (res.status === 401) {
    redirect401();
  }
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as T;
}
