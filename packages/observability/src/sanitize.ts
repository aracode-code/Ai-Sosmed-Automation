const SENSITIVE_KEY = /(token|cookie|authorization|secret|password|apikey|api_key|credential)/i;

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;

/** Menghapus nilai sensitif dari objek sebelum masuk log (LLD §13.1, §14.1). */
export function sanitizeForLog(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[depth-limit]';
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLog(item, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    result[key] = SENSITIVE_KEY.test(key) ? REDACTED : sanitizeForLog(entry, depth + 1);
  }
  return result;
}

export const REDACTED_VALUE = REDACTED;
