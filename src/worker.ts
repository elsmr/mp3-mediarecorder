import { WorkerPostMessage } from './types/post-message.type';
import { WorkerConfig } from './types/worker-config.type';

export const mp3EncoderWorker = () => {
    // from vmsg
    // Must be in sync with emcc settings!
    const TOTAL_STACK = 5 * 1024 * 1024;
    const TOTAL_MEMORY = 16 * 1024 * 1024;
    const WASM_PAGE_SIZE = 64 * 1024;
    const ctx = (self as any) as WorkerGlobalScope;
    const memory = new WebAssembly.Memory({
        initial: TOTAL_MEMORY / WASM_PAGE_SIZE,
        maximum: TOTAL_MEMORY / WASM_PAGE_SIZE
    });
    let dynamicTop = TOTAL_STACK;
    let vmsg: VmsgWasm;
    let isRecording = false;
    let vmsgRef: number;
    let pcmLeft: Float32Array;

    const getWasmModuleFallback = (url: string, imports: object): Promise<WebAssemblyResultObject> => {
        return new Promise((resolve, reject) => {
            const req = new XMLHttpRequest();
            req.open('GET', url);
            req.responseType = 'arraybuffer';
            req.onload = () => {
                resolve(WebAssembly.instantiate(req.response, imports));
            };
            req.onerror = reject;
            req.send();
        });
    };

    const getWasmModule = (url: string, imports: object): Promise<WebAssemblyResultObject> => {
        if (!WebAssembly.instantiateStreaming) {
            return getWasmModuleFallback(url, imports);
        }
        const req: Promise<any> = fetch(url, { credentials: 'same-origin' }).catch(err => console.error(err));
        return WebAssembly.instantiateStreaming(req, imports).catch(() => getWasmModuleFallback(url, imports));
    };

    const getVmsgImports = (): Record<string, any> => {
        const onExit = (err: any) => {
            ctx.postMessage({ type: 'ERROR', error: 'internal' });
        };

        const sbrk = (increment: number): number => {
            const oldDynamicTop = dynamicTop;
            dynamicTop += increment;
            return oldDynamicTop;
        };

        const env = {
            memory,
            sbrk,
            exit: onExit,
            pow: Math.pow,
            powf: Math.pow,
            exp: Math.exp,
            sqrtf: Math.sqrt,
            cos: Math.cos,
            log: Math.log,
            sin: Math.sin
        };

        return { env };
    };

    const onStartRecording = (config: WorkerConfig): void => {
        isRecording = true;
        vmsgRef = vmsg.vmsg_init(config.sampleRate);
        if (!vmsgRef || !vmsg) {
            throw new Error('init_failed');
        }
        const pcmLeftRef = new Uint32Array(memory.buffer, vmsgRef, 1)[0];
        pcmLeft = new Float32Array(memory.buffer, pcmLeftRef);
    };

    const onStopRecording = (): Blob => {
        isRecording = false;
        if (vmsg.vmsg_flush(vmsgRef) < 0) {
            throw new Error('flush_failed');
        }
        const mp3BytesRef = new Uint32Array(memory.buffer, vmsgRef + 4, 1)[0];
        const size = new Uint32Array(memory.buffer, vmsgRef + 8, 1)[0];
        const mp3Bytes = new Uint8Array(memory.buffer, mp3BytesRef, size);
        const blob = new Blob([mp3Bytes], { type: 'audio/mpeg' });
        vmsg.vmsg_free(vmsgRef);
        return blob;
    };

    const onDataReceived = (data: ArrayLike<number>): void => {
        if (!isRecording) {
            return;
        }

        pcmLeft.set(data);
        const encodedBytesAmount = vmsg.vmsg_encode(vmsgRef, data.length);
        if (encodedBytesAmount < 0) {
            throw new Error('encoding_failed');
        }
    };

    ctx.onmessage = event => {
        const message: WorkerPostMessage = event.data;
        try {
            switch (message.type) {
                case 'INIT_WORKER': {
                    const imports = getVmsgImports();
                    getWasmModule(message.wasmURL, imports)
                        .then(wasm => {
                            vmsg = wasm.instance.exports;
                            ctx.postMessage({ type: 'WORKER_READY' });
                        })
                        .catch(err => {
                            ctx.postMessage({ type: 'ERROR', error: err.message });
                        });
                    break;
                }
                case 'START_RECORDING': {
                    onStartRecording(message.config);
                    ctx.postMessage({ type: 'WORKER_RECORDING' });
                    break;
                }

                case 'DATA_AVAILABLE': {
                    onDataReceived(message.data);
                    break;
                }

                case 'STOP_RECORDING': {
                    const blob = onStopRecording();
                    ctx.postMessage({ type: 'BLOB_READY', blob });
                    break;
                }
            }
        } catch (err) {
            ctx.postMessage({ type: 'ERROR', error: err.message });
        }
    };
};
