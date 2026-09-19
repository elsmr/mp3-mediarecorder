export interface Mp3WorkerConfig {
    vmsgWasmUrl: string;
}

export interface Mp3WorkerEncodingConfig {
    sampleRate: number;
}

export type RecorderMessage =
    | { type: 'START_RECORDING'; config: Mp3WorkerEncodingConfig }
    | { type: 'DATA_AVAILABLE'; data: Float32Array }
    | { type: 'STOP_RECORDING' };

export type WorkerMessage =
    | { type: 'WORKER_RECORDING' }
    | { type: 'BLOB_READY'; blob: Blob }
    | { type: 'ERROR'; error: string };
