import { useEffect, useState } from 'react';

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal, headers: { accept: 'application/json' } });
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as T;
}

export async function sendJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as T;
}

async function toApiError(response: Response): Promise<ApiError> {
  let code = `HTTP_${response.status}`;
  let message = response.statusText === '' ? 'permintaan gagal' : response.statusText;
  let parsed = false;
  try {
    const body = (await response.json()) as ErrorEnvelope;
    parsed = true;
    if (body.error?.code !== undefined) code = body.error.code;
    if (body.error?.message !== undefined) message = body.error.message;
  } catch {
    // respons bukan envelope JSON — biasanya proxy Vite saat Local API mati
  }
  if (!parsed && response.status >= 500) {
    message = 'Local API tidak merespons — jalankan corepack pnpm start';
  }
  return new ApiError(response.status, code, message);
}

export interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/** `path === null` berarti belum/tidak memuat apa pun. */
export function useApi<T>(path: string | null): ApiState<T> {
  const [state, setState] = useState<ApiState<T>>({ data: null, error: null, loading: path !== null });

  useEffect(() => {
    if (path === null) {
      setState({ data: null, error: null, loading: false });
      return;
    }

    const controller = new AbortController();
    setState({ data: null, error: null, loading: true });

    getJson<T>(path, controller.signal)
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message =
          error instanceof ApiError
            ? `${error.code}: ${error.message}`
            : error instanceof Error
              ? error.message
              : 'kesalahan tidak dikenal';
        setState({ data: null, error: message, loading: false });
      });

    return () => controller.abort();
  }, [path]);

  return state;
}
