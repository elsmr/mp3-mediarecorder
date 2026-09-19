---
'mp3-mediarecorder': major
---

Modernized package: ESM-only, ~1 kB, no runtime dependencies besides the `vmsg` wasm.

## Migrating from v4

**Browser support** is now Chrome 64+, Firefox 59+, Safari 14+, Edge 79+ (native constructible `EventTarget`, `BlobEvent`, module workers).

**ESM only.** The UMD, ES5 and CommonJS builds are gone. Bundler users need no change. Without a bundler, replace

```html
<script src="https://unpkg.com/mp3-mediarecorder"></script>
<script>
    const { Mp3MediaRecorder } = window.mp3MediaRecorder;
</script>
```

with

```html
<script type="module">
    import { Mp3MediaRecorder } from 'https://esm.sh/mp3-mediarecorder';
</script>
```

**Entry points** are declared in `exports`. Deep imports like `mp3-mediarecorder/dist/index.es.js` or `mp3-mediarecorder/worker/index.umd.js` no longer resolve; use `mp3-mediarecorder`, `mp3-mediarecorder/worker` and `mp3-mediarecorder/vmsg.wasm`.

**Worker.** Create it as a module worker instead of via `workerize-loader` / `worker-loader`:

```js
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
```

**Wasm URL.** `vmsg.wasm` is exported, so import it as an asset instead of copying it:

```js
import vmsgWasmUrl from 'mp3-mediarecorder/vmsg.wasm?url'; // Vite; use your bundler's asset import
initMp3MediaEncoder({ vmsgWasmUrl });
```

**`dataavailable`** is now always a real `BlobEvent`; `event.data` is unchanged.

The public API of `Mp3MediaRecorder` and `initMp3MediaEncoder` is otherwise unchanged.
