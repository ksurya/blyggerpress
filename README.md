# BlyggerPress

A browser-only Blygger 0.4 writer. React 19, Tailwind CSS, Vercel ui-sdk and Vite compile into a standalone `dist/index.html`, with no runtime CDN dependencies or companion API calls.

## Build and host

```sh
npm install
npm run build
npm test
```

Publish `dist/index.html` on GitHub Pages or another static HTTPS host. Use `npm run dev` for development. The older `npm start` companion remains available for legacy development/tests, but the current app does not use it.

## GitHub access

The header’s **GitHub connection** panel is independent of all blygs. Enter a fine-grained personal access token restricted to the desired repositories with Contents read/write permission, then **Test connection**. This makes a read-only `/user` request and reports the account or an actionable authentication/network error. Repository read access is checked on opening; effective write permission and branch policies are confirmed by GitHub when committing.

**Remember on this device** stores the successfully tested token separately from workspace data. Otherwise it stays in memory until reload. **Forget token** removes it. Tokens are sent only to api.github.com, never included in exported files. Remembered tokens are accessible to scripts running on the same origin; host the app on a trusted origin.

## Open or create a blyg

Use **Add blyg**, enter a repository URL and optional branch, then choose an existing blyg folder or a folder for a new blyg. Empty repositories are supported: the first explicit commit initializes the repository with a metadata README, then commits the pending blyg files. Opening a repository never writes to GitHub. Existing metadata loads automatically; new blygs ask for details after opening the repository. Workspaces are identified locally by integer IDs; protocol post IDs remain 128-bit Crockford identifiers.

Existing browser-only workspaces are preserved and can be downloaded from Changes. They are not silently attached to a different repository.

## Saving and syncing

Drafts auto-save on this device. Preparing publication generates files locally. **Changes → Commit changes** explicitly commits pending publications and drafts to the chosen GitHub branch. No action commits automatically. Drafts live in `.blyggerpress/drafts/<folder-key>/<id>.json` outside the publication folder. Deploy only that publication folder. Drafts in a public repository are still readable on GitHub.

**Pull latest** checks for overlapping source changes, retains independent local changes and regenerates common website outputs. Competing edits stop without overwriting local work. **Save to branch for pull request** writes a separate branch from the original base and provides GitHub’s comparison URL. Review, create the pull request and resolve conflicts on GitHub; complex conflicts may require another Git client. Branch updates never force-push. Unrelated repository files are preserved through the existing base tree.

The initial implementation loads the blyg’s files through the GitHub API and rejects truncated repository trees. Large repositories may be slow or encounter GitHub rate limits. This is not a full Git clone or a general-purpose merge client.

## Published pages

Blog details supports an optional profile-picture URL and navigation lines in `Title | link` format. Public settings are stored in `blyggerpress.json`. The homepage shows the newest 20 non-withdrawn posts by creation date, with all posts linked from `archive/index.html`. Saving details regenerates post pages too. Existing non-generated home/archive pages are protected from replacement.

The publishing surface supports post versions, pins and withdrawals. It does not implement full reader/cross-origin conformance, Blyg directives, subscriptions, or relocated protocol paths.

### Source and output folders

The publication folder may be any nested repository folder, such as `website/public/notes`. Project settings are committed separately at `.blyggerpress/projects/<folder-key>/settings.json`; draft sources remain at `.blyggerpress/drafts/<folder-key>/`. Source settings are loaded preferentially when reopening the blyg, with legacy public metadata as a fallback. Saving details or preparing publication generates the public pages and protocol metadata in the publication folder. `blyggerpress.json` there is a generated snapshot of public navigation/profile settings, not the project source. Settings shows the exact paths. Deploy only the publication folder; if using the repository root, explicitly exclude `.blyggerpress/` in your deployment.

To change an existing blyg’s output path, use **Settings → Repository & folders → Published output → Change folder**. Preparation checks the latest branch and destination files, copies the generated output (including pinned versions), and moves draft/project source files. Review the pending additions and source deletions in Changes, then commit explicitly. Old published files remain to preserve the existing site; update your hosting output directory after committing. The public URL does not change. Cancel folder change restores the original paths while retaining subsequent writing edits. Commit or cancel a pending folder change before pulling latest.

## Deploying this application on GitHub Pages

`.github/workflows/pages.yml` installs dependencies with `npm ci`, builds the standalone HTML, runs tests, and publishes only `dist/` as the Pages artifact. Generated files stay out of Git. Set **Settings → Pages → Source → GitHub Actions**. The `github-pages` environment must allow deployments from `main1` during the rewrite transition.

Pushes to `main1` deploy the rewrite now; the workflow also supports `main` after promotion. To promote later, preserve the existing remote `main` as an archive branch, rename the old `main` on GitHub, then rename `main1` to `main` and select it as the default branch. Check branch protection and Pages environment rules afterward, and remove `main1` from the workflow trigger. Do not force-push over the old implementation.
