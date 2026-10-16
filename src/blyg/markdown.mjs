import { parseFragment, serialize } from 'parse5';

const urlAttrs = new Set(['href', 'src', 'poster', 'cite', 'action', 'formaction', 'background', 'data', 'longdesc']);
/** HTML travels independently of its page; relative URLs use the snapshot origin. */
export function absoluteHtmlUrls(html, origin) {
  const root = parseFragment(html);
  let changed = false;
  function absolute(value) {
    try {
      const resolved = new URL(value, origin).href;
      if (resolved !== value) changed = true;
      return resolved;
    } catch { throw new Error(`invalid content URL: ${value}`); }
  }
  function walk(node) {
    for (const attr of node.attrs ?? []) {
      if (urlAttrs.has(attr.name)) attr.value = absolute(attr.value);
      if (attr.name === 'srcset') {
        // Data URLs contain commas, and are already absolute.
        if (!attr.value.trim().startsWith('data:')) attr.value = attr.value.split(',').map(candidate => {
          const [url, ...descriptor] = candidate.trim().split(/\s+/);
          return [absolute(url), ...descriptor].join(' ');
        }).join(', ');
      }
    }
    for (const child of node.childNodes ?? []) walk(child);
    if (node.content) walk(node.content);
  }
  walk(root);
  return changed ? serialize(root) : html;
}
