export function settingsReturnUrl(currentUrl, referrer = '') {
  const current = new URL(currentUrl);
  const fallback = new URL('/api/v1/plugins/settings.reaplugin/ui', current).href;
  const loopback = hostname => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  for (const candidate of [current.searchParams.get('returnTo'), referrer]) {
    if (!candidate) continue;
    try {
      const target = new URL(candidate, current);
      const sameHost = target.hostname === current.hostname || (loopback(target.hostname) && loopback(current.hostname));
      if (sameHost && ['http:', 'https:'].includes(target.protocol) && !target.username && !target.password &&
          !(target.origin === current.origin && target.pathname === current.pathname)) return target.href;
    } catch {}
  }
  return fallback;
}
