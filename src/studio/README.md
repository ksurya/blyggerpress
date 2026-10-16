# Private persistence (SUK-136)

`store.mjs` is browser-native ESM with no runtime dependencies. It shares the
contract validator with the fixture gate. `store-schemas.mjs` contains the local,
common and webmention schemas; a test rejects drift from the source contracts.

```js
import { openStore, inspectBackup } from './store.mjs';
const library = await openStore();
let { state, revision } = await library.read();
// Edit a detached snapshot, or pass it through the reader importer.
state.ranking.intent = 'Read about static publishing';
({ state, revision } = await library.save(state, revision));
const backupText = await library.backup();
// Download backupText as a PRIVATE JSON file, outside the static export.
const preview = inspectBackup(fileText);
// Render preview as text and obtain explicit replacement confirmation in UI.
({ state, revision } = await library.restore(fileText, revision));
library.close();
```

Every save/restore is one IndexedDB transaction. A revision check prevents stale
tabs or overlapping async import/autosave work from overwriting another save.
Keep unsaved edits and show errors (including quota/security errors); reload and
reconcile on conflict. No automatic reset, memory fallback, or publication occurs.
Opening migrates valid v1 state to v2 atomically and only once. Invalid/future
state remains untouched. Closing on versionchange allows future database upgrades.

The state follows `local-store.schema.json`, preserves JSON extension fields,
and supplies missing collections and ranking defaults. v2 adds the private
`publication: { items: [], pins: [], events: [] }` workspace extension for the
publication owner; entries remain that owner's wire models. No new public wire
format is introduced. Restoring replaces the local snapshot, including publication
history; preview differences and retain a current backup before replacement.
Restoration does not modify an already published site.

Backups have an explicit format/version envelope, include all private domains,
and exclude the top-level credential metadata on export and restore. They are
unencrypted and contain private notes and drafts. Secret material must stay in
session/OS storage, never in state extensions. These files are not publication
artifacts: the static exporter must construct wire objects from allowed fields,
never serialize this store or copy backup files into its output.

SUK-142 integration: use this single store for authoring and reading, show a saved
indicator only after `save` resolves, expose backup download and restore preview,
and present open/save errors without replacing the library. There is no UI shell
in this checkout yet. Tests use fake-indexeddb; actual phone/laptop storage and
file-download behavior still need browser validation with that shell.
