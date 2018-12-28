import { ErrorMessage, PostMessageType, WorkerPostMessage, WorkerReadyMessage } from './types/post-message.type';

export const mp3EncoderWorker = () => {
    // from vmsg
    // Must be in sync with emcc settings!
    const TOTAL_STACK = 5 * 1024 * 1024;
    const TOTAL_MEMORY = 16 * 1024 * 1024;
    const WASM_PAGE_SIZE = 64 * 1024;
    let dynamicTop = TOTAL_STACK;
    let vmsg: VmsgWasm;

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
        const req: Promise<Response> = fetch(url, { credentials: 'same-origin' });
        return WebAssembly.instantiateStreaming(req, imports).catch(() => getWasmModuleFallback(url, imports));
    };

    const getVmsgImports = (): object => {
        const onExit = (err: any) => {
            console.log('exit', err);
            (postMessage as any)(new ErrorMessage({ error: 'Internal encoding error' }));
        };

        const sbrk = (increment: number): number => {
            const oldDynamicTop = dynamicTop;
            dynamicTop += increment;
            return oldDynamicTop;
        };

        const memory = new WebAssembly.Memory({
            initial: TOTAL_MEMORY / WASM_PAGE_SIZE,
            maximum: TOTAL_MEMORY / WASM_PAGE_SIZE
        });

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

    self.onmessage = event => {
        const message: WorkerPostMessage = event.data;

        switch (message.type) {
            case PostMessageType.INIT_WORKER: {
                console.log('Worker start');
                getWasmModule(message.payload.wasmURL, getVmsgImports()).then(wasm => {
                    vmsg = wasm.instance.exports;
                    (postMessage as any)(new WorkerReadyMessage());
                });
                break;
            }

            case PostMessageType.INIT_WORKER: {
                console.log('Worker start');
                getWasmModule(message.payload.wasmURL, getVmsgImports()).then(wasm => {
                    vmsg = wasm.instance.exports;
                    (postMessage as any)(new WorkerReadyMessage());
                });
            }
        }
    };
};
