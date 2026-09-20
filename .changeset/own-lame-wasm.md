---
'mp3-mediarecorder': major
---

Own LAME build, zero-config setup, stereo, and a spec-faithful `MediaRecorder` surface.

**Encoder.** `vmsg` is gone. `mp3.wasm` is LAME 3.100 built with wasi-sdk from `native/` (decoder, ID3, ReplayGain, CBR/VBR quantizers, stdio and libm removed; math comes from JS, memory from a bump arena): 78 kB raw / 34 kB brotli, down from 150 / 64, encoding mono or joint stereo as ABR at 8–320 kbps with an exact-duration info frame.

**Zero config.** `new Mp3MediaRecorder(stream)` is all that is needed. The worker is spawned from `new URL('./worker.js', import.meta.url)` and fetches the wasm the same way; Vite 8+, webpack 5, Parcel 2 and plain `<script type="module">` resolve this, and the README lists the one-liner for Vite ≤ 7 dev, esbuild, Bun and Rollup. `initMp3MediaEncoder` is removed; pass `worker` for a custom worker script and `wasmUrl` for a custom wasm location.

**New options.** `channelCount: 1 | 2` (default mono), `audioBitsPerSecond` / `bitsPerSecond`, `mimeType`, `wasmUrl`.

**MediaRecorder behaviour now follows the spec:** `start(timeslice)` and `requestData()` deliver chunks; `state` changes synchronously and events fire asynchronously; `stop()` on an inactive recorder is a no-op; wrong-state calls throw `DOMException`s; `mimeType` is `""` until recording starts; `audioBitrateMode` exists; streams with video tracks are rejected with `NotSupportedError`; ended tracks stop the recording; track-set changes and encoder failures fire `error` (`ErrorEvent` carrying a `DOMException`), then `dataavailable` with the data so far, then `stop`; `BlobEvent.timecode` is relative to the first blob; `start` fires once audio is actually being captured. `pause()` no longer suspends the `AudioContext`, so a shared context is safe. `requestData()` on a recording without `timeslice` no longer leaves LAME's placeholder frame at the head of the first chunk.

**Browser floor** moves to Chrome 85+, Firefox 114+, Safari 15+, Edge 85+ (module workers, ES2021, WebAssembly bulk memory). The main bundle and `mp3-mediarecorder/worker` must come from the same version.
