export interface GlobalConfig {
    wasmURL: string;
}

export interface WorkerConfig {
    sampleRate: number;
}

export interface Mp3MediaRecorderOptions extends MediaRecorderOptions {
    audioContext?: AudioContext;
}
