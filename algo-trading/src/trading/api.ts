function getUrl(path: string): string {
  if (path.startsWith('/market/index-ltp')) {
    return `http://localhost:5000/api/v1/chart/index-ltp${path.replace('/market/index-ltp', '')}`;
  }
  if (path === '/angel/margins') {
    return `http://localhost:5000/api/v1/chart/margins`;
  }
  // Python Angel One Wrapper routes proxied via Node.js broker routing
  if (path.startsWith('/market') || path.startsWith('/angel') || path.startsWith('/instruments')) {
    return `http://localhost:5000/api/v1/broker/angel${path}`;
  }
  // Node.js Main Backend routes (/chart, /trades, /strategies, /users, etc.)
  return `http://localhost:5000/api/v1${path}`;
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
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  if (!res.ok) throw new Error(await res.text());
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
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as T;
}
