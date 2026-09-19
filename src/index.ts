import type { RecorderMessage, WorkerMessage } from './messages';
import { WORKLET_PROCESSOR_NAME, workletSource } from './worklet';

export interface Mp3MediaRecorderOptions extends MediaRecorderOptions {
    worker: Worker;
    audioContext?: AudioContext;
}

const MP3_MIME_TYPE = 'audio/mpeg';

// One URL for the lifetime of the page: addModule() is idempotent per AudioContext for the same URL,
// while a fresh Blob URL per start() would re-register the processor name and throw.
const workletModuleUrl = URL.createObjectURL(new Blob([workletSource], { type: 'text/javascript' }));

export class Mp3MediaRecorder extends EventTarget {
    stream: MediaStream;
    mimeType = MP3_MIME_TYPE;
    state: RecordingState = 'inactive';
    audioBitsPerSecond = 0;
    videoBitsPerSecond = 0;

    private audioContext: AudioContext;
    private sourceNode: MediaStreamAudioSourceNode | null = null;
    private captureNode: AudioWorkletNode | null = null;
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
        this.worker.onmessage = this.onWorkerMessage;
    }

    start(): void {
        if (this.state !== 'inactive') {
            throw this.getStateError('start');
        }
        this.startCapture().catch((error: unknown) => this.fail(error));
    }

    stop(): void {
        if (this.state === 'inactive') {
            throw this.getStateError('stop');
        }
        // Ask the worklet for its partial chunk; STOP_RECORDING is sent once the `null` end marker arrives.
        this.captureNode?.port.postMessage('flush');
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

    private post(message: RecorderMessage, transfer: Transferable[] = []) {
        this.worker.postMessage(message, transfer);
    }

    private async startCapture(): Promise<void> {
        if (this.audioContext.state === 'closed') {
            if (!this.isInternalAudioContext) {
                throw new Error('The provided AudioContext is closed.');
            }
            this.audioContext = new AudioContext();
        }
        await this.audioContext.audioWorklet.addModule(workletModuleUrl);
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
        this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
        this.captureNode = new AudioWorkletNode(this.audioContext, WORKLET_PROCESSOR_NAME, {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            channelCount: 1,
            channelCountMode: 'explicit',
        });
        this.captureNode.port.onmessage = ({ data }: MessageEvent<Float32Array | null>) => {
            if (data === null) {
                this.teardown();
                this.post({ type: 'STOP_RECORDING' });
            } else if (data.length > 0) {
                this.post({ type: 'DATA_AVAILABLE', data }, [data.buffer]);
            }
        };
        this.sourceNode.connect(this.captureNode);
        // A worklet node is only rendered while it reaches the destination; its output stays silent.
        this.captureNode.connect(this.audioContext.destination);
        this.post({ type: 'START_RECORDING', config: { sampleRate: this.audioContext.sampleRate } });
    }

    private teardown(): void {
        this.sourceNode?.disconnect();
        this.captureNode?.disconnect();
        if (this.captureNode) this.captureNode.port.onmessage = null;
        this.sourceNode = null;
        this.captureNode = null;
        if (this.isInternalAudioContext) {
            this.audioContext.close();
        }
    }

    private fail(error: unknown): void {
        this.teardown();
        this.state = 'inactive';
        const errEvent = new Event('error');
        (errEvent as any).error = error instanceof Error ? error : new Error(String(error));
        this.dispatchEvent(errEvent);
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
                this.fail(new Error(message.error));
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
