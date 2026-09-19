![mp3-mediarecorder header](https://user-images.githubusercontent.com/8850410/72912434-eb674580-3d3b-11ea-8ffc-aa754b8af9d8.png)

# 🎙 mp3-mediarecorder

[![CI](https://github.com/elsmr/mp3-mediarecorder/actions/workflows/ci.yml/badge.svg)](https://github.com/elsmr/mp3-mediarecorder/actions/workflows/ci.yml) [![NPM Version](https://badge.fury.io/js/mp3-mediarecorder.svg?style=flat)](https://npmjs.org/package/mp3-mediarecorder) [![Live demo](https://img.shields.io/badge/live%20demo-available-blue.svg)](https://mp3-mediarecorder.elsmr.dev)

A [MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder) [ponyfill](https://ponyfill.com) that records audio as mp3. It uses the great [Kagami/vmsg](https://github.com/Kagami/vmsg) library under the hood to encode mp3 audio in WebAssembly using [LAME](http://lame.sourceforge.net/).

View the [live demo](https://mp3-mediarecorder.elsmr.dev)

## Features

- Standard [MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder) API
- Audio encoding off the main thread using Web Workers
- Consistent MP3 file output in all supported browsers
- High quality type definitions
- ESM only, ~1kB main library
- ~75kB Web Worker with WebAssembly module (loaded async)

## Browser Support

- Chrome 64+
- Firefox 59+
- Safari 14+
- Edge 79+

## Installation

```shell
npm install mp3-mediarecorder
```

No build step? Import it straight from a CDN as an ES module, see [below](#without-a-bundler).

## Usage

We'll have two files: `index.js` and `worker.js`. The first runs on the main thread — it spawns the worker and passes it to `Mp3MediaRecorder` to create a recorder instance around it.

### index.js

```ts
import { Mp3MediaRecorder } from 'mp3-mediarecorder';

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const recorder = new Mp3MediaRecorder(
    mediaStream, // MediaStream instance
    { worker },
);
recorder.start(); // 🎉
```

In most cases the MediaStream instance will come from the [getUserMedia API](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia). For a full example, see [examples/basic](examples/basic) or [examples/react](examples/react).

### worker.js

```ts
import { initMp3MediaEncoder } from 'mp3-mediarecorder/worker';
import vmsgWasmUrl from 'mp3-mediarecorder/vmsg.wasm?url'; // Vite; use your bundler's asset URL import

initMp3MediaEncoder({ vmsgWasmUrl });
```

The second file is our worker code, which runs in the background thread. Here we import `initMp3MediaEncoder` from `mp3-mediarecorder/worker`. This sets things up to communicate with the main thread.

### Without a bundler

```html
<script type="module">
    import { Mp3MediaRecorder } from 'https://esm.sh/mp3-mediarecorder';

    const worker = new Worker('./worker.js', { type: 'module' });
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new Mp3MediaRecorder(stream, { worker });
</script>
```

```js
// worker.js
import { initMp3MediaEncoder } from 'https://esm.sh/mp3-mediarecorder/worker';

initMp3MediaEncoder({ vmsgWasmUrl: 'https://esm.sh/mp3-mediarecorder/dist/vmsg.wasm' });
```

## API

### module:mp3-mediarecorder

#### Mp3MediaRecorder

Mp3MediaRecorder is a class that has the same API as the standard [MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder). If you want to see the full API please check out [the documentation on MDN](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder).

**Constructor parameters**

The Mp3MediaRecorder constructor parameters differ from the standard API.

- `mediaStream: MediaStream` An instance of **[MediaStream](https://developer.mozilla.org/en-US/docs/Web/API/MediaStream)** (eg: from [getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia))

- `options: Mp3MediaRecorderOptions`
    - `worker: Worker` An instantiated **[Web Worker](https://developer.mozilla.org/docs/Web/JavaScript)** (eg: `new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })`)
    - `audioContext?: AudioContext`An instantiated **[AudioContext](https://developer.mozilla.org/docs/Web/JavaScript)** (eg: `new AudioContext()`)
      This might be useful if you want to full control over the AudioContext. Chrome and Safari limit the number of AudioContext objects.

**Example**

```ts
const recorder = new Mp3MediaRecorder(
    mediaStream, // MediaStream instance
    {
        worker: new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }),
        // Optionally supply your own AudioContext
        audioContext: new AudioContext(),
    },
);
```

### module:mp3-mediarecorder/worker

The [Web Worker](https://developer.mozilla.org/docs/Web/JavaScript) side the of the recorder. The worker will communicate with the main thread to encode the mp3 file.

#### initMp3MediaEncoder

Sets up the communication with the main thread.

**Parameters**

- `vmsgWasmUrl: string` The URL of the `vmsg.wasm` file.
  This could be self-hosted or from a CDN. The Worker will fetch this URL and instantiate a WebAssembly module from it.

**Example**

```ts
import { initMp3MediaEncoder } from 'mp3-mediarecorder/worker';

initMp3MediaEncoder({ vmsgWasmUrl: '/url/to/vmsg.wasm' });
```

## Why

Browser support for MediaRecorder is [lacking](https://caniuse.com/#feat=mediarecorder).

Even in browsers with support for MediaRecorder, the available audio formats differ between browsers, and are not always compatible with other browsers. MP3 is the only audio format that can be played [by all modern browsers](https://developer.mozilla.org/en-US/docs/Web/HTML/Supported_media_formats#Browser_compatibility).

[Kagami/vmsg](https://github.com/Kagami/vmsg) is a great library but I needed something that doesn't include a UI and/or getUserMedia code.

## Limitations

- In Safari, pause and resume does not work (see [#60](https://github.com/elsmr/mp3-mediarecorder/issues/60))
- The `dataavailable` event only fires once, when encoding is complete. `MediaRecorder.start` ignores its optional `timeSlice` argument. As a result,`MediaRecorder.requestData` does not trigger a `dataavailable` event
- `bitsPerSecond` is not configurable, the `MediaRecorder` constructor will ignore this option.

## Develop

```shell
bun install
bun run dev    # basic example at http://localhost:5173
bun test
bun run build
```

Releases are managed with [Changesets](https://github.com/changesets/changesets): add a changeset with `bunx changeset` in your PR.
