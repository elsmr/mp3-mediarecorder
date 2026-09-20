![mp3-mediarecorder header](https://user-images.githubusercontent.com/8850410/72912434-eb674580-3d3b-11ea-8ffc-aa754b8af9d8.png)

# 🎙 mp3-mediarecorder

[![CI](https://github.com/elsmr/mp3-mediarecorder/actions/workflows/ci.yml/badge.svg)](https://github.com/elsmr/mp3-mediarecorder/actions/workflows/ci.yml) [![NPM Version](https://badge.fury.io/js/mp3-mediarecorder.svg?style=flat)](https://npmjs.org/package/mp3-mediarecorder) [![Live demo](https://img.shields.io/badge/live%20demo-available-blue.svg)](https://mp3-mediarecorder.elsmr.dev)

A [MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder) [ponyfill](https://ponyfill.com) that records audio as mp3, using a minimal build of [LAME](https://lame.sourceforge.io/) compiled to WebAssembly.

View the [live demo](https://mp3-mediarecorder.elsmr.dev)

## Features

- Standard [MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder) API, including `timeslice`, `requestData()`, `pause()`/`resume()` and `audioBitsPerSecond`
- Zero configuration: `new Mp3MediaRecorder(stream).start()`
- Mono or joint stereo, ABR encoding at any bitrate from 8 to 320 kbps
- Audio capture in an AudioWorklet, encoding in a Web Worker — nothing heavy on the main thread
- Consistent MP3 output in all supported browsers, with an exact duration header
- Typed events, ESM only, ~3 kB main library, ~80 kB wasm (36 kB brotli) loaded lazily in the worker

## Browser Support

Chrome 75+, Firefox 79+, Safari 15+, Edge 79+ (AudioWorklet, module workers, WebAssembly bulk memory).

## Installation

```shell
npm install mp3-mediarecorder
```

## Usage

```ts
import { Mp3MediaRecorder } from 'mp3-mediarecorder';

const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
const recorder = new Mp3MediaRecorder(stream);

recorder.ondataavailable = (event) => {
    const url = URL.createObjectURL(event.data); // audio/mpeg Blob
};
recorder.start();
// later
recorder.stop();
```

That's it. The library spawns a module worker next to itself with `new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })`, and the worker fetches `mp3.wasm` the same way. Vite, webpack 5, Rollup, Parcel, esbuild and plain `<script type="module">` all resolve this without configuration. For a full example, see [examples/basic](examples/basic) or [examples/react](examples/react).

### Without a bundler

```html
<script type="module">
    import { Mp3MediaRecorder } from 'https://esm.sh/mp3-mediarecorder';

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new Mp3MediaRecorder(stream);
</script>
```

### Stereo and bitrate

Recordings are mono at 64 kbps by default. Channel count is not auto-detected, because browsers report 2 channels for tracks whose audio processing already mixed them to mono, which would only double the file size.

```ts
const recorder = new Mp3MediaRecorder(stream, {
    channelCount: 2, // joint stereo; default bitrate becomes 128 kbps
    audioBitsPerSecond: 192_000, // any value from 8_000 to 320_000
});
```

For a true stereo microphone, disable the browser's voice processing so both channels reach the recorder:

```ts
navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 2, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
});
```

### Chunks while recording

```ts
recorder.start(1000); // dataavailable every second
recorder.requestData(); // or on demand
```

Each chunk is a `Blob` of complete MP3 frames; concatenating them in order (`new Blob(chunks)`) yields a valid file. Chunked recordings omit the duration header, since it has to be written at the start of the file once the recording is over. Players estimate the length from the bitrate instead — the same trade-off native `MediaRecorder` makes when streaming.

### Recording a Web Audio graph

To put a filter, compressor, gain or your own worklet in front of the encoder, end the graph in a `MediaStreamAudioDestinationNode` and record its stream on the same context:

```ts
const context = new AudioContext();
const source = context.createMediaStreamSource(stream);
const highpass = new BiquadFilterNode(context, { type: 'highpass', frequency: 80 });
const sink = new MediaStreamAudioDestinationNode(context);
source.connect(highpass).connect(sink);

const recorder = new Mp3MediaRecorder(sink.stream, { audioContext: context });
```

### Own worker or wasm location

The defaults cover most setups. If your CSP forbids workers from the library's origin, or you host the wasm elsewhere:

```ts
const recorder = new Mp3MediaRecorder(stream, {
    worker: new Worker('/vendor/mp3-mediarecorder/worker.js', { type: 'module' }), // a copy of mp3-mediarecorder/worker
    wasmUrl: 'https://cdn.example.com/mp3.wasm', // a copy of mp3-mediarecorder/mp3.wasm
});
```

A worker you pass in is yours: it is not terminated after the recording and can be reused across recordings. The default worker is spawned per `start()` and terminated after the final `dataavailable`.

## API

### `new Mp3MediaRecorder(stream, options?)`

- `stream: MediaStream` — audio tracks only; video tracks make `start()` throw `NotSupportedError`, as the spec requires for a container that cannot hold them.
- `options.mimeType?: string` — `""` (default), `audio/mpeg` or `audio/mpeg;codecs=mp3`; anything else throws `NotSupportedError`.
- `options.audioBitsPerSecond?: number` / `options.bitsPerSecond?: number` — ABR target, 8 000–320 000. Default 64 000 mono / 128 000 stereo. `bitsPerSecond` wins, as in the spec.
- `options.channelCount?: 1 | 2` — mono or joint stereo. Default 1.
- `options.audioContext?: AudioContext` — reuse a context. Chrome and Safari limit the number of live contexts.
- `options.worker?: Worker` — a module worker running `mp3-mediarecorder/worker`.
- `options.wasmUrl?: string` — where the worker fetches `mp3.wasm`.

Everything else follows the [MediaStream Recording spec](https://w3c.github.io/mediacapture-record/), including the parts most ponyfills skip (the only step not implemented is the `SecurityError` for isolated streams, which no cross-browser API can detect):

- `state` changes synchronously in `start()`/`stop()`/`pause()`/`resume()`; events fire asynchronously. `stop()` followed immediately by `start()` works — the previous recording still delivers its `dataavailable` and `stop`.
- `mimeType` is the constrained type (`""` unless you passed one) until recording actually starts, then `audio/mpeg` (or the type you passed), then back — exactly like Chrome.
- Wrong-state calls throw `DOMException` `InvalidStateError`; `stop()` on an inactive recorder is a no-op.
- `start(timeslice)` coerces like WebIDL `unsigned long` (no throwing); slices shorter than 100 ms are rounded up because the worklet batches ~85 ms of audio.
- When all audio tracks end (`track.stop()`, device unplugged) the recording stops by itself with `dataavailable` and `stop`. Adding or removing a track fires `error` (`InvalidModificationError`), then `dataavailable` with what was recorded, then `stop`.
- Encoder or setup failures fire `error` (`UnknownError`), then `dataavailable` with everything encoded so far, then `stop`.
- `error` events are `ErrorEvent`s whose `.error` is a `DOMException` with the spec name; `dataavailable` events are `BlobEvent`s whose `timecode` is 0 for the first blob and the offset of each later blob's first chunk.
- `audioBitsPerSecond`, `videoBitsPerSecond` (0), `audioBitrateMode` (`"variable"`), `stream` and the six `on*` handlers exist, and `addEventListener` is typed per event.

`Mp3MediaRecorder.isTypeSupported(type)` returns `true` for `""`, `audio/mpeg` and `audio/mp3` with an optional `codecs=mp3` parameter. (Read literally, the spec would return `false` for `codecs=mp3` because `mp3` is not a "synchronously exposed" identifier; that hedge exists for hardware detection and does not apply here.)

### `mp3-mediarecorder/worker`

The worker script. Importing it has side effects: it starts listening for messages from `Mp3MediaRecorder`. You only reference it when supplying your own `worker`.

### `mp3-mediarecorder/mp3.wasm`

The encoder binary, for hosting it yourself and pointing `wasmUrl` at it.

## Migrating from v4

**Browser support** is now Chrome 75+, Firefox 79+, Safari 15+, Edge 79+.

**No worker file needed.** Delete your `worker.js` and the `worker` option; `new Mp3MediaRecorder(stream)` is enough. `initMp3MediaEncoder` is gone: if you still want your own worker, point `new Worker(url, { type: 'module' })` at a copy of `mp3-mediarecorder/worker` and pass it as `worker`. The wasm location, previously `vmsgWasmUrl`, is the recorder's `wasmUrl` option.

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

**Entry points** are declared in `exports`: `mp3-mediarecorder`, `mp3-mediarecorder/worker` and `mp3-mediarecorder/mp3.wasm`. Deep imports like `mp3-mediarecorder/dist/index.es.js` no longer resolve.

**Encoding** changed from vmsg's mono VBR (quality 5) to ABR at 64 kbps mono. Files are a similar size; pass `audioBitsPerSecond` to tune it. Stereo is new.

**`pause()`** no longer suspends the `AudioContext`; the worklet just drops input. Sharing a context with other audio is now safe.

**Spec behaviour** replaces v4's approximations: `state` flips synchronously, `stop()` on an inactive recorder no longer throws, wrong-state calls throw `DOMException`s instead of `Error`s, `mimeType` is `""` until recording starts, `dataavailable` is always a `BlobEvent`, `error` is an `ErrorEvent` carrying a `DOMException`, streams with video tracks are rejected, and ended tracks stop the recording.

## Why

Browser support for MediaRecorder is [lacking](https://caniuse.com/#feat=mediarecorder).

Even in browsers with support for MediaRecorder, the available audio formats differ between browsers, and are not always compatible with other browsers. MP3 is the only audio format that can be played [by all modern browsers](https://developer.mozilla.org/en-US/docs/Web/HTML/Supported_media_formats#Browser_compatibility). No browser can encode it natively, neither through `MediaRecorder` nor WebCodecs, so the encoder ships as WebAssembly.

## Develop

```shell
bun install
bun run dev    # basic example at http://localhost:5173
bun test               # unit, including the wasm encoder
bun run test:e2e       # records a tone through the demo in headless Chromium
bun run build
```

### Rebuilding the encoder

`src/mp3.wasm` is committed. It is LAME 3.100 compiled with [wasi-sdk](https://github.com/WebAssembly/wasi-sdk) and wrapped by [`native/encoder.c`](native/encoder.c). The decoder, ID3 writer, ReplayGain, the CBR/VBR quantizers, VBR presets, CRC, stdio and libm are left out — via linker `--wrap` where possible and the small [`native/lame.patch`](native/lame.patch) for static functions — and math comes from JS `Math`, memory from a bump arena. That is what gets it to 80 kB:

```shell
native/build.sh   # downloads wasi-sdk and the LAME tarball into native/.cache on first run
```

Only needed when changing `native/` or bumping LAME. The build re-extracts the pinned tarball every time and fails if `lame.patch` no longer applies.

Releases are managed with [Changesets](https://github.com/changesets/changesets): add a changeset with `bunx changeset` in your PR.

## License

MIT. LAME is LGPL-2.0; `native/build.sh` fetches its source, applies [`native/lame.patch`](native/lame.patch) and links it into `mp3.wasm`.
