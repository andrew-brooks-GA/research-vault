export function parseJson(text) {
  return JSON.parse(text);
}

export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function errorCode(error) {
  if (error === null || typeof error !== 'object') return undefined;
  try {
    const code = Reflect.get(error, 'code');
    return typeof code === 'string' ? code : undefined;
  } catch { return undefined; }
}
