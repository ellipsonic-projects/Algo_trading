const API_BASE = import.meta.env.VITE_ANGEL_ONE_API_BASE ?? 'http://localhost:8000'

export async function apiGet<T>(path: string): Promise<T> {
    const url = path.startsWith('/trades') || path.startsWith('/strategies') || path.startsWith('/stats') || path.startsWith('/count')
        ? `http://localhost:5000/api/v1${path}` // Main Backend
        : `${API_BASE}${path}`; // Angel One Wrapper

    const res = await fetch(url, { credentials: 'include' })
    if (res.status === 401) {
        window.location.href = '/login'
        throw new Error('Unauthorized')
    }
    if (!res.ok) throw new Error(await res.text())
    return (await res.json()) as T
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
    const url = path.startsWith('/trades') || path.startsWith('/strategies')
        ? `http://localhost:5000/api/v1${path}`
        : `${API_BASE}${path}`;

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'include'
    })
    if (res.status === 401) {
        window.location.href = '/login'
        throw new Error('Unauthorized')
    }
    if (!res.ok) throw new Error(await res.text())
    return (await res.json()) as T
}
