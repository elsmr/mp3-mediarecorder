declare class WebAssemblyModule {}
declare class WebAssemblyInstance {
    exports: any;
}
declare class WebAssemblyMemory {
    constructor(options: { initial: number; maximum: number });
    grow: (pages: number) => void;
    buffer: ArrayBuffer;
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
