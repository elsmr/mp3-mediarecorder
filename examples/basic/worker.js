import { initMp3MediaEncoder } from 'mp3-mediarecorder/worker';
import vmsgWasmUrl from 'mp3-mediarecorder/vmsg.wasm?url';

initMp3MediaEncoder({ vmsgWasmUrl });
