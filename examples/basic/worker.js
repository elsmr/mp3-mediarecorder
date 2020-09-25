import 'regenerator-runtime/runtime'; // Needed when building with Parcel
import { initMp3MediaEncoder } from '../../src/worker';

initMp3MediaEncoder({ vmsgWasmUrl: 'https://unpkg.com/vmsg@0.3.6/vmsg.wasm' });
