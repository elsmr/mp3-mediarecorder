import type { RecorderMessage, WorkerMessage } from './messages';

export interface Mp3MediaRecorderOptions extends MediaRecorderOptions {
    worker: Worker;
    audioContext?: AudioContext;
}

const MP3_MIME_TYPE = 'audio/mpeg';

export class Mp3MediaRecorder extends EventTarget {
    stream: MediaStream;
    mimeType = MP3_MIME_TYPE;
    state: RecordingState = 'inactive';
    audioBitsPerSecond = 0;
    videoBitsPerSecond = 0;

    private audioContext: AudioContext;
    private sourceNode: MediaStreamAudioSourceNode;
    private gainNode: GainNode;
    private processorNode: ScriptProcessorNode;
    private worker: Worker;
    private isInternalAudioContext = false;

    static isTypeSupported = (mimeType: string) => mimeType === MP3_MIME_TYPE;

    constructor(stream: MediaStream, { audioContext, worker }: Mp3MediaRecorderOptions) {
        super();

        if (!worker) {
            throw new Error('No worker provided in Mp3MediaRecorder constructor.');
        }
        this.stream = stream;
        this.isInternalAudioContext = !audioContext;
        this.audioContext = audioContext || new AudioContext();
        this.worker = worker;
        this.sourceNode = this.audioContext.createMediaStreamSource(stream);
        this.gainNode = this.audioContext.createGain();
        this.gainNode.gain.value = 1;
        this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);
        this.sourceNode.connect(this.gainNode);
        this.gainNode.connect(this.processorNode);
        this.worker.onmessage = this.onWorkerMessage;
    }

    start(): void {
        if (this.state !== 'inactive') {
            throw this.getStateError('start');
        }
        this.processorNode.onaudioprocess = (event) => {
            this.post({ type: 'DATA_AVAILABLE', data: event.inputBuffer.getChannelData(0) });
        };
        this.processorNode.connect(this.audioContext.destination);
        if (this.audioContext.state === 'closed') {
            this.audioContext = new AudioContext();
        } else if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
        this.post({ type: 'START_RECORDING', config: { sampleRate: this.audioContext.sampleRate } });
    }

    stop(): void {
        if (this.state === 'inactive') {
            throw this.getStateError('stop');
        }
        this.processorNode.disconnect();
        if (this.isInternalAudioContext) {
            this.audioContext.close();
        }
        this.post({ type: 'STOP_RECORDING' });
    }

    pause(): void {
        if (this.state === 'inactive') {
            throw this.getStateError('pause');
        }
        this.audioContext.suspend().then(() => {
            this.state = 'paused';
            this.dispatchEvent(new Event('pause'));
        });
    }

    resume(): void {
        if (this.state === 'inactive') {
            throw this.getStateError('resume');
        }
        this.audioContext.resume().then(() => {
            this.state = 'recording';
            this.dispatchEvent(new Event('resume'));
        });
    }

    requestData(): void {
        // not implemented, dataavailable event only fires when encoding is finished
    }

    private getStateError(method: string) {
        return new Error(
            `Failed to execute '${method}' on 'MediaRecorder': The MediaRecorder's state is '${this.state}'.`,
        );
    }

    private post(message: RecorderMessage) {
        this.worker.postMessage(message);
    }

    private onWorkerMessage = (event: MessageEvent<WorkerMessage>): void => {
        const message = event.data;

        switch (message.type) {
            case 'WORKER_RECORDING': {
                const event = new Event('start');
                this.dispatchEvent(event);
                this.state = 'recording';
                break;
            }
            case 'ERROR': {
                const error = new Error(message.error) as DOMException;
                const errEvent = new Event('error');
                (errEvent as any).error = error;
                this.dispatchEvent(errEvent);
                this.state = 'inactive';
                break;
            }
            case 'BLOB_READY': {
                const stopEvent = new Event('stop');
                const dataEvent = new BlobEvent('dataavailable', { data: message.blob, timecode: Date.now() });
                this.dispatchEvent(dataEvent);
                this.dispatchEvent(stopEvent);
                this.state = 'inactive';
                break;
            }
        }
    };
}

const EVENT_TYPES = ['start', 'stop', 'pause', 'resume', 'dataavailable', 'error'] as const;

EVENT_TYPES.forEach((type) => {
    const handlers = new WeakMap<Mp3MediaRecorder, EventListener | null>();
    Object.defineProperty(Mp3MediaRecorder.prototype, `on${type}`, {
        get(this: Mp3MediaRecorder) {
            return handlers.get(this) ?? null;
        },
        set(this: Mp3MediaRecorder, handler: EventListener | null) {
            const previous = handlers.get(this);
            if (previous) this.removeEventListener(type, previous);
            if (handler) this.addEventListener(type, handler);
            handlers.set(this, handler);
        },
    });
});

declare module './index' {
    interface Mp3MediaRecorder extends Pick<
        MediaRecorder,
        'onstart' | 'onstop' | 'onpause' | 'onresume' | 'ondataavailable' | 'onerror'
    > {}
}
