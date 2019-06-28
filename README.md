# 🎙 mp3-mediarecorder

[![Build Status](https://travis-ci.com/eliasmeire/mp3-mediarecorder.svg?branch=master)](https://travis-ci.com/eliasmeire/mp3-mediarecorder) [![NPM Version](https://badge.fury.io/js/mp3-mediarecorder.svg?style=flat)](https://npmjs.org/package/mp3-mediarecorder) [![Live demo](https://img.shields.io/badge/live%20demo-available-blue.svg)](https://eliasmei.re/mp3-mediarecorder)

A [MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder) [ponyfill](https://ponyfill.com) that records audio as mp3. It uses the great [Kagami/vmsg](https://github.com/Kagami/vmsg) library under the hood to encode mp3 audio in WebAssembly using [LAME](http://lame.sourceforge.net/).

View the demo app [Live](https://eliasmei.re/mp3-mediarecorder) / [Code](demo)

## Features

-   Standard [MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder) API
-   Audio encoding off the main thread using Web Workers
-   Consistent MP3 file output in all supported browsers
-   High quality type definitions
-   3.7kB gzipped

## Browser Support

-   Chrome 57+
-   Firefox 52+
-   Safari 11+
-   Edge 16+

## Installation

Install with npm or yarn.

```shell
npm i mp3-mediarecorder
```

If you don't want to set up a build environment, you can get mp3-mediarecorder from a CDN like unpkg.com and it will be globally available through the window.mp3MediaRecorder object.

```html
<script src="https://unpkg.com/mp3-mediarecorder"></script>
```

## Usage

```js
import { getMp3MediaRecorder } from 'mp3-mediarecorder';

getMp3MediaRecorder({ wasmURL: '/dist/vmsg.wasm' }).then(Mp3MediaRecorder => {
    const recorder = new Mp3MediaRecorder(mediaStream);
    recorder.start();
});
```

getMp3MediaRecorder returns a `Promise<typeof MediaRecorder>`. The promise will resolve once the Web Assembly module is initialized and the library is ready to start recording.

💡 For more detailed API docs, check out [MediaRecorder on MDN](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder)

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
