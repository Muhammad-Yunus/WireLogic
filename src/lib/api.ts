import { io, type Socket } from 'socket.io-client';

let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

export async function apiFetch<T = unknown>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (authToken) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }

  const resp = await fetch(url, {
    ...options,
    headers,
  });

  if (resp.status === 204) {
    return undefined as T;
  }

  const text = await resp.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { error: text || `HTTP ${resp.status}` };
  }

  if (!resp.ok) {
    throw new Error(
      (typeof json.error === 'string' && json.error) || `Request failed with status ${resp.status}`
    );
  }

  return json as T;
}

export function createRealtimeSocket(token: string): Socket {
  return io({
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
  });
}
