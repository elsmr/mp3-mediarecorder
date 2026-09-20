import { createMp3Encoder, loadMp3Module, type Mp3Encoder } from './encoder';
import type { Mp3WorkerEncodingConfig, RecorderMessage, WorkerMessage } from './messages';

// Runs as the recorder's Web Worker. Mp3MediaRecorder spawns one per recording by default and
// terminates it after the final DATA message, which also frees the wasm memory.
const post = (message: WorkerMessage) => (self as unknown as Worker).postMessage(message);

const defaultWasmUrl = new URL('./mp3.wasm', import.meta.url).href;
const modules = new Map<string, Promise<WebAssembly.Module>>();
const moduleFor = (url = defaultWasmUrl) => {
    const cached = modules.get(url) ?? loadMp3Module(url);
    modules.set(url, cached);
    return cached;
};

let encoder: Mp3Encoder | null = null;
let chunks: Uint8Array[] = [];
let blobStart: number | null = null;
let delivered = false;

const start = async (config: Mp3WorkerEncodingConfig) => {
    encoder = await createMp3Encoder(await moduleFor(config.wasmUrl), config);
    chunks = [];
    blobStart = null;
    delivered = false;
};

const deliver = (parts: Uint8Array[], final: boolean) => {
    post({
        type: 'DATA',
        blob: new Blob(parts as BlobPart[], { type: 'audio/mpeg' }),
        start: blobStart ?? performance.now(),
        final,
    });
    chunks = [];
    blobStart = null;
    delivered = true;
};

// LAME reserves the info frame's bytes at the start of the stream as a silent placeholder frame. The
// first blob to leave the worker either swaps in the real frame or, if the stream is still going and
// the frame can never be written, drops the placeholder so the file does not start with silence.
const replacePlaceholder = (parts: Uint8Array[], length: number, infoFrame: Uint8Array | null) => {
    const first = parts.findIndex((part) => part.length > 0);
    if (delivered || length === 0 || first < 0 || parts[first].length < length) return parts;
    const replacement = infoFrame ? [infoFrame] : [];
    return [...parts.slice(0, first), ...replacement, parts[first].subarray(length), ...parts.slice(first + 1)];
};

const handle = async (message: RecorderMessage) => {
    switch (message.type) {
        case 'START_RECORDING':
            await start(message.config);
            break;
        case 'DATA_AVAILABLE':
            if (!encoder) return;
            blobStart ??= performance.now();
            chunks.push(encoder.encode(message.data));
            break;
        case 'REQUEST_DATA':
            deliver(replacePlaceholder(chunks, encoder?.infoFrameLength() ?? 0, null), false);
            break;
        case 'STOP_RECORDING': {
            if (!encoder) {
                deliver(chunks, true);
                return;
            }
            const { tail, infoFrame } = encoder.finish();
            encoder = null;
            deliver(replacePlaceholder([...chunks, tail], infoFrame?.length ?? 0, infoFrame), true);
            break;
        }
    }
};

// Messages are handled strictly in order so that e.g. STOP_RECORDING always sees the encoder START created.
// On failure the recorder gets the error, then whatever was encoded so far as the final blob.
let queue = Promise.resolve();
self.addEventListener('message', (event: MessageEvent<RecorderMessage>) => {
    queue = queue.then(async () => {
        try {
            await handle(event.data);
        } catch (error) {
            post({ type: 'ERROR', error: error instanceof Error ? error.message : String(error) });
            encoder = null;
            deliver(chunks, true);
        }
    });
});
