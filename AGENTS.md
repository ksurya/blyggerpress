# BlyggerPress — development and agent guide

Keep README.md user-facing. Put implementation details, engineering constraints, and development instructions here.

## Runtime and UI

- Use React 19+, Vite, Tailwind CSS, and Vercel ui-sdk.
- Build a standalone `dist/index.html` with inline JavaScript/CSS and no runtime CDN dependencies. Hash routes must work under repository subpaths on GitHub Pages.
- The app is browser-only, used on desktop and phone, and calls GitHub directly. Do not require a local server or clone.
- `scripts/companion.mjs` and its tests remain for the legacy local workflow. `npm start` runs that companion; the current app does not use it.
- Use the built-in browser for UI verification, not Safari.

Before using ui-sdk, follow its installed skill if available and read `node_modules/@ui-sdk/react/docs/llms.txt`. For new components, search `node_modules/@ui-sdk/react/docs/core.md` by heading and read the adjacent `rendering.md`. Use per-component imports and the existing Tailwind/ui-sdk layer ordering.

## Development and validation

Use Node.js 22 to match CI.

```sh
npm ci
npm run dev
npm run build
npm test
```

Build before testing: the standalone-artifact test reads `dist/index.html`. `scripts/inline.mjs` combines Vite output into one file and removes `dist/assets`. Keep generated output, dependencies, and TypeScript build metadata out of Git.

Run checks appropriate to the change. Documentation-only edits do not need a build. Inspect relevant desktop/mobile layouts for UI changes. Distinguish mocked API tests from live GitHub verification; do not claim real writes or deployments were tested when they were not.

Respect the user's command-execution preference. If they ask to run commands themselves, provide commands instead of running shell operations. Do not commit, push, rename branches, or deploy this project without authorization.

## Source map

| File | Responsibility |
| --- | --- |
| `src/App.tsx` | Workspace UI, editor, settings, changes, orchestration |
| `src/GitHubConnection.tsx` | App-level token panel, testing, account identity, persistence |
| `src/RepositorySetup.tsx` | Repository, branch, custom publication-folder selection |
| `src/github.mjs` | GitHub requests, snapshots, pending files, explicit commits |
| `src/workspaces.mjs` | Browser persistence, integer workspace IDs, removal, undo |
| `src/routes.mjs` | Hash routes and public post URLs |
| `src/protocol.mjs` | Blygger items, versions, pins, withdrawals, manifest, feed |
| `src/site.mjs` | Homepage, archive, post pages, public appearance settings |
| `src/sync.mjs` | Pull, conflict detection, regeneration of derived output |
| `src/relocate.mjs` | Preparing and canceling publication-folder changes |
| `src/style.css` | Application styles and responsive layouts |
| `test/` | Node tests, mocked GitHub API tests, legacy companion tests |

## Authentication and onboarding

GitHub access is app-level, separate from blyg creation. Use a fine-grained PAT scoped to selected repositories with Contents read/write access. Test authentication with a read-only `/user` request. Repository read access and effective write access are separate checks; GitHub enforces write permissions and branch policies when committing.

Remember tokens only on opt-in, separately from workspace data. Never include credentials in generated files, backups, logs, screenshots, or fixtures. Remembered credentials are accessible to scripts on the app's origin. Retain the verified username with remembered credentials. Keep the account icon consistent with adjacent header icons; no green status dot.

First-run UI must not show a fictitious blyg or call an empty placeholder a legacy workspace. Show Connect GitHub, then Add your first blyg. Preserve real existing browser drafts. Repository selection precedes blog details; load existing metadata before asking for missing details. Allow arbitrary relative publication folders and an explicit repository-root option.

Opening a repository is read-only. Empty repositories are supported: the first explicit commit initializes through GitHub's Contents API with `.blyggerpress/README.md`, then commits pending files. Handle initialization races without overwriting remote work.

## Persistence and source/output separation

- Workspace storage uses `blyggerpress-workspaces-v1`, with older-state migration. Preserve drafts, pending files, and IDs.
- Workspace IDs are browser-local integer strings. Post IDs are protocol 128-bit Crockford identifiers.
- Publication folders can be nested, such as `website/notes`.
- Draft sources: `.blyggerpress/drafts/<folder-key>/<id>.json`.
- Project settings: `.blyggerpress/projects/<folder-key>/settings.json`, containing the publication folder and editable settings.
- The current folder key encodes the publication path; `_root` represents the root. A segment such as `public` inside `.blyggerpress/` identifies the target blyg, not a public output directory. This coupling is existing behavior, not a requirement for future designs. Any move to stable project IDs needs safe migration.
- Prefer source project settings when loading, with older public metadata as fallback. Generated `blyggerpress.json` in the publication folder contains only public navigation/profile settings.
- Saving details or preparing publication generates public files. The homepage shows the newest 20 non-withdrawn posts by creation date; the archive links all non-withdrawn posts. Validate and escape navigation/profile URLs and user text.
- Deploy only the publication folder. Root publication needs `.blyggerpress/` excluded by deployment configuration. Drafts in public repositories remain readable on GitHub.

## Commit, pull, and conflict invariants

- Writing saves locally; Publish prepares files locally. Only explicit Commit changes or Save to a new branch actions write commits to GitHub.
- Preserve unrelated repository files by basing trees on the existing tree and changing only explicit pending paths.
- Update refs with `force: false`. Never force-push or silently discard remote work.
- Check the remote head before committing. Pull preserves independent changes, regenerates shared output, and stops on competing source edits without overwriting local work.
- Delegate genuine merge conflicts to GitHub through a separate branch and comparison/PR link. Do not build an ad hoc text merge editor. Complex conflicts may require another Git client.
- Preserve pinned versions. Protect existing non-generated home/archive pages from replacement.
- Reject truncated repository trees rather than treating incomplete listings as complete. Large repositories may encounter rate limits.
- Keep publishing in the editor; do not automatically navigate to Changes or show a green publish-success banner. Errors remain visible and actionable.

## Folder changes and removal

Expose Change folder in Settings for existing blygs. Check the remote head and destination collisions. Copy generated output including pins, and move draft/project sources using explicit pending additions and deletions. Preserve old published files and the public URL; hosting output settings change separately.

Folder changes remain pending until committed. Cancel restores old paths while retaining later writing/settings edits. Require commit or cancellation before pulling.

Remove blyg affects the browser workspace only, never GitHub files or the published site. Keep a local undo copy and clear uncommitted-change loss/recovery wording. Reopening the repository alone restores only committed work.

## Protocol scope

Reference: https://blygger.org/spec/0.4/.

The implemented publishing surface supports versions, pins, and withdrawal. Do not claim full reader or cross-origin conformance. Subscriptions, cross-origin transclusion, Blyg directives, and relocated protocol paths are not implemented. Reject unsupported constructs instead of silently dropping them.

For the legacy companion, stage only explicitly generated paths and preserve unrelated files and index entries. Never automatically commit or push a user's blog.

## GitHub Pages deployment

`.github/workflows/pages.yml` installs with `npm ci`, builds, tests, uploads only `dist/`, and deploys through Pages Actions. Pages must use GitHub Actions as its source; the `github-pages` environment must permit the deployment branch.

The workflow currently names both `main1` and `main` for the rewrite transition. Inspect actual remote/default-branch state before changing it. The intended arrangement is the previous implementation at `archive/main1` and the rewrite at `main`. Preserve history rather than force-pushing. Remove obsolete triggers only once the transition is verified.

Application URL: https://ksurya.github.io/blyggerpress/. App deployment and users' blog deployment are separate concerns. Browser storage is origin-specific: localhost workspaces and tokens do not automatically transfer to the hosted app.
