# 🏗 Under construction 🏗

> [`MediaRecorder`](https://w3c.github.io/mediacapture-record/#mediarecorder-api) [ponyfill](https://ponyfill.com) that records audio as mp3

[![Build Status](https://travis-ci.org/eliasmeire/mp3-mediarecorder.svg?branch=master)](https://travis-ci.org/eliasmeire/mp3-mediarecorder)

## Usage

🏗 Under construction 🏗

## Browser Support

-   Chrome 57+
-   Firefox 52+
-   Safari 11+
-   Edge 16+

## Why

Browser support for MediaRecorder is [lacking](https://caniuse.com/#feat=mediarecorder).

Even when MediaRecorder is supported, the audio files it creates differ between browsers, and are not always compatible with other browsers. MP3 is the only audio format that can be played [by all modern browsers](https://developer.mozilla.org/en-US/docs/Web/HTML/Supported_media_formats#Browser_compatibility).

## Limitations

-   The `dataavailable` event only fires once, when encoding is complete. `MediaRecorder.start` ignores its optional `timeSlice` argument.
-   As a result of the first limitation, `MediaRecorder.requestData` does not trigger a `dataavailable` event.

## Related

-   https://github.com/Kagami/vmsg: Use this library if you want a more complete library with a built-in UI
