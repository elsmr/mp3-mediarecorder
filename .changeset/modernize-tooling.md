---
'mp3-mediarecorder': major
---

Modernized package: ESM-only with an `exports` map (`mp3-mediarecorder`, `mp3-mediarecorder/worker`, `mp3-mediarecorder/vmsg.wasm`), no more UMD/ES5/CJS builds. Uses the native `EventTarget` and `BlobEvent`, dropping the `event-target-shim` dependency. Requires browsers with constructible `EventTarget` (Chrome 64+, Firefox 59+, Safari 14+).
