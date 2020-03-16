declare module 'vmsg/vmsg.wasm' {
    const WasmModule: (imports: any) => Promise<WebAssembly.WebAssemblyInstantiatedSource>;
    export default WasmModule;
}
