importScripts('../worker/index.umd.js');
self.mp3EncoderWorker.initMp3MediaEncoder({ vmsgWasmUrl: 'https://unpkg.com/vmsg@0.3.5/vmsg.wasm' });