// blyg/media — §5.4 media entries and their immutability, plus the §8 rule 4
// retention promise for pinned versions.
//
// Two ideas from the spec meet here:
//
//   * A `media` entry is the structured reference `{ url, mime, alt? }`.
//     `url` is relative to the origin or absolute; `content_html` uses the
//     absolute form while `media[].url` stays as published (§5.4, R5.4-1,
//     R5.2-7).
//
//   * Media objects are immutable once published: a media URL MUST always
//     serve the same bytes. Changing an image means publishing a new media
//     object in a new version (R5.4-2). The ledger below is the publisher-side
//     guard that refuses to let one URL ever mean two byte streams.
//
// And the retention rule: media referenced by any pinned version MUST be
// retained forever, while pinned documents carry no `media` array (R8-4).
// `pinnedMediaUrls` computes exactly which media a publication must keep.

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Reader-acceptance test for one `media` entry (spec 5.4). Unknown members are ignored. */
export function isValidMediaEntry(entry) {
  return (
    isPlainObject(entry) &&
    typeof entry.url === "string" &&
    typeof entry.mime === "string" &&
    (entry.alt === undefined || typeof entry.alt === "string")
  );
}

/** A `media` URL is absolute when it carries a scheme. */
export function isAbsoluteUrl(url) {
  return typeof url === "string" && /^[a-z][a-z0-9+.-]*:\/\//i.test(url);
}

/**
 * Resolve a `media[].url` to the absolute URL `content_html` must carry. An
 * absolute URL is returned unchanged; a relative one resolves against the
 * item's origin (spec 5.2, 5.4).
 */
export function absoluteMediaUrl(url, origin) {
  if (typeof url !== "string" || url.length === 0) throw new Error("media url must be a non-empty string");
  if (isAbsoluteUrl(url)) return url;
  if (typeof origin !== "string" || origin.length === 0) throw new Error("resolving a relative media url requires an origin");
  return new URL(url, origin).toString();
}

/**
 * Reduce a media entry to the wire allow-list `{ url, mime, alt? }`. Anything
 * else on a candidate object — private authoring state, a local file path, a
 * draft id — is dropped rather than spread onto the wire.
 */
export function normalizeMediaEntry(entry) {
  if (!isValidMediaEntry(entry)) {
    throw new Error("media entry must be { url: string, mime: string, alt?: string }");
  }
  const out = { url: entry.url, mime: entry.mime };
  if (entry.alt !== undefined) out.alt = entry.alt;
  return out;
}

// URL fragments do not select different bytes. Normalize host/scheme/default
// ports too, so aliases cannot give one served object conflicting baselines.
function mediaKey(url, origin) {
  const resolved = new URL(absoluteMediaUrl(url, origin));
  resolved.hash = "";
  return resolved.toString();
}

/** Raised when a media URL is asked to serve different bytes than before (spec 5.4, R5.4-2). */
export class ImmutableMediaError extends Error {
  constructor(url, message) {
    super(message);
    this.name = "ImmutableMediaError";
    this.url = url;
  }
}

/**
 * A publisher-side ledger of published media. It remembers, per absolute URL,
 * the mime and content digest first published there, and refuses any later
 * registration that would change what that URL serves. It also tracks the
 * retained set — the media a publication has promised to keep (spec 8 rule 4).
 */
export class MediaLedger {
  #records = new Map(); // absolute url -> { url, mime, alt, digest }
  #retained = new Set(); // absolute urls promised forever
  #origin;
  #hashBytes;

  /** @param {{origin?: string, hashBytes?: (bytes: Uint8Array) => string}} [options] */
  constructor({ origin, hashBytes } = {}) {
    this.#origin = origin;
    this.#hashBytes = hashBytes;
  }

  /**
   * Register a published media object.
   * @param {{url: string, mime: string, alt?: string}} entry
   * @param {{origin?: string, digest?: string, bytes?: Uint8Array}} [evidence]
   *   `digest` (or `bytes`, which is hashed with the caller's hasher) records
   *   the byte stream this URL must serve forever. Omitting it still claims the
   *   url/mime pair.
   * @returns {{url: string, mime: string, alt?: string, digest?: string}}
   */
  register(entry, evidence = {}) {
    const normalized = normalizeMediaEntry(entry);
    const absolute = mediaKey(normalized.url, evidence.origin ?? this.#origin);
    const computed = evidence.bytes !== undefined ? this.#digest(evidence.bytes) : undefined;
    if (computed !== undefined && evidence.digest !== undefined && computed !== evidence.digest) {
      throw new Error("media digest does not match supplied bytes");
    }
    const digest = evidence.digest ?? computed;
    if (digest !== undefined && (typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest))) {
      throw new Error("media digest must be a lowercase SHA-256 hex digest");
    }
    const prior = this.#records.get(absolute);
    if (prior) {
      if (prior.mime !== normalized.mime) {
        throw new ImmutableMediaError(absolute, `media URL ${absolute} was published as ${prior.mime} and cannot be reused as ${normalized.mime}`);
      }
      if (prior.digest !== undefined && digest !== undefined && prior.digest !== digest) {
        throw new ImmutableMediaError(absolute, `media URL ${absolute} is immutable: it already serves different bytes`);
      }
      // The first supplied byte evidence establishes the immutable baseline.
      if (prior.digest === undefined && digest !== undefined) prior.digest = digest;
      // Same bytes: refresh alt if it was not recorded, never overwrite.
      if (prior.alt === undefined && normalized.alt !== undefined) prior.alt = normalized.alt;
      return { ...prior };
    }
    const record = { url: absolute, mime: normalized.mime };
    if (normalized.alt !== undefined) record.alt = normalized.alt;
    if (digest !== undefined) record.digest = digest;
    this.#records.set(absolute, record);
    return { ...record };
  }

  /** The recorded state of a URL, or undefined if never published. */
  record(url, origin) {
    const absolute = mediaKey(url, origin ?? this.#origin);
    const prior = this.#records.get(absolute);
    return prior ? { ...prior } : undefined;
  }

  /** Mark a media URL as retained forever (spec 8 rule 4). Returns the absolute URL. */
  retain(url, origin) {
    const absolute = mediaKey(url, origin ?? this.#origin);
    this.#retained.add(absolute);
    return absolute;
  }

  isRetained(url, origin) {
    return this.#retained.has(mediaKey(url, origin ?? this.#origin));
  }

  retainedUrls() {
    return [...this.#retained].sort();
  }

  /** Register every media entry on every version of an item; retain those on pinned versions. */
  absorbItem(item) {
    for (const version of item.versions ?? []) {
      for (const entry of version.media ?? []) this.register(entry, { origin: item.origin });
      if (version.pinned) {
        for (const entry of version.media ?? []) this.retain(entry.url, item.origin);
      }
    }
    return this;
  }

  get origin() {
    return this.#origin;
  }

  setOrigin(origin) {
    this.#origin = origin;
  }

  // The ledger stays dependency-free: a caller that has the bytes supplies them
  // via `digest` computed with blyg/hash, or hands over a hashing function here.
  #digest(bytes) {
    if (!(bytes instanceof Uint8Array)) throw new Error("media bytes must be a Uint8Array");
    if (typeof this.#hashBytes !== "function") throw new Error("MediaLedger needs evidence.digest or a hashBytes function");
    return this.#hashBytes(bytes);
  }
}

export function createMediaLedger({ origin, hashBytes } = {}) {
  return new MediaLedger({ origin, hashBytes });
}

/**
 * The absolute media URLs a publication MUST retain forever: those referenced
 * by any pinned version. Pinned documents omit `media`, so this reads the
 * version records the publisher still holds (spec 8 rule 4, R8-4).
 */
export function pinnedMediaUrls(item) {
  const out = new Set();
  for (const version of item.versions ?? []) {
    if (!version.pinned) continue;
    for (const entry of version.media ?? []) out.add(absoluteMediaUrl(entry.url, item.origin));
  }
  return [...out].sort();
}
