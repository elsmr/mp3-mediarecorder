importScripts('https://unpkg.com/mp3-mediarecorder@4.0.0/worker/index.umd.js');
self.mp3EncoderWorker.initMp3MediaEncoder({ vmsgWasmUrl: 'https://unpkg.com/vmsg@0.3.6/vmsg.wasm' });
