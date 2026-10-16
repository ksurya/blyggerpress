// Reader-side feed parse → the normalized feed model (spec §7, §13.2).
//
// The feed is a LOSSY CHANGE SIGNAL, never ground truth: this module only turns
// feed.xml (or an Atom feed) into the windowed notification model the reconciler
// uses as a cheap trigger. It never mutates reader state, and unknown `blyg:*`
// elements and reserved constructs are ignored rather than rejected (§13.1 rule 4).
//
// Degradation is explicit and per §13.2:
//   - a wholly unparseable feed throws `FeedParseError` → the caller falls back
//     to an archive-index diff;
//   - an unparseable <item>/<entry> is skipped individually, and the containing
//     feed is never rejected.
//
// The normalized shape matches `contracts/schemas/feed-model.schema.json`.

const XML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " };

export class FeedParseError extends Error {
  constructor(message) {
    super(message);
    this.name = "FeedParseError";
  }
}

function firstTag(block, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i");
  const m = block.match(re);
  return m ? m[1] : undefined;
}

function tagText(block, name) {
  const raw = firstTag(block, name);
  return raw === undefined ? undefined : decodeXml(stripCdata(raw)).trim();
}

function stripCdata(s) {
  const t = String(s).trim();
  if (t.startsWith("<![CDATA[") && t.endsWith("]]>")) return t.slice(9, -3);
  return t;
}

function decodeXml(s) {
  return String(s).replace(/&(#?[a-z0-9]+);/gi, (whole, e) => {
    const key = e.toLowerCase();
    if (key.startsWith("#x")) return String.fromCodePoint(parseInt(key.slice(2), 16));
    if (key.startsWith("#")) return String.fromCodePoint(parseInt(key.slice(1), 10));
    return XML_ENTITIES[key] ?? whole;
  });
}

function toInt(v) {
  if (v === undefined) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isInteger(n) ? n : undefined;
}

function absolutize(url, baseUrl) {
  if (!url) return url;
  if (!baseUrl) return url;
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return url;
  }
}

function parseRssEntry(block, baseUrl) {
  const guid = tagText(block, "guid");
  const link = tagText(block, "link");
  const title = tagText(block, "title");
  if (guid === undefined && link === undefined && title === undefined) return null;

  const entry = { guid: guid ?? "", link: absoluteLink(link, baseUrl), title: title ?? "" };

  const desc = firstTag(block, "description");
  if (desc !== undefined) entry.descriptionHtml = stripCdata(desc);

  const id = tagText(block, "blyg:id");
  const kind = tagText(block, "blyg:kind");
  const version = toInt(tagText(block, "blyg:version"));
  const created = tagText(block, "blyg:created");
  const itemUrl = tagText(block, "blyg:item");
  const creator = tagText(block, "dc:creator");
  const pubDate = tagText(block, "pubDate");

  if (id) entry.id = id;
  if (kind) entry.kind = kind;
  if (version !== undefined) entry.version = version;
  if (created) entry.created = created;
  if (pubDate) entry.pubDate = pubDate;
  if (creator) entry.creator = creator;
  if (itemUrl) entry.itemUrl = absolutize(itemUrl, baseUrl);

  // Derive identity from the per-version GUID when the blyg:* elements are absent.
  if ((!entry.id || entry.version === undefined) && typeof entry.guid === "string") {
    const m = /^blyg:([0-9abcdefghjkmnpqrstvwxyz]{26}):v(\d+)$/.exec(entry.guid);
    if (m) {
      if (!entry.id) entry.id = m[1];
      if (entry.version === undefined) entry.version = Number(m[2]);
    }
  }
  if (!entry.itemUrl && entry.id) entry.itemUrl = absolutize(`items/${entry.id}.json`, baseUrl);
  return entry;
}

function absoluteLink(link, baseUrl) {
  if (!link) return link ?? "";
  return absolutize(link, baseUrl);
}

function parseAtomEntry(block, baseUrl) {
  const id = tagText(block, "id");
  const title = tagText(block, "title") ?? "";
  const linkM = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i);
  const link = absoluteLink(linkM ? linkM[1] : linkM, baseUrl);
  const summary = firstTag(block, "summary") ?? firstTag(block, "content");
  if (id === undefined && !link && !title) return null;
  const entry = { guid: id ?? link ?? title, link: link ?? "", title };
  if (summary !== undefined) entry.descriptionHtml = stripCdata(summary);
  const updated = tagText(block, "updated") ?? tagText(block, "published");
  if (updated) entry.pubDate = updated;
  return entry;
}

/**
 * Parse RSS 2.0 (with the optional blyg: namespace) or Atom into the normalized
 * feed model. Throws `FeedParseError` only when the document is not a feed at
 * all; individual malformed entries are dropped.
 */
export function parseFeed(xml, { baseUrl } = {}) {
  if (typeof xml !== "string" || !xml.trim()) throw new FeedParseError("feed is not text");

  const channel = firstTag(xml, "channel");
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const model = { channel: {}, entries: [], legacy: false };

  if (channel !== undefined) {
    model.channel = {
      title: tagText(channel, "title") ?? "",
      link: tagText(channel, "link") ?? "",
      description: tagText(channel, "description"),
      lastBuildDate: tagText(channel, "lastBuildDate"),
      level: toInt(tagText(channel, "blyg:level")),
      manifest: tagText(channel, "blyg:manifest"),
    };
    let sawBlyg = false;
    const itemRe = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;
    let m;
    while ((m = itemRe.exec(channel))) {
      try {
        const e = parseRssEntry(m[1], baseUrl);
        if (!e) continue;
        if (e.id || e.version !== undefined) sawBlyg = true;
        model.entries.push(e);
      } catch {
        // An unparseable entry is skipped individually; the feed is never rejected.
      }
    }
    model.legacy = !sawBlyg && !model.channel.manifest;
    return model;
  }

  if (isAtom) {
    model.channel = {
      title: tagText(xml, "title") ?? "",
      link: absolutize(tagText(xml, "id"), baseUrl) ?? "",
    };
    const entryRe = /<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi;
    let m;
    while ((m = entryRe.exec(xml))) {
      try {
        const e = parseAtomEntry(m[1], baseUrl);
        if (e) model.entries.push(e);
      } catch {
        // skip individually
      }
    }
    model.legacy = true; // no blyg namespace ⇒ L0
    return model;
  }

  throw new FeedParseError("not an RSS or Atom feed");
}
