// blyg/lifecycle — the item publication lifecycle: drafts, publish events,
// pins, withdrawal, and return.
//
// This is the writer's half of §5.2 and §9, kept separate from the document
// shapes (blyg/item) and the projection (blyg/publication) so that the rules
// read in one place:
//
//   * A publish event is the only thing that advances `version`, and it
//     advances it by exactly one (§5.2, R5.2-1). A draft save is invisible to
//     the protocol: it creates no version, no changelog entry, no publish
//     event, and never reaches a projected document (R5.2-1, §4 R4-5).
//
//   * Only the latest version's content is served; older content is withheld
//     unless pinned. The changelog is metadata, never a diff, and a note must
//     not reproduce withheld content (§5.2, R5.2-3, R5.2-4).
//
//   * Identity is permanent: the id, the lineage (`forked_from`), the page and
//     the author are fixed at first publish and cannot be added, retargeted,
//     cleared or otherwise changed afterwards (§5.1, §5.6, §5.8, §5.5;
//     R5.1-2, R5.6-2).
//
//   * Pinning is a separate, irrevocable act that exposes one version without
//     touching the counter; a withdrawal endcap can never be pinned (§8).
//
//   * Withdrawal publishes an endcap that empties what the item said while
//     keeping where it lives and where it came from, and a later publish event
//     under the same id is the item returning (§9, R9-1).
//
// The engine is deterministic given an injected clock and id factory, holds no
// I/O, and validates its own output with the publisher-strictness rules before
// releasing it.

import { isValidId, newId } from "./ids.mjs";
import { contentHash } from "./hash.mjs";
import { normalizeMediaEntry, isValidMediaEntry } from "./media.mjs";
import {
  AUTHORED_KINDS,
  isAbsoluteReference,
  isGeneratedSpan,
  isReference,
  isStubOf,
  isIso8601Utc,
  buildItemDocument,
  buildPinnedDocument,
  findVersion,
  latestVersion,
  isWithdrawn,
  validatePublisherItem,
} from "./item.mjs";

/** Raised when a draft save tries to change something fixed at first publish. */
export class ImmutableFieldError extends Error {
  constructor(field, message) {
    super(message ?? `${field} is fixed at first publish and cannot be changed`);
    this.name = "ImmutableFieldError";
    this.field = field;
  }
}

/** Raised when a changelog note would reproduce withheld (unpinned) prior content (§5.2, R5.2-4). */
export class NoteDepthError extends Error {
  constructor(version, message) {
    super(message ?? `the note for v${version} reproduces withheld content from an unpinned earlier version`);
    this.name = "NoteDepthError";
    this.version = version;
  }
}

/** Raised when an operation is not allowed for the item's or draft's state. */
export class LifecycleError extends Error {
  constructor(message) {
    super(message);
    this.name = "LifecycleError";
  }
}

const normalizeText = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/**
 * The §5.2 depth rule: a note describes a change and never reproduces withheld
 * content. Between pinned versions nothing is withheld and any note is fine;
 * where the prior version is unpinned, a note must not carry a run of its text.
 *
 * @param {Array<{version:number,pinned?:boolean,content_md?:string}>} priorVersions
 * @param {string|null} note
 * @param {{minRun?:number}} [options] shortest contiguous quote treated as a diff
 */
export function assertNoteDepth(priorVersions, note, { minRun = 40 } = {}) {
  if (note === null || note === undefined) return;
  const n = normalizeText(note);
  if (!n) return;
  for (const v of priorVersions) {
    if (v.pinned) continue; // fully public: nothing is withheld between pins
    const c = normalizeText(v.content_md);
    if (!c) continue;
    if (c === n) throw new NoteDepthError(v.version, `the note for v${v.version + 1} restates v${v.version}'s withheld content verbatim`);
    if (c.length < minRun) continue;
    for (let i = 0; i + minRun <= c.length; i++) {
      if (n.includes(c.slice(i, i + minRun))) {
        throw new NoteDepthError(v.version, `the note reproduces withheld content from unpinned v${v.version} (a note is not a diff)`);
      }
    }
  }
}

function deepCopy(value) {
  if (value === null || typeof value !== "object") return value;
  return structuredClone(value);
}

const PAGE_PREFIX = { fragment: "f", thread: "t" };

function defaultPageFor(kind, id) {
  const prefix = PAGE_PREFIX[kind] ?? "i";
  return `${prefix}/${id}/`;
}

// Allow-list copy of a reference: id/version required, origin/cited/selector optional.
function copyReference(ref) {
  const out = { id: ref.id, version: ref.version };
  if (ref.origin !== undefined) out.origin = ref.origin;
  if (ref.cited !== undefined) out.cited = deepCopy(ref.cited);
  if (ref.selector !== undefined) out.selector = deepCopy(ref.selector);
  return out;
}

function copyGenerated(span) {
  const out = { sources: span.sources.map((s) => ({ id: s.id, version: s.version })) };
  if (span.model !== undefined) out.model = span.model;
  if (span.at !== undefined) out.at = span.at;
  return out;
}

/**
 * Create an item-lifecycle engine.
 *
 * @param {object} [options]
 * @param {string} options.origin REQUIRED for any publish: the publication origin.
 * @param {object} [options.author] the item author object, if any (opaque, per-item).
 * @param {() => string} [options.clock] ISO 8601 UTC instant source (injectable).
 * @param {() => string} [options.idFactory] id source (injectable; default CSPRNG newId).
 * @param {(kind:string,id:string)=>string} [options.pageFor] page-path policy.
 */
export function createLifecycle(options = {}) {
  const {
    origin,
    author = undefined,
    clock = () => new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    idFactory = newId,
    pageFor = defaultPageFor,
  } = options;

  const items = new Map(); // id -> item state
  const drafts = new Map(); // localId -> draft
  let draftCounter = 0;

  const requireItem = (itemId) => {
    const item = items.get(itemId);
    if (!item) throw new LifecycleError(`unknown item ${itemId}`);
    return item;
  };

  const requireDraft = (localId) => {
    const draft = drafts.get(localId);
    if (!draft) throw new LifecycleError(`unknown draft ${localId}`);
    return draft;
  };

  function validateContent({ kind, contentMd, contentHtml, transclusions, generated, stubOf, media }) {
    if (!AUTHORED_KINDS.includes(kind)) throw new LifecycleError(`kind must be one of ${AUTHORED_KINDS.join(", ")}`);
    if (typeof contentMd !== "string") throw new LifecycleError("contentMd must be a string");
    if (typeof contentHtml !== "string") throw new LifecycleError("contentHtml must be a string");
    const list = media ?? [];
    if (!Array.isArray(list) || !list.every(isValidMediaEntry)) throw new LifecycleError("media must be an array of { url, mime, alt? } entries");
    if (kind === "fragment") {
      if (transclusions !== undefined && transclusions.length) throw new LifecycleError("a fragment does not carry transclusions");
      if (stubOf !== undefined) throw new LifecycleError("only a thread may carry stub_of");
    } else {
      if (!Array.isArray(transclusions)) throw new LifecycleError("a thread always carries transclusions (spec 10.3)");
      for (const ref of transclusions) {
        if (!isReference(ref)) throw new LifecycleError("each transclusion must be a reference");
        if (ref.selector !== undefined && (typeof ref.selector !== "object" || ref.selector === null || typeof ref.selector.exact !== "string")) {
          throw new LifecycleError("a partial transclusion needs a selector with an exact string");
        }
      }
      if (stubOf !== undefined && !isStubOf(stubOf)) throw new LifecycleError("stub_of must be a blyg reference (origin required) or a plain-web {url}");
    }
    if (generated !== undefined) {
      if (!Array.isArray(generated) || !generated.every(isGeneratedSpan)) throw new LifecycleError("generated must be an array of generated spans");
    }
  }

  /**
   * Open a draft. A draft is private: it has a local id, never an item id until
   * its first publish event, and is never projected.
   */
  function newDraft(init = {}) {
    const kind = init.kind ?? "fragment";
    validateContent({
      kind,
      contentMd: init.contentMd ?? "",
      contentHtml: init.contentHtml ?? "",
      media: init.media ?? [],
      transclusions: init.transclusions,
      generated: init.generated,
      stubOf: init.stubOf,
    });

    if (init.itemId !== undefined && init.itemId !== null) {
      const item = requireItem(init.itemId);
      if (item.kind !== kind) throw new LifecycleError(`draft kind ${kind} does not match item ${init.itemId}'s kind ${item.kind}`);
      for (const field of ["forkedFrom", "page", "author"]) {
        if (init[field] !== undefined) throw new ImmutableFieldError(field, `${field} cannot be set while editing an existing item`);
      }
    } else if (init.forkedFrom !== undefined && !isAbsoluteReference(init.forkedFrom)) {
      throw new LifecycleError("forked_from must be a reference with an origin (spec 5.6)");
    }

    const localId = init.localId ?? `draft-${++draftCounter}`;
    if (drafts.has(localId)) throw new LifecycleError(`draft ${localId} already exists`);
    const now = init.createdAt ?? clock();
    const draft = {
      localId,
      itemId: init.itemId ?? null,
      kind,
      contentMd: init.contentMd ?? "",
      contentHtml: init.contentHtml ?? "",
      media: (init.media ?? []).map(normalizeMediaEntry),
      transclusions: kind === "thread" ? (init.transclusions ?? []).map(copyReference) : undefined,
      generated: init.generated?.map(copyGenerated),
      stubOf: init.stubOf !== undefined ? deepCopy(init.stubOf) : undefined,
      note: init.note ?? null,
      noteGenerated: init.noteGenerated ?? false,
      createdAt: now,
      updatedAt: now,
      baseVersion: init.itemId ? latestVersion(requireItem(init.itemId)).version : 0,
      forkedFrom: init.forkedFrom !== undefined ? deepCopy(init.forkedFrom) : undefined,
      page: init.page,
      author: init.author !== undefined ? deepCopy(init.author) : undefined,
    };
    drafts.set(localId, draft);
    return deepCopy(draft);
  }

  const EDITABLE = new Set(["contentMd", "contentHtml", "media", "transclusions", "generated", "stubOf", "note", "noteGenerated"]);
  const FORBIDDEN = new Set(["itemId", "kind", "forkedFrom", "page", "author", "localId", "baseVersion", "createdAt"]);

  /**
   * Save a draft. This is invisible to the protocol: it neither creates a
   * version nor records a publish event (spec 5.2, R5.2-1).
   */
  function saveDraft(localId, patch = {}) {
    const draft = requireDraft(localId);
    for (const key of Object.keys(patch)) {
      if (FORBIDDEN.has(key)) throw new ImmutableFieldError(key, `${key} cannot be changed after the draft is opened`);
      if (!EDITABLE.has(key)) throw new LifecycleError(`unknown draft field '${key}'`);
    }
    const next = deepCopy({ ...draft, ...patch });
    validateContent({
      kind: next.kind,
      contentMd: next.contentMd,
      contentHtml: next.contentHtml,
      media: next.media,
      transclusions: next.kind === "thread" ? next.transclusions ?? [] : next.transclusions,
      generated: next.generated,
      stubOf: next.stubOf,
    });
    next.media = (next.media ?? []).map(normalizeMediaEntry);
    if (next.kind === "thread") next.transclusions = (next.transclusions ?? []).map(copyReference);
    if (next.generated !== undefined) next.generated = next.generated.map(copyGenerated);
    next.updatedAt = patch.updatedAt ?? clock();
    if (patch.transclusions !== undefined && next.kind === "fragment") next.transclusions = undefined;
    drafts.set(localId, next);
    return deepCopy(next);
  }

  function getDraft(localId) {
    return deepCopy(requireDraft(localId));
  }

  function discardDraft(localId) {
    if (!drafts.has(localId)) throw new LifecycleError(`unknown draft ${localId}`);
    drafts.delete(localId);
  }

  /** All drafts, including never-published ones. Private to the studio; never projected. */
  function listDrafts() {
    return [...drafts.values()].map(deepCopy);
  }

  /**
   * Publish a draft: the one act that advances the version counter. If the
   * draft is new, the item is created with a fresh id here; if it edits an
   * existing (possibly withdrawn) item, this is a new version or the return.
   *
   * @returns {{itemId:string, version:number, at:string, kind:string}}
   */
  function publish(localId, overrides = {}) {
    const draft = requireDraft(localId);
    if (origin === undefined) throw new LifecycleError("a lifecycle needs an origin to publish");
    const at = overrides.at ?? clock();
    if (!isIso8601Utc(at)) throw new LifecycleError("publish time must be an ISO 8601 UTC instant");

    let item;
    if (draft.itemId === null) {
      const id = overrides.id ?? idFactory();
      if (!isValidId(id)) throw new LifecycleError(`id factory produced an invalid id: ${id}`);
      if (items.has(id)) throw new LifecycleError(`item id already exists: ${id}`);
      item = {
        id,
        origin,
        page: draft.page ?? pageFor(draft.kind, id),
        author: draft.author !== undefined ? deepCopy(draft.author) : author !== undefined ? deepCopy(author) : undefined,
        createdAt: at,
        kind: draft.kind,
        forkedFrom: draft.forkedFrom !== undefined ? deepCopy(draft.forkedFrom) : undefined,
        versions: [],
      };
    } else {
      item = deepCopy(requireItem(draft.itemId));
      if (draft.kind !== item.kind) throw new LifecycleError("a publish event keeps the item's authored kind (withdrawal is the only kind change)");
    }

    const previous = latestVersion(item);
    const version = previous ? previous.version + 1 : 1;
    const note = overrides.note !== undefined ? overrides.note : draft.note;
    const noteGenerated = overrides.noteGenerated !== undefined ? overrides.noteGenerated : draft.noteGenerated;

    assertNoteDepth(item.versions, note);

    const record = {
      version,
      at,
      note: note ?? null,
      noteGenerated: Boolean(noteGenerated),
      kind: item.kind,
      content_md: draft.contentMd,
      content_html: draft.contentHtml,
      content_hash: contentHash(draft.contentMd),
      media: draft.media.map((m) => ({ ...m })),
    };
    if (item.kind === "thread") record.transclusions = (draft.transclusions ?? []).map(copyReference);
    if (draft.generated !== undefined) record.generated = draft.generated.map(copyGenerated);
    if (item.kind === "thread" && draft.stubOf !== undefined) record.stub_of = deepCopy(draft.stubOf);
    if (item.forkedFrom !== undefined) record.forkedFrom = deepCopy(item.forkedFrom);

    item.versions.push(record);
    selfCheck(item);
    items.set(item.id, item);
    draft.itemId = item.id;
    draft.baseVersion = version;
    draft.updatedAt = at;
    return { itemId: item.id, version, at, kind: record.kind };
  }

  /**
   * Pin one published version: an irrevocable promise that its exact bytes stay
   * fetchable. Pinning adds no version, no changelog entry and no publish
   * event, and a withdrawal endcap can never be pinned (spec 8, R8-2).
   */
  function pin(itemId, version) {
    const item = requireItem(itemId);
    const record = findVersion(item, version);
    if (!record) throw new LifecycleError(`item ${itemId} has no version ${version}`);
    if (record.kind === "withdrawn") throw new LifecycleError(`v${version} of ${itemId} is a withdrawal endcap and cannot be pinned (spec 8 rule 2)`);
    record.pinned = true;
    return deepCopy(record);
  }

  /**
   * Withdraw: publish an endcap that empties content and media, keeps the
   * changelog plus the endcap entry, keeps `page` and `forked_from`, empties a
   * thread's transclusions, omits `stub_of` and carries no `generated`
   * (spec 9, R9-1).
   */
  function withdraw(itemId, { at, note = null } = {}) {
    const item = deepCopy(requireItem(itemId));
    if (isWithdrawn(item)) throw new LifecycleError(`item ${itemId} is already withdrawn`);
    const instant = at ?? clock();
    if (!isIso8601Utc(instant)) throw new LifecycleError("withdrawal time must be an ISO 8601 UTC instant");
    assertNoteDepth(item.versions, note);
    const version = latestVersion(item).version + 1;
    const record = {
      version,
      at: instant,
      note: note ?? null,
      noteGenerated: false,
      kind: "withdrawn",
      content_md: "",
      content_html: "",
      content_hash: contentHash(""),
      media: [],
    };
    if (item.kind === "thread") record.transclusions = [];
    if (item.forkedFrom !== undefined) record.forkedFrom = deepCopy(item.forkedFrom);
    item.versions.push(record);
    selfCheck(item);
    items.set(item.id, item);
    return { itemId: item.id, version, at: instant, kind: "withdrawn" };
  }

  function selfCheck(item) {
    const result = validatePublisherItem(buildItemDocument(item));
    if (!result.valid) {
      throw new LifecycleError(`internal invariant violated for ${item.id}: ${result.errors.map((e) => `${e.path} ${e.message}`).join("; ")}`);
    }
  }

  function snapshot(itemId) {
    return deepCopy(requireItem(itemId));
  }

  function itemDocument(itemId) {
    return deepCopy(buildItemDocument(requireItem(itemId)));
  }

  function pinnedDocument(itemId, version) {
    return deepCopy(buildPinnedDocument(requireItem(itemId), version));
  }

  function versions(itemId) {
    return requireItem(itemId).versions.map(deepCopy);
  }

  function listItems() {
    return [...items.values()].map(deepCopy);
  }

  return {
    newDraft,
    saveDraft,
    getDraft,
    discardDraft,
    listDrafts,
    publish,
    pin,
    withdraw,
    snapshot,
    itemDocument,
    pinnedDocument,
    versions,
    listItems,
    isWithdrawn: (itemId) => isWithdrawn(requireItem(itemId)),
    hasItem: (itemId) => items.has(itemId),
  };
}
