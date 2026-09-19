---
'mp3-mediarecorder': major
---

Capture audio with an `AudioWorkletNode` instead of the deprecated `ScriptProcessorNode` (#246). The worklet module is loaded from an inline Blob URL, so there is no extra file to serve. The last partial buffer is now flushed on `stop()` instead of dropped, and `start()` failures (e.g. a closed `AudioContext`) surface as an `error` event instead of throwing asynchronously. Raises the browser floor to Chrome 66+, Firefox 76+, Safari 14.1+.
