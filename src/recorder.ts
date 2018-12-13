import { MP3_MIME_TYPE } from './constants';
import { ShimBlobEvent, ShimMediaRecorderErrorEvent } from './shims';
import {
    InitMessage,
    PostMessageType,
    StartRecordingMessage,
    StopRecordingMessage,
    WorkerPostMessage
} from './types/post-message.type';
import { mp3EncoderWorker } from './worker';

export const record = () => true;

const BlobEvent = window.BlobEvent || ShimBlobEvent;
const MediaRecorderErrorEvent = window.MediaRecorderErrorEvent || ShimMediaRecorderErrorEvent;
const AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
const createGain = (ctx: AudioContext) => (ctx.createGain || (ctx as any).createGainNode).call(ctx);
const createScriptProcessor = (ctx: AudioContext) =>
    (ctx.createScriptProcessor || (ctx as any).createJavaScriptNode).call(ctx, 0, 1, 1);

export class Mp3MediaRecorder extends EventTarget implements MediaRecorder {
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
    private workerURL: string;

    static isTypeSupported = (mimeType: string) => mimeType === MP3_MIME_TYPE;

    constructor(stream: MediaStream) {
        super();
        this.stream = stream;
        this.audioContext = new AudioContext();
        this.sourceNode = this.audioContext.createMediaStreamSource(stream);
        this.gainNode = createGain(this.audioContext);
        this.gainNode.gain.value = 1;
        this.processorNode = createScriptProcessor(this.audioContext);
        this.sourceNode.connect(this.gainNode);
        this.gainNode.connect(this.processorNode);

        const workerBlob = new Blob([`(${mp3EncoderWorker.toString()})()`], { type: 'application/javascript' });
        this.workerURL = URL.createObjectURL(workerBlob);
        this.worker = new Worker(this.workerURL);
        this.worker.postMessage(new InitMessage());
        this.worker.onmessage = this.onWorkerMessage;
    }

    start(): void {
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

        this.worker.postMessage(new StartRecordingMessage({ config: { sampleRate: this.audioContext.sampleRate } }));
    }

    stop(): void {
        this.worker.postMessage(new StopRecordingMessage());
    }

    pause(): void {
        this.state = 'paused';
    }

    resume(): void {
        this.state = 'recording';
    }

    requestData(): void {
        // not implemented, dataavailable event only fires when encoding is finished
    }

    onerror: (event: MediaRecorderErrorEvent) => void = () => {};
    onpause: EventListener = () => {};
    onresume: EventListener = () => {};
    onstart: EventListener = () => {};
    onstop: EventListener = () => {};
    ondataavailable: (event: BlobEvent) => void = () => {};

    private onWorkerMessage = (event: MessageEvent): void => {
        const message: WorkerPostMessage = event.data;

        switch (message.type) {
            case PostMessageType.START_RECORDING: {
                const event = new Event('start');
                this.onstart(event);
                this.dispatchEvent(event);
                this.state = 'recording';
                break;
            }
            case PostMessageType.STOP_RECORDING: {
                const event = new Event('stop');
                this.onstop(event);
                this.dispatchEvent(event);
                this.state = 'inactive';
                break;
            }
            case PostMessageType.ERROR: {
                const event = new MediaRecorderErrorEvent('error', {
                    error: new DOMException(message.payload.error)
                });
                this.onerror(event);
                this.dispatchEvent(event);
                this.state = 'inactive';
                break;
            }
            case PostMessageType.BLOB_READY: {
                const event = new BlobEvent('dataavailable', {
                    data: message.payload.blob,
                    timecode: Date.now()
                });
                this.ondataavailable(event);
                this.dispatchEvent(event);
                this.state = 'inactive';
                break;
            }
        }
    };
}
