export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    requestId: string;
    details: unknown[];
  };
}

export function errorEnvelope(
  code: string,
  message: string,
  requestId: string,
  details: unknown[] = []
): ErrorEnvelope {
  return { error: { code, message, requestId, details } };
}
