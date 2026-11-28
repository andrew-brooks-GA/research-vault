export function parseJson(text: string): unknown {
  return JSON.parse(text);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function errorCode(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  try {
    const code: unknown = Reflect.get(error, 'code');
    return typeof code === 'string' ? code : undefined;
  } catch { return undefined; }
}
