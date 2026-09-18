const INTERNAL_ORIGIN = 'https://agent360.internal';

/** Return only a same-application return path and reject malformed external destinations. */
export function resolveInternalReturnUrl(value: string | null): string {
  if (value === null || !value.startsWith('/')) {
    return '/agent';
  }

  try {
    const baseUrl = new URL(INTERNAL_ORIGIN);
    const targetUrl = new URL(value, baseUrl);

    return targetUrl.origin === baseUrl.origin
      ? `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`
      : '/agent';
  } catch {
    return '/agent';
  }
}
