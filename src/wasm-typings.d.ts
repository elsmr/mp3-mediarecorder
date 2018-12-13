// declaration.d.ts
declare module '*.wasm';

declare class WebAssembly {}

interface Window {
    WebAssembly: typeof WebAssembly;
}
