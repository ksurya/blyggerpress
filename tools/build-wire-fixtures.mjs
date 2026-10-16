// Builds the sample wire fixtures: an internally consistent blyg tree, a
// remote blyg tree (for cross-origin constructs), a reader-side private store,
// and the derived publication artifacts. Run: node tools/build-wire-fixtures.mjs
// Outputs are committed; re-run after changing the sample definition.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { contentHash, rfc822, textContent } from "./lib/oracle.mjs";

const ROOT = join(import.meta.dirname, "..");
const WIRE = join(ROOT, "fixtures", "wire");
const STORE = join(ROOT, "fixtures", "store");

const ORIGIN = "https://example.com/blyg/";
const REMOTE = "https://blyg.protocol-institute.org/";

const ID = {
  A: "1jt332depwffcsyfz9txf8c9r9",
  B: "6y1e4khfxxckyd9dhwgrtv2dj4",
  T: "3ev1cjtw7c6q5y8cd0r7aj3bhc",
  S: "7jbfafqm50v2w8xd9hkxz3yesh",
  W: "3wh683yzk9m9byd7tr17fpaxfs",
  F: "0ff73f8ranqzaf0b2n3qpxxzd7",
  R1: "7gvp7ms7wq4nks6erdbbdp8cqc",
  R2: "5gb4pd4d8bme2zzkq7t46zkkhx",
};

const AUTHOR = { name: "Venkatesh Rao", url: ORIGIN };
const REMOTE_AUTHOR = { name: "Editor", url: REMOTE };

const files = {};
function add(rel, body) {
  files[rel] = body;
}
function j(rel, obj) {
  add(rel, JSON.stringify(obj, null, 2) + "\n");
}
function writeAll() {
  for (const [rel, body] of Object.entries(files)) {
    const full = join(WIRE, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
}

// ---------------------------------------------------------------- remote blyg
const r1ContentMd = "Remote fragment content.";
const r1 = {
  blyg: "0.3",
  id: ID.R1,
  kind: "fragment",
  origin: REMOTE,
  page: `f/${ID.R1}/`,
  author: REMOTE_AUTHOR,
  created: "2026-07-16T20:10:00Z",
  updated: "2026-07-16T20:10:00Z",
  version: 1,
  content_md: r1ContentMd,
  content_html: "<p>Remote fragment content.</p>",
  content_hash: contentHash(r1ContentMd),
  changelog: [{ version: 1, at: "2026-07-16T20:10:00Z", note: null }],
};
const r1pinned = {
  blyg: "0.3",
  id: ID.R1,
  kind: "fragment",
  version: 1,
  at: "2026-07-16T20:10:00Z",
  note: null,
  pinned: true,
  origin: REMOTE,
  page: `f/${ID.R1}/`,
  author: REMOTE_AUTHOR,
  content_md: r1ContentMd,
  content_html: "<p>Remote fragment content.</p>",
  content_hash: contentHash(r1ContentMd),
};

const r2Prose =
  "Stigmergy is what a protocol looks like from inside, and the reason it looks like nothing at all is the point.";
const r2ContentMd = `![[${ID.R1}]]\n\n${r2Prose}`;
const r2 = {
  blyg: "0.3",
  id: ID.R2,
  kind: "thread",
  origin: REMOTE,
  page: `t/${ID.R2}/`,
  author: REMOTE_AUTHOR,
  created: "2026-07-16T21:00:00Z",
  updated: "2026-07-16T21:00:00Z",
  version: 1,
  content_md: r2ContentMd,
  content_html:
    `<blockquote class="blyg-transclusion" data-blyg-id="${ID.R1}" data-blyg-version="1">` +
    `<p>Remote fragment content.</p></blockquote>\n<p>${r2Prose}</p>`,
  content_hash: contentHash(r2ContentMd),
  changelog: [{ version: 1, at: "2026-07-16T21:00:00Z", note: null }],
  transclusions: [{ id: ID.R1, version: 1 }],
};

const remoteIndex = {
  updated: "2026-07-16T21:00:00Z",
  items: [
    { id: ID.R2, kind: "thread", created: "2026-07-16T21:00:00Z", updated: "2026-07-16T21:00:00Z", version: 1 },
    { id: ID.R1, kind: "fragment", created: "2026-07-16T20:10:00Z", updated: "2026-07-16T20:10:00Z", version: 1 },
  ],
};

function feedEntry({ id, kind, version, created, updated, page, title, descriptionHtml, creator, origin = ORIGIN }) {
  const guid = `blyg:${id}:v${version}`;
  const desc = descriptionHtml ? `\n      <description><![CDATA[${descriptionHtml}]]></description>` : "";
  const creatorEl = creator ? `\n      <dc:creator>${creator}</dc:creator>` : "";
  return `    <item>
      <guid isPermaLink="false">${guid}</guid>
      <link>${page}</link>
      <title>${title}</title>${desc}
      <pubDate>${rfc822(updated)}</pubDate>
      <blyg:id>${id}</blyg:id>
      <blyg:kind>${kind}</blyg:kind>
      <blyg:version>${version}</blyg:version>
      <blyg:created>${created}</blyg:created>
      <blyg:item>${origin}items/${id}.json</blyg:item>${creatorEl}
    </item>`;
}

function rss({ channelTitle, channelLink, description, buildDate, manifest, entries, nsPath }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:blyg="https://blygger.org/ns/0.1" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${channelTitle}</title>
    <link>${channelLink}</link>
    <description>${description}</description>
    <lastBuildDate>${buildDate}</lastBuildDate>
    <blyg:level>2</blyg:level>
    <blyg:manifest>${manifest}</blyg:manifest>
${entries.join("\n")}
  </channel>
</rss>
`;
}

const remoteFeed = rss({
  channelTitle: "Protocol Institute Blyg",
  channelLink: REMOTE,
  description: "A fixture blyg used as a cross-origin source.",
  buildDate: rfc822(remoteIndex.updated),
  manifest: REMOTE + "blyg.json",
  entries: [
    feedEntry({
      id: ID.R2, kind: "thread", version: 1,
      created: "2026-07-16T21:00:00Z", updated: "2026-07-16T21:00:00Z",
      page: REMOTE + `t/${ID.R2}/`,
      title: "Stigmergy is what a protocol looks like from inside…",
      descriptionHtml: r2.content_html,
      creator: REMOTE_AUTHOR.name,
      origin: REMOTE,
    }),
    feedEntry({
      id: ID.R1, kind: "fragment", version: 1,
      created: "2026-07-16T20:10:00Z", updated: "2026-07-16T20:10:00Z",
      page: REMOTE + `f/${ID.R1}/`,
      title: "Remote fragment content.",
      descriptionHtml: r1.content_html,
      creator: REMOTE_AUTHOR.name,
      origin: REMOTE,
    }),
  ],
});

j("remote-blyg/blyg.json", {
  blyg: "0.3",
  level: 2,
  generator: "fixture-remote/1.0.0",
  generator_url: "https://example.org/fixture-remote",
  site: REMOTE,
  title: "Protocol Institute Blyg",
  author: { name: "Editor", links: [{ label: "Home", url: REMOTE }] },
  feed: "feed.xml",
  items: "items/index.json",
  webmention: "webmention",
  updated: remoteIndex.updated,
});
j("remote-blyg/items/index.json", remoteIndex);
j(`remote-blyg/items/${ID.R1}.json`, r1);
j(`remote-blyg/items/${ID.R1}/v1.json`, r1pinned);
j(`remote-blyg/items/${ID.R2}.json`, r2);
add("remote-blyg/feed.xml", remoteFeed);
add(
  `remote-blyg/f/${ID.R1}/index.html`,
  `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Remote fragment content.</title>
<link rel="alternate" type="application/json" href="${REMOTE}items/${ID.R1}.json">
<link rel="webmention" href="${REMOTE}webmention">
</head><body><article><p>Remote fragment content.</p></article></body></html>\n`,
);

// -------------------------------------------------------------- example blyg
const aContentMd = "Markdown source of the *latest* version.";
const aV2Md = "Markdown source of the latest version.";
const a = {
  blyg: "0.3",
  id: ID.A,
  kind: "fragment",
  origin: ORIGIN,
  page: `f/${ID.A}/`,
  author: AUTHOR,
  created: "2026-07-17T18:00:00Z",
  updated: "2026-07-18T09:30:00Z",
  version: 3,
  content_md: aContentMd,
  content_html: "<p>Markdown source of the <em>latest</em> version.</p>",
  content_hash: contentHash(aContentMd),
  changelog: [
    { version: 1, at: "2026-07-17T18:00:00Z", note: null },
    { version: 2, at: "2026-07-17T21:12:00Z", note: "typo", pinned: true },
    { version: 3, at: "2026-07-18T09:30:00Z", note: "sharpened the claim" },
  ],
};
const aPinned = {
  blyg: "0.3",
  id: ID.A,
  kind: "fragment",
  version: 2,
  at: "2026-07-17T21:12:00Z",
  note: "typo",
  pinned: true,
  origin: ORIGIN,
  page: `f/${ID.A}/`,
  author: AUTHOR,
  content_md: aV2Md,
  content_html: "<p>Markdown source of the latest version.</p>",
  content_hash: contentHash(aV2Md),
};

const bContentMd = "A diagram: ![a diagram](media/x7f2.png)";
const b = {
  blyg: "0.3",
  id: ID.B,
  kind: "fragment",
  origin: ORIGIN,
  page: `f/${ID.B}/`,
  author: AUTHOR,
  created: "2026-07-18T12:00:00Z",
  updated: "2026-07-18T12:00:00Z",
  version: 1,
  content_md: bContentMd,
  content_html:
    `<p>A diagram: <img src="${ORIGIN}media/x7f2.png" alt="a diagram"></p>`,
  content_hash: contentHash(bContentMd),
  media: [{ url: "media/x7f2.png", mime: "image/png", alt: "a diagram" }],
  changelog: [{ version: 1, at: "2026-07-18T12:00:00Z", note: null }],
};

const tContentMd =
  `# A thread about protocol\n\nMarkdown source of the *latest* version.\n\n` +
  `![[${ID.A}]]\n\n` +
  `![[${ID.R1}]]\n\n` +
  `![[${ID.R2}]]\n> Stigmergy is what a protocol looks like from inside\n\n` +
  `Commentary: the quote above deliberates whether the mechanism is [[${ID.A}]].\n`;
const tContentHtml =
  `<h1>A thread about protocol</h1>\n` +
  `<p>Markdown source of the <em>latest</em> version.</p>\n` +
  `<blockquote class="blyg-transclusion" data-blyg-id="${ID.A}" data-blyg-version="3">` +
  `<p>Markdown source of the <em>latest</em> version.</p></blockquote>\n` +
  `<blockquote class="blyg-transclusion" data-blyg-id="${ID.R1}" data-blyg-version="1" data-blyg-origin="${REMOTE}">` +
  `<p>Remote fragment content.</p></blockquote>\n` +
  `<blockquote class="blyg-transclusion blyg-partial" data-blyg-id="${ID.R2}" data-blyg-version="1" data-blyg-origin="${REMOTE}">` +
  `<p>Stigmergy is what a protocol looks like from inside</p></blockquote>\n` +
  `<div class="blyg-tk-gen"><p>Commentary: the quote above deliberates whether the mechanism is ` +
  `<a href="${ORIGIN}f/${ID.A}/">desirable</a>.</p></div>\n`;
const t = {
  blyg: "0.3",
  id: ID.T,
  kind: "thread",
  origin: ORIGIN,
  page: `t/${ID.T}/`,
  author: AUTHOR,
  created: "2026-07-19T08:00:00Z",
  updated: "2026-07-20T10:00:00Z",
  version: 2,
  content_md: tContentMd,
  content_html: tContentHtml,
  content_hash: contentHash(tContentMd),
  changelog: [
    { version: 1, at: "2026-07-19T08:00:00Z", note: null },
    { version: 2, at: "2026-07-20T10:00:00Z", note: "added the remote quote", generated: true },
  ],
  transclusions: [
    { id: ID.A, version: 3 },
    { id: ID.R1, version: 1, origin: REMOTE },
    {
      id: ID.R2,
      version: 1,
      origin: REMOTE,
      selector: {
        exact: "Stigmergy is what a protocol looks like from inside",
        prefix: "",
        suffix: ", and the reason it looks like nothing at all is the point.",
      },
    },
  ],
  generated: [
    { sources: [{ id: ID.A, version: 3 }], model: "fixture-model-1", at: "2026-07-20T09:50:00Z" },
  ],
};

const sContentMd = `![[${ID.R1}]]\n\nThis is my response to the quoted fragment.\n`;
const sContentHtml =
  `<blockquote class="blyg-transclusion" data-blyg-id="${ID.R1}" data-blyg-version="1" data-blyg-origin="${REMOTE}">` +
  `<p>Remote fragment content.</p></blockquote>\n` +
  `<p>This is my response to the quoted fragment.</p>`;
const s = {
  blyg: "0.3",
  id: ID.S,
  kind: "thread",
  origin: ORIGIN,
  page: `t/${ID.S}/`,
  author: AUTHOR,
  created: "2026-07-21T09:00:00Z",
  updated: "2026-07-21T09:00:00Z",
  version: 1,
  content_md: sContentMd,
  content_html: sContentHtml,
  content_hash: contentHash(sContentMd),
  changelog: [{ version: 1, at: "2026-07-21T09:00:00Z", note: null }],
  transclusions: [{ id: ID.R1, version: 1, origin: REMOTE }],
  stub_of: {
    origin: REMOTE,
    id: ID.R1,
    version: 1,
    cited: {
      source: "Protocol Institute Blyg",
      author: REMOTE_AUTHOR.name,
      excerpt: "Remote fragment content.",
      url: `${REMOTE}f/${ID.R1}/`,
      retrieved: "2026-07-21T08:59:00Z",
    },
  },
};

const w = {
  blyg: "0.3",
  id: ID.W,
  kind: "withdrawn",
  origin: ORIGIN,
  page: `f/${ID.W}/`,
  author: AUTHOR,
  created: "2026-07-22T09:00:00Z",
  updated: "2026-07-23T09:00:00Z",
  version: 2,
  content_md: "",
  content_html: "",
  content_hash: contentHash(""),
  media: [],
  changelog: [
    { version: 1, at: "2026-07-22T09:00:00Z", note: null },
    { version: 2, at: "2026-07-23T09:00:00Z", note: "withdrawn" },
  ],
  forked_from: { origin: REMOTE, id: ID.R1, version: 1 },
};

const fContentMd =
  `Remote fragment content.\n\n` +
  `> Remote fragment content.\n>\n` +
  `> — quoted from [blyg.protocol-institute.org · v1](${REMOTE}f/${ID.R1}/)\n\n` +
  `My own continuation of the thought.\n`;
const fContentHtml =
  `<p>Remote fragment content.</p>\n` +
  `<blockquote><p>Remote fragment content.</p>` +
  `<p>— quoted from <a href="${REMOTE}f/${ID.R1}/">blyg.protocol-institute.org · v1</a></p></blockquote>\n` +
  `<p>My own continuation of the thought.</p>`;
const f = {
  blyg: "0.3",
  id: ID.F,
  kind: "fragment",
  origin: ORIGIN,
  page: `f/${ID.F}/`,
  author: AUTHOR,
  created: "2026-07-24T09:00:00Z",
  updated: "2026-07-24T09:00:00Z",
  version: 1,
  content_md: fContentMd,
  content_html: fContentHtml,
  content_hash: contentHash(fContentMd),
  changelog: [{ version: 1, at: "2026-07-24T09:00:00Z", note: null }],
  forked_from: { origin: REMOTE, id: ID.R1, version: 1 },
};

const index = {
  updated: "2026-07-24T09:00:00Z",
  items: [f, w, s, t, b, a].map((it) => ({
    id: it.id,
    kind: it.kind,
    created: it.created,
    updated: it.updated,
    version: it.version,
  })),
};

j("sample-blyg/blyg.json", {
  blyg: "0.3",
  level: 2,
  generator: "blyggerpress-fixture/1.0.0",
  generator_url: "https://example.org/blyggerpress-fixture",
  site: ORIGIN,
  title: "Example Studio blyg",
  author: { name: "Example Author", bio: "A fixture blyg.", links: [{ label: "Home", url: "https://example.com/" }] },
  feed: "feed.xml",
  items: "items/index.json",
  blogroll: "blogroll.opml",
  webmention: "webmention",
  updated: index.updated,
});
j("sample-blyg/items/index.json", index);
j(`sample-blyg/items/${ID.A}.json`, a);
j(`sample-blyg/items/${ID.A}/v2.json`, aPinned);
j(`sample-blyg/items/${ID.B}.json`, b);
j(`sample-blyg/items/${ID.T}.json`, t);
j(`sample-blyg/items/${ID.S}.json`, s);
j(`sample-blyg/items/${ID.W}.json`, w);
j(`sample-blyg/items/${ID.F}.json`, f);

const A_EXCERPT = "Markdown source of the latest…";
const sampleFeed = rss({
  channelTitle: "Example Studio blyg",
  channelLink: ORIGIN,
  description: "Fixture feed (lossy notification plane).",
  buildDate: rfc822(index.updated),
  manifest: ORIGIN + "blyg.json",
  entries: [
    feedEntry({
      id: ID.F, kind: "fragment", version: 1,
      created: f.created, updated: f.updated, page: ORIGIN + f.page,
      title: "Remote fragment content.", descriptionHtml: f.content_html, creator: AUTHOR.name,
    }),
    feedEntry({
      id: ID.W, kind: "withdrawn", version: 2,
      created: w.created, updated: w.updated, page: ORIGIN + w.page,
      title: "withdrawn", descriptionHtml: "", creator: null,
    }),
    feedEntry({
      id: ID.S, kind: "thread", version: 1,
      created: s.created, updated: s.updated, page: ORIGIN + s.page,
      title: "This is my response to the quoted fragment.", descriptionHtml: s.content_html, creator: AUTHOR.name,
    }),
    feedEntry({
      id: ID.T, kind: "thread", version: 2,
      created: t.created, updated: "2026-07-20T10:00:00Z", page: ORIGIN + t.page,
      title: "added the remote quote — A thread about protocol", descriptionHtml: t.content_html, creator: AUTHOR.name,
    }),
    feedEntry({
      id: ID.T, kind: "thread", version: 1,
      created: t.created, updated: "2026-07-19T08:00:00Z", page: ORIGIN + t.page,
      title: "A thread about protocol", descriptionHtml: t.content_html, creator: AUTHOR.name,
    }),
    feedEntry({
      id: ID.B, kind: "fragment", version: 1,
      created: b.created, updated: b.updated, page: ORIGIN + b.page,
      title: "A diagram: a diagram", descriptionHtml: b.content_html, creator: AUTHOR.name,
    }),
    feedEntry({
      id: ID.A, kind: "fragment", version: 3,
      created: a.created, updated: "2026-07-18T09:30:00Z", page: ORIGIN + a.page,
      title: `sharpened the claim — ${A_EXCERPT}`, descriptionHtml: a.content_html, creator: AUTHOR.name,
    }),
    feedEntry({
      id: ID.A, kind: "fragment", version: 2,
      created: a.created, updated: "2026-07-17T21:12:00Z", page: ORIGIN + a.page,
      title: `typo — ${A_EXCERPT}`, descriptionHtml: a.content_html, creator: AUTHOR.name,
    }),
    feedEntry({
      id: ID.A, kind: "fragment", version: 1,
      created: a.created, updated: "2026-07-17T18:00:00Z", page: ORIGIN + a.page,
      title: A_EXCERPT, descriptionHtml: a.content_html, creator: AUTHOR.name,
    }),
  ],
});
add("sample-blyg/feed.xml", sampleFeed);

add(
  "sample-blyg/blogroll.opml",
  `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Example Author's blogroll</title></head>
  <body>
    <outline type="rss" text="Protocol Institute Blyg"
             xmlUrl="${REMOTE}feed.xml"
             htmlUrl="${REMOTE}" />
    <outline type="rss" text="Interconnected"
             xmlUrl="https://interconnected.org/home/feed"
             htmlUrl="https://interconnected.org/home/" />
  </body>
</opml>
`,
);

add(
  `sample-blyg/f/${ID.A}/index.html`,
  `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Markdown source of the latest version.</title>
<link rel="alternate" type="application/json" href="${ORIGIN}items/${ID.A}.json">
<link rel="webmention" href="${ORIGIN}webmention">
</head><body><article>
<p>Markdown source of the <em>latest</em> version.</p>
<p>Pins: <a href="./v2/">v2 · pinned</a></p>
</article></body></html>\n`,
);
add(
  `sample-blyg/f/${ID.A}/v2/index.html`,
  `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Markdown source of the latest version. (pinned v2)</title>
<link rel="canonical" href="${ORIGIN}f/${ID.A}/">
</head><body><article>
<p class="frozen">Frozen snapshot — v2, pinned.</p>
<p>Markdown source of the latest version.</p>
<p><a href="v2.json">v2.json (machine citation)</a></p>
</article></body></html>\n`,
);
add(
  "sample-blyg/index.html",
  `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Example Studio blyg</title>
<link rel="blogroll" href="${ORIGIN}blogroll.opml">
<link rel="webmention" href="${ORIGIN}webmention">
<link rel="alternate" type="application/rss+xml" href="${ORIGIN}feed.xml">
</head><body><h1>Example Studio blyg</h1>
<ul><li><a href="f/${ID.A}/">Markdown source of the latest version.</a></li></ul>
</body></html>\n`,
);

// 1x1 transparent PNG for the media fixture.
add(
  "sample-blyg/media/x7f2.png",
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  ),
);

writeAll();

// --------------------------------------------------- reader-side private store
mkdirSync(STORE, { recursive: true });
const store = {
  schemaVersion: 1,
  publicationIdentity: { origin: ORIGIN, title: "Example Studio blyg" },
  drafts: [
    {
      localId: "draft-1",
      itemId: null,
      kind: "fragment",
      baseVersion: 0,
      contentMd: "DRAFT-ONLY: an unpublished idea.",
      note: null,
      generated: false,
      createdAt: "2026-07-25T09:00:00Z",
      updatedAt: "2026-07-25T09:05:00Z",
      authoringState: { instruction: "PRIVATE-INSTRUCTION-SECRET" },
    },
  ],
  notes: [{ targetKey: `${REMOTE}#${ID.R1}`, text: "PRIVATE-NOTE-SECRET", at: "2026-07-25T10:00:00Z" }],
  feedback: [{ targetKey: `${REMOTE}#${ID.R1}`, value: "like", at: "2026-07-25T10:01:00Z" }],
  ranking: {
    intent: "PRIVATE-INTENT",
    interests: [{ text: "protocols", weight: 1.0 }, { text: "static sites", weight: 0.5 }],
    updatedAt: "2026-07-25T10:02:00Z",
  },
  subscriptions: [
    {
      id: "sub-remote",
      mode: "blyg",
      identityOrigin: REMOTE,
      manifestUrl: REMOTE + "blyg.json",
      feedUrl: REMOTE + "feed.xml",
      title: "Protocol Institute Blyg",
      blogrollVisible: false,
      lossy: false,
      etag: 'W/"abc"',
      lastModified: "2026-07-16T21:00:00Z",
      backoffUntil: null,
      lastPolledAt: "2026-07-25T10:00:00Z",
      addedAt: "2026-07-20T00:00:00Z",
    },
    {
      id: "sub-legacy",
      mode: "legacy",
      identityOrigin: "https://interconnected.org/home/feed",
      manifestUrl: null,
      feedUrl: "https://interconnected.org/home/feed",
      title: "Interconnected",
      blogrollVisible: true,
      lossy: false,
      etag: null,
      lastModified: null,
      backoffUntil: null,
      lastPolledAt: "2026-07-25T10:00:00Z",
      addedAt: "2026-07-21T00:00:00Z",
    },
  ],
  imported: [
    {
      origin: REMOTE,
      id: ID.R1,
      kind: "fragment",
      version: 1,
      updated: r1.updated,
      contentHash: r1.content_hash,
      contentHtml: r1.content_html,
      contentMd: r1.content_md,
      author: r1.author,
      page: REMOTE + r1.page,
      media: [],
      retainedPinnedVersion: 1,
      l0: false,
      watermark: 1,
      observedAt: "2026-07-25T10:00:00Z",
      discrepancies: [],
    },
  ],
  outboundMentions: [
    {
      source: ORIGIN + s.page,
      target: `${REMOTE}f/${ID.R1}/`,
      relation: "stub",
      targetVersionSeen: 1,
      endpoint: REMOTE + "webmention",
      attempts: 1,
      nextAttemptAt: null,
      state: "sent",
    },
  ],
  inboundMentions: [
    {
      source: `${REMOTE}f/${ID.R1}/`,
      target: ORIGIN + s.page,
      status: "verified",
      relation: "transclusion",
      sourceId: ID.R1,
      sourceOrigin: REMOTE,
      sourceVersion: 1,
      sourceKind: "fragment",
      sourcePage: `${REMOTE}f/${ID.R1}/`,
    },
  ],
  publishTargets: [
    {
      id: "target-1",
      provider: "github",
      repo: "example/example-blyg",
      branch: "main",
      basePath: "blyg/",
      siteUrl: ORIGIN,
    },
  ],
  credentials: { github: { provider: "github", configured: true, storage: "session" } },
};
writeFileSync(join(STORE, "sample-store.json"), JSON.stringify(store, null, 2) + "\n");

console.log("wire fixtures written to", WIRE);
console.log("store fixture written to", join(STORE, "sample-store.json"));
console.log("selection substring check:", textContent(r2.content_html).includes("Stigmergy is what a protocol looks like from inside"));
