import type { CredentialStore } from '@saa/youtube';
import { AppError } from '@saa/domain';
import { loadAiCredentials } from './config';

export const DEEPSEEK_CREDENTIAL_NAME = 'deepseek-api-key';

export interface AiCredential {
  apiKey: string;
  source: 'store' | 'env';
}

export interface AiCredentialStatus {
  configured: boolean;
  source: 'store' | 'env' | 'none';
  storeError: boolean;
}

export interface AiCredentialManager {
  /**
   * Muat ulang kunci dari DPAPI lalu environment. Aman dipanggil berulang;
   * kegagalan membaca berkas dicatat sebagai `storeError`, bukan menjatuhkan API.
   */
  refresh(): Promise<void>;
  resolve(): Promise<AiCredential | null>;
  save(apiKey: string): Promise<void>;
  status(): AiCredentialStatus;
  isConfigured(): boolean;
}

export interface AiCredentialManagerOptions {
  store: CredentialStore;
  env?: NodeJS.ProcessEnv;
}

function storedKeyOf(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const value = (payload as { apiKey?: unknown }).apiKey;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Kunci DeepSeek: DPAPI (diisi lewat UI) menang atas environment agar nilai yang
 * baru diketik owner langsung dipakai tanpa restart. Nilai kunci tidak pernah
 * keluar dari manager ini melalui `status()`.
 */
export function createAiCredentialManager(
  options: AiCredentialManagerOptions
): AiCredentialManager {
  const env = options.env ?? process.env;
  let cached: AiCredential | null = null;
  let primed = false;
  let storeError = false;

  const refresh = async (): Promise<void> => {
    storeError = false;
    let stored: AiCredential | null = null;
    try {
      const key = storedKeyOf(await options.store.load(DEEPSEEK_CREDENTIAL_NAME));
      if (key !== null) stored = { apiKey: key, source: 'store' };
    } catch {
      storeError = true;
    }

    const envCredentials = loadAiCredentials(env);
    cached =
      stored ??
      (envCredentials === null ? null : { apiKey: envCredentials.apiKey, source: 'env' });
    primed = true;
  };

  return {
    refresh,
    async resolve() {
      if (!primed) await refresh();
      return cached;
    },
    async save(apiKey) {
      const key = apiKey.trim();
      if (key === '') throw new AppError('VALIDATION', 'kunci DeepSeek tidak boleh kosong');
      await options.store.save(DEEPSEEK_CREDENTIAL_NAME, { apiKey: key });
      cached = { apiKey: key, source: 'store' };
      primed = true;
      storeError = false;
    },
    status() {
      return {
        configured: cached !== null,
        source: cached?.source ?? 'none',
        storeError
      };
    },
    isConfigured() {
      return cached !== null;
    }
  };
}
