# SUK-148 handoff

Implemented the selected SUK-147 linear shell and tokens, with Write / Read / Posts / Publication navigation, current-page semantics, heading focus, skip link, stacked preview, and disclosed restore controls. First use offers private drafting or reading. Draft creation, editing, saving, discarding, feed import and subscriptions require no publication identity. Publish saves the draft before requesting canonical publication settings; it does not automatically publish after setup. Export also requires a canonical identity. Draft preview uses composed content without public navigation.

Ownership: `src/studio/index.html` (shell/styles), `src/studio/app.mjs` (navigation, first use, publish gate), `src/studio/controller.mjs` (writer initialization and publication boundary), `test/studio.test.mjs`, and browser checks in `tools/test-shell-browser.mjs` / `tools/test-studio-browser.mjs`. Coordinate later shared app.mjs edits against these changes. No storage schema or protocol changes; single-file build preserved.

Acceptance on 2026-10-17:

- `npm test`: 176 passed.
- `npm run test:fixtures`: 144 passed.
- `npm run build` and `git diff --check`: passed.
- HTTP-served Chromium shell check: empty first use; subscription before publication setup; private draft save/reload; composed preview; publication gate and subsequent publication; active navigation and destination focus; desktop 1440px and mobile 390px without horizontal overflow; 200% browser CSS zoom with reduced viewport; visible keyboard focus; injected IndexedDB open/write failures preserve data/input and keep unavailable library inert.
- Existing Chromium regression suite passed via `STUDIO_PREVIEW_URL`, covering download, import, private annotations, independent unsaved buffers, focus/selection, canceled actions, failed writes, reload guard, restore and unsubscribe.
- Screenshots: `.context/suk-148-desktop.png`, `.context/suk-148-phone.png`. HTTP preview avoided the previously blocked file-opening path.

Reproduce: build, serve repository over HTTP, then run `STUDIO_PREVIEW_URL=http://127.0.0.1:8765/dist/ node tools/test-shell-browser.mjs` and the same environment variable with `node tools/test-studio-browser.mjs`.

Remaining scope: SUK-150 owns focused editing/type selection/preview toggling; SUK-152 owns reader layout and annotation disclosure; SUK-153 owns subscription progress/recovery and first refresh; SUK-155 owns expanded restore UX. Posts search/filtering is not implemented here. Relative draft links need a configured canonical origin to resolve in composition; the private draft itself can always be saved. Chromium evidence is not cross-browser or screen-reader certification; zoom uses CSS zoom rather than a native browser toolbar interaction. Existing preview CSP intentionally blocks remote images.
