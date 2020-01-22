![mp3-mediarecorder header](https://user-images.githubusercontent.com/8850410/72912434-eb674580-3d3b-11ea-8ffc-aa754b8af9d8.png)

# 🎙 mp3-mediarecorder

[![Build Status](https://travis-ci.com/eliasmeire/mp3-mediarecorder.svg?branch=master)](https://travis-ci.com/eliasmeire/mp3-mediarecorder) [![NPM Version](https://badge.fury.io/js/mp3-mediarecorder.svg?style=flat)](https://npmjs.org/package/mp3-mediarecorder) [![Live demo](https://img.shields.io/badge/live%20demo-available-blue.svg)](https://eliasmei.re/mp3-mediarecorder)

A [MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder) [ponyfill](https://ponyfill.com) that records audio as mp3. It uses the great [Kagami/vmsg](https://github.com/Kagami/vmsg) library under the hood to encode mp3 audio in WebAssembly using [LAME](http://lame.sourceforge.net/).

View the [live demo](https://eliasmei.re/mp3-mediarecorder)

## Features

-   Standard [MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder) API
-   Audio encoding off the main thread using Web Workers
-   Consistent MP3 file output in all supported browsers
-   High quality type definitions
-   3kB main library
-   80kB Web Worker with WebAssembly module (Loaded async)

## Browser Support

-   Chrome 57+
-   Firefox 52+
-   Safari 11+
-   Edge 16+

## Installation

Install with npm or yarn.

```shell
yarn add mp3-mediarecorder
```

If you don't want to set up a build environment, you can get mp3-mediarecorder from a CDN like unpkg.com and it will be globally available through the window.mp3MediaRecorder object.

```html
<script src="https://unpkg.com/mp3-mediarecorder"></script>
```

See [this example](examples/basic) for more information.

## Usage

💡 For more detailed API docs, check out [MediaRecorder on MDN](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder)

We'll have two files: `index.js` and `worker.js`. The first is what we import from our app, so it runs on the main thread — it imports our worker (using worker-loader or workerize-loader) and passes it to `Mp3MediaRecorder` to create a recorder instance around it.

### index.js:

```ts
import { Mp3MediaRecorder } from 'mp3-mediarecorder';
import Mp3RecorderWorker from 'workerize-loader!./worker';
```

### worker.js:

```
import createStore from 'stockroom/worker'

let store = createStore({
count: 0
})

store.registerActions( store => ({
increment: ({ count }) => ({ count: count+1 })
}) )
```

The second file is our worker code, which runs in the background thread. Here we import Stockroom's worker-side "other half", stockroom/worker. This function returns a store instance just like createStore() does in Unistore, but sets things up to synchronize with the main/parent thread. It also adds a registerActions method to the store, which you can use to define globally-available actions for that store. These actions can be triggered from the main thread by invoking store.action('theActionName') and calling the function it returns.

## Why

Browser support for MediaRecorder is [lacking](https://caniuse.com/#feat=mediarecorder).

Even in browsers with support for MediaRecorder, the available audio formats differ between browsers, and are not always compatible with other browsers. MP3 is the only audio format that can be played [by all modern browsers](https://developer.mozilla.org/en-US/docs/Web/HTML/Supported_media_formats#Browser_compatibility).

[Kagami/vmsg](https://github.com/Kagami/vmsg) is a great library but I needed something that doesn't include a UI and/or getUserMedia code.

## Limitations

-   The `dataavailable` event only fires once, when encoding is complete. `MediaRecorder.start` ignores its optional `timeSlice` argument
-   `MediaRecorder.requestData` does not trigger a `dataavailable` event
-   `bitsPerSecond` is not configurable, the `MediaRecorder` constructor ignores its `options` argument.
-   The module returns a Promise to avoid delaying `MediaRecorder.start` until the Web Worker is ready. Once the Promise is resolved, the Web Worker will be ready to start encoding.

## Related

-   [Kagami/vmsg](https://github.com/Kagami/vmsg): Use this library if you want a more complete microphone recording library with a built-in UI
