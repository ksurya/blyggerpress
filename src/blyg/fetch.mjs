// Bounded transport shared by discovery and reader reconciliation. Browser manual
// redirects can be opaque: fail visibly and offer file import / an explicit proxy.
export class FetchError extends Error {
  constructor(code, message = code) { super(message); this.name = 'FetchError'; this.code = code; }
}

export function publicUrl(value) {
  const u = new URL(value);
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) throw new FetchError('unsafe-url');
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  // IPv6 literals are deliberately refused, including mapped private IPv4.
  if (h.includes(':') || h === 'localhost' || h.endsWith('.localhost') || !h.includes('.') || h.endsWith('.local')) throw new FetchError('private-address');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a,b] = h.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19))) throw new FetchError('private-address');
  }
  u.hash = '';
  return u.href;
}

export function createSafeFetch({ fetchImpl = globalThis.fetch, timeoutMs = 15000, maxBytes = 1024 * 1024, maxRedirects = 5, userAgent = 'BlyggerPress/0.3', validateDestination } = {}) {
  return async function fetchText(input, { etag, lastModified, signal, budget } = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    let timer;
    const work = async () => {
      let url = publicUrl(input);
      for (let hop = 0; ; hop++) {
        // A server/proxy MUST supply an egress-enforcing validator/transport;
        // literal checks alone do not prevent DNS rebinding.
        if (validateDestination) await validateDestination(url);
        if (budget && budget.remaining-- <= 0) throw new FetchError('fetch-budget');
        const headers = { Accept: 'application/json, application/xml, text/xml, text/html', 'User-Agent': userAgent };
        if (etag) headers['If-None-Match'] = etag;
        if (lastModified) headers['If-Modified-Since'] = lastModified;
        const res = await fetchImpl(url, { headers, redirect: 'manual', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal });
        if (res.type === 'opaqueredirect' || res.type === 'opaque') throw new FetchError('cors-or-redirect', 'Browser access blocked; import the feed file or configure an optional fetch proxy.');
        if ([301,302,303,307,308].includes(res.status)) {
          await res.body?.cancel();
          if (hop >= maxRedirects) throw new FetchError('redirect-limit');
          const location = res.headers.get('location');
          if (!location) throw new FetchError('missing-location');
          url = publicUrl(new URL(location, url));
          continue;
        }
        if (res.redirected) throw new FetchError('unbounded-transport');
        if (Number(res.headers.get('content-length')) > maxBytes) { await res.body?.cancel(); throw new FetchError('body-limit'); }
        let body = '';
        if (res.status !== 304 && res.body) {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let size = 0;
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              size += value.byteLength;
              if (size > maxBytes) throw new FetchError('body-limit');
              body += decoder.decode(value, { stream: true });
            }
            body += decoder.decode();
          } catch (error) { await reader.cancel().catch(() => {}); throw error; }
        }
        return { status: res.status, body, finalUrl: url, etag: res.headers.get('etag') ?? undefined, lastModified: res.headers.get('last-modified') ?? undefined, retryAfter: res.headers.get('retry-after') ?? undefined };
      }
    };
    try {
      return await Promise.race([work(), new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new FetchError('timeout')); }, timeoutMs);
        controller.signal.addEventListener('abort', () => reject(new FetchError('aborted')), { once: true });
        if (controller.signal.aborted) reject(new FetchError('aborted'));
      })]);
    } catch (error) {
      if (error instanceof TypeError) throw new FetchError('network-or-cors', 'Fetch failed; import the feed file or configure an optional fetch proxy.');
      throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  };
}
