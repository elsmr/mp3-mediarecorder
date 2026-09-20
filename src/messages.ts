import type { Mp3EncoderConfig } from './encoder';

export interface Mp3WorkerEncodingConfig extends Mp3EncoderConfig {
    /** Overrides the worker's default `new URL('./mp3.wasm', import.meta.url)`. */
    wasmUrl?: string;
}

export type RecorderMessage =
    | { type: 'START_RECORDING'; config: Mp3WorkerEncodingConfig }
    | { type: 'DATA_AVAILABLE'; data: Float32Array[] }
    | { type: 'REQUEST_DATA' }
    | { type: 'STOP_RECORDING' };

export type WorkerMessage =
    /** `start`: performance.now() when the blob's first chunk was encoded (or when it was requested, if empty). */
    { type: 'DATA'; blob: Blob; start: number; final: boolean } | { type: 'ERROR'; error: string };

export type WorkletCommand = 'pause' | 'resume' | 'flush';
