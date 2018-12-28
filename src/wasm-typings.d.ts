declare class WebAssemblyModule {}
declare class WebAssemblyInstance {
    exports: any;
}
declare class WebAssemblyMemory {
    constructor(options: { initial: number; maximum: number });
}

interface WebAssemblyResultObject {
    module: WebAssemblyModule;
    instance: WebAssemblyInstance;
}

interface WebAssemblyInterface {
    Memory: typeof WebAssemblyMemory;
    Module: typeof WebAssemblyModule;
    Instance: typeof WebAssemblyInstance;
    instantiate: (bufferSource: ArrayBuffer, imports: Record<string, any>) => WebAssemblyResultObject;
    instantiateStreaming: (
        bufferSource: Response | Promise<Response>,
        imports: Record<string, any>
    ) => Promise<WebAssemblyResultObject>;
}

declare const WebAssembly: WebAssemblyInterface;

interface Window {
    WebAssembly: WebAssemblyInterface;
}

interface VmsgRef {}

interface VmsgWasm {
    vmsg_init: (sampleRate: number) => VmsgRef;
    vmsg_encode: (data: Uint8Array) => void;
    vmsg_free: (ref: VmsgRef) => void;
    vmsg_flush: (ref: VmsgRef) => void;
}
