export interface Mp3WorkerConfig {
    vmsgWasmUrl: string;
}

export interface Mp3WorkerEncodingConfig {
    sampleRate: number;
}

export interface Mp3MediaRecorderOptions extends MediaRecorderOptions {
    worker: Worker;
    audioContext?: AudioContext;
}
