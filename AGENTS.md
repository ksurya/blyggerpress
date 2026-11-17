# BlyggerPress

Before using ui-sdk, follow the ui-sdk skill if it is installed, and read `node_modules/@ui-sdk/react/docs/llms.txt`. To build a new component, also search `node_modules/@ui-sdk/react/docs/core.md` by heading and read `rendering.md` next to it.

Use React 19+, Vite, and Tailwind CSS. Build must emit a standalone `dist/index.html` with no runtime CDN dependencies. Never commit or push a user's blog automatically. Publishing must stage only the explicitly generated paths, preserving unrelated files and index entries.

Protocol reference: https://blygger.org/spec/0.4/. Do not claim full reader or cross-origin conformance without implementing and testing those features.
