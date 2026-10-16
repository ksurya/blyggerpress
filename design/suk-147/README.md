# SUK-147 · Studio design decision

Status: **Linear direction selected; Write screen refined after alignment and visual feedback**. The first three concepts were rejected as too complex. No visual direction has been implemented. This file is the design handoff for SUK-148, not a claim that the mockups match the running studio.

Selected desktop screens: [Write](selected-write.png) · [Read](selected-read.png) · [Posts](selected-posts.png) · [Publication](selected-publication.png). Each uses the same quiet header and content width. They are design references; mobile layouts and interactive states remain governed by the journey/state contract below.

## Current journey evidence

Captured on 2026-10-17 from the built studio over a local HTTP preview, using the repository's Chromium tooling. The blocked `file:` opening path was not used. Each accepted state has a desktop 1440px and phone-width 390px screenshot in `.context/suk-147/` (gitignored). Run `STUDIO_PREVIEW_URL=http://127.0.0.1:<port>/ node tools/capture-studio-journeys.mjs` against an authorized local preview to reproduce them.

| Step | Captured state | Health and design consequence |
| --- | --- | --- |
| 01 | First use | Functional setup, but backup and restore compete with the first task; guide users to publication identity then writing. |
| 02 | Populated Write + preview | Both surfaces work. Draft list, editor, preview, and publication actions share weight; establish a clear writing focus. |
| 03 | Local publication | Version is created and the status says “Published v1 locally.” Keep local publication distinct from deployment. |
| 04 | Public ZIP export | Download succeeds, but the page returns to a generic saved status. Show what was downloaded and what the user must deploy separately. |
| 05 | Empty Read | Subscription and feed import are discoverable; filters appear before content exists. Suppress empty filters or make the start task clearer. |
| 06 | Populated Read | Post, private note, and feedback work. At 390px, subscription/import controls precede the post by a long scroll. |
| 07 | Subscription loading | The content is inert during the request, with no explicit loading message; the prior “Unsaved changes” status remains. Design a visible busy state near Subscribe. |
| 08 | Subscription failure | Error appears in the global header, far from the URL on a long mobile page. Keep entered URL and place a recovery action beside the field. |
| 09 | Restore inspection | Counts appear before replacement and the current backup downloads before restore. Make the destructive scope and private/public boundary legible. |
| 10 | Restore completion | The current backup downloads and the inspected state replaces the local library; the generic saved message does not distinguish this consequential action. |
| 11 | Keyboard focus | A 3px focus outline appears when tabbing to Write. Preserve visible focus on every control and through state changes. |
| 12 | Quoted thread preview | Imported Blygger quote resolves and renders at both widths; preview still carries public-site navigation that the simpler editor should omit. |

Capture inspection: screenshots show the intended state at both widths; no blank or blocked captures were accepted. The script also rejects horizontal overflow. This is a visual/browser audit, not screen-reader or cross-browser certification. The loading capture exposes a missing busy message, and the focus capture proves a single keyboard path rather than all controls.

## Revised design directions

All three use the same simple navigation: **Write · Read · Posts · Publication**. “Posts” is the author's local draft and published-item list; “Read” is the private subscription reader. There is one Subscribe URL field, regardless of whether discovery finds a Blygger publication or an RSS/Atom feed. The file picker appears only as a recovery path after browser fetch failure or when the user explicitly chooses a local file. Its selected file is user-provided input, not a separate subscription type. The current controller already discovers both from one URL, but Subscribe only saves the relationship; the selected flow should fetch the first posts immediately after successful subscription.

1. **Linear — selected** — [initial direction](simple-linear.png), [refined Write screen](selected-write.png). One textarea fills the header's content width, with an optional rendered preview below. The editor has a native resize grip in both directions. A long draft requires scrolling between source and preview. Selected tokens: paper `#FAF7F0`, ink `#272A29`, forest teal `#326B67`, pale sage `#E7EFEB`, warm rule `#D6D1C8`.
2. **Split** — [screen](simple-split.png). Markdown on the left and rendered content on the right. Best for checking quotation and partial quotation while editing; narrow desktop widths and phones need a single-column preview toggle. Candidate tokens: paper `#FBFAF7`, ink `#252521`, accent `#B85840`, rule `#D5D2CC`.
3. **Optional drawer** — [screen](simple-drawer.png). The textarea owns the page; Preview opens a side panel on wide screens or a full-width pane on phones. Best if writing usually happens without preview, but adds a panel interaction. Candidate tokens: paper `#FAF9F5`, ink `#252722`, accent `#356B4E`, rule `#D4D7D0`.

Selected typography: locally available book serif (`Charter`, Georgia, serif) for written content, post excerpts, and major headings; system UI for controls, navigation, and metadata; monospace only for code or Markdown syntax where needed. Base 16px text and 8px spacing unit. Keep header, Fragment/Thread choice, and editor on one full-width content grid; action buttons align to the editor's right edge. Show save status only when it changes or needs attention, without reserving a persistent row above the editor. Use teal for primary actions and the active navigation state, sage for selected rows, and never color alone to communicate state. These generated images are layout proposals, not protocol fixtures: some sample IDs, source dates, and quote words are invented or malformed. Implementation must use the tested parser and actual stored source snapshot.

## Simple screen contract

- **Write:** Markdown textarea only, no separate title or “Writing area” settings. The textarea spans the header's content width by default and can be resized horizontally and vertically. Save draft, Show/Hide preview, Publish locally. Preview shows rendered content only, below the editor; no public-site navigation. Show only two choices immediately above the editor, Fragment and Thread: no “Type” label, question, or persistent helper text. Default new items to Fragment, while allowing the user to choose Thread explicitly; never infer kind from length. Give guidance only when a concrete action needs it, such as a validation message on publish, and let that message clear afterward. Fragment is recommended to stay within 1,000 characters in the studio (the spec's publisher recommendation is 2,000), and only Thread may carry Blygger transclusions. A Thread may be short or have no transclusions. After first publication, kind is immutable; changing kind requires a new item, preserving the original text. A published item can be opened from Posts for another version.
- **Read:** a compact URL input and Subscribe button live at the top of the sidebar, without a “Subscribe by URL” heading. The same URL field discovers Blygger or RSS. The sidebar filters by subscription and shows last checked and latest observed post separately. Put an explicit Unsubscribe action beside each subscription; do not add a Manage page. The current controller removes only the subscription relationship, so this action must not imply deletion of private notes or imported posts. A post supports reaction and a “Write a private note” action that opens note entry. A quick Notes view/filter reaches annotations without presenting them as publishable fragments or threads. Plain local search is a proposed control; question-led ranking is later and must not be implied by the mockup.
- **Posts:** local drafts and published items in a plain list, identified by first-line excerpts because entries have no title. Include a small new-post action, search, and All/Drafts/Published filters. Status distinguishes draft, locally published, exported and deployed evidence where available.
- **Publication:** URL and title, public ZIP download, private backup download, and one secondary “Restore backup…” action with confirmation. Do not show the old inspect-backup panel on the default screen. Restore still needs to reveal replacement scope and download the current backup before applying a selected file.

Blogger is an inspiration for the short Save, Preview, Publish loop and a separate post list, not a model for protocol or account behavior. [Blogger's official post guide](https://support.google.com/blogger/answer/154172?hl=en) describes that loop; its [reading-list guide](https://support.google.com/blogger/answer/99761?hl=en) uses a URL to follow a blog.

## Journey and state contract for the selected direction

```text
First use → set publication URL/title → Write Markdown → Preview content → publish local version → export public ZIP
Read empty → enter URL → discover Blygger or RSS → read/filter by subscription → react or save private note
Subscribe → loading → success or recoverable error with URL retained → offer file picker when browser access fails
Publication → download private backup → Restore backup… → choose file → show replacement scope/confirm → current backup downloads → restore
```

At both desktop and 390px, design these states: empty, populated, loading, error, and keyboard focus. First use must not imply that a public site already exists. Write must distinguish unsaved text, saved draft, locally published version, exported ZIP, and deployed site. Read must distinguish imported source identity from authenticated authorship; notes and reactions stay private. Curated blogroll publication requires explicit opt-in and export. Restore must show its replacement scope and preserve the current-backup-first behavior.

Quotation uses the existing `compose()` path for preview and publish. A thread's standalone `![[id]]` line resolves to a local published item or imported Blygger snapshot, bakes a blockquote, and records its origin/version. An immediately attached Markdown blockquote requests a partial quote; publish must reject a selection that is not in the held source text. The editor should offer “Quote in new thread” from an eligible Read post, so people need not type an ID. RSS-only L0 posts cannot be verified Blygger transclusions; offer an ordinary Markdown quote with a source link, labelled accordingly. A preview error must stay close to the editor and never silently turn into a plain quote. The current `studio.preview()` wraps composed content in `renderPage()`, adding Home/Archive/RSS chrome; the selected design should render `contentHtml` alone in the isolated preview.

Future GitHub connection: a per-piece Publish action could prepare a branch and pull request for user review, but static publication changes the feed, archive, manifest, and item files together. The proposed diff must cover the complete generated site and preserve unrelated repository files. Browser-side `isomorphic-git` clone/push usually needs a CORS proxy ([project documentation](https://github.com/isomorphic-git/isomorphic-git)); for a GitHub-only integration, GitHub's [Git database API](https://docs.github.com/en/rest/git) plus [pull-request API](https://docs.github.com/en/rest/pulls/pulls) is a likely simpler path. That is a future design investigation, not part of this issue.

Use local fonts and CSS; no theme engine or CDN dependency. Keep composition metadata available only through progressive disclosure. Exclude protocol changes, storage migration, GitHub integration, hosting/deployment, media upload UI, account/cloud features, and changes to private/public export rules from this design issue. SUK-148 may implement the selected shell and first-use flow after selection; app.mjs edits need coordination with its shell owner.

Verification at this gate: `npm run build`, 175 Node tests, and 144 fixture checks passed. Browser capture exercised the journeys listed above through HTTP. Final design acceptance still needs the selected direction rendered in the app at desktop and 390px, including the five states and keyboard focus; mockup images alone do not verify implementation.
