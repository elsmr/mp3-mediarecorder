interface WorkerGlobalScope {
    onmessage: (message: MessageEvent) => void;
    postMessage: (message: any) => void;
}
