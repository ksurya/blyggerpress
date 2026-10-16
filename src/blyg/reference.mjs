// §5.9 identity and advisory citation metadata are separate claims.
export { isReference, isAbsoluteReference, isCited, isSelector, isStubOf, copyReference, copyStubOf } from './item.mjs';
export { referencesEqual, isStale } from './primitives.mjs';
import { originKey } from './primitives.mjs';

/** Compare only a direct fetched target at its authenticated identity origin. */
export function referenceStatus(reference, { doc, origin }, ownOrigin) {
  const targetOrigin = originKey(reference.origin ?? ownOrigin);
  if (!doc || doc.id !== reference.id || originKey(origin) !== targetOrigin) return 'unavailable';
  if (doc.kind === 'withdrawn') return 'withdrawn';
  if (doc.version > reference.version) return 'stale';
  return doc.version === reference.version ? 'current' : 'regressed';
}
