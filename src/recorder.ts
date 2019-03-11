import { defineEventAttribute, EventTarget } from 'event-target-shim';
import {
    dataAvailableMessage,
    initMessage,
    PostMessageType,
    startRecordingMessage,
    stopRecordingMessage,
    WorkerPostMessage
} from './types/post-message.type';
import { RecorderConfig } from './types/recorder-config.type';
import { mp3EncoderWorker } from './worker';

const MP3_MIME_TYPE = 'audio/mpeg';
const AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
const createGain = (ctx: AudioContext) => (ctx.createGain || (ctx as any).createGainNode).call(ctx);
const createScriptProcessor = (ctx: AudioContext) =>
    (ctx.createScriptProcessor || (ctx as any).createJavaScriptNode).call(ctx, 4096, 1, 1);

export const getMp3MediaRecorder = (config: RecorderConfig): Promise<typeof MediaRecorder> => {
    const workerBlob = new Blob([`(${mp3EncoderWorker.toString()})()`], {
        type: 'application/javascript'
    });
    const worker = new Worker(URL.createObjectURL(workerBlob));

    class Mp3MediaRecorder extends EventTarget {
        stream: MediaStream;
        mimeType = MP3_MIME_TYPE;
        state: RecordingState = 'inactive';
        audioBitsPerSecond = 0;
        videoBitsPerSecond = 0;

        private audioContext: AudioContext;
        private sourceNode: MediaStreamAudioSourceNode;
        private gainNode: GainNode;
        private processorNode: ScriptProcessorNode;

        static isTypeSupported = (mimeType: string) => mimeType === MP3_MIME_TYPE;

        constructor(stream: MediaStream) {
            super();
            this.stream = stream;
            this.audioContext = new AudioContext();
            this.audioContext.suspend();
            this.sourceNode = this.audioContext.createMediaStreamSource(stream);
            this.gainNode = createGain(this.audioContext);
            this.gainNode.gain.value = 1;
            this.processorNode = createScriptProcessor(this.audioContext);
            this.sourceNode.connect(this.gainNode);
            this.gainNode.connect(this.processorNode);
            worker.onmessage = this.onWorkerMessage;
        }

        start(): void {
            this.processorNode.onaudioprocess = event => {
                worker.postMessage(dataAvailableMessage(event.inputBuffer.getChannelData(0)));
            };
            this.processorNode.connect(this.audioContext.destination);
            this.audioContext.resume();
            worker.postMessage(startRecordingMessage({ sampleRate: this.audioContext.sampleRate }));
        }

        stop(): void {
            this.processorNode.disconnect();
            this.audioContext.suspend();
            worker.postMessage(stopRecordingMessage());
        }

        pause(): void {
            this.audioContext.suspend();
            this.state = 'paused';
            this.dispatchEvent(new Event('pause'));
        }

        resume(): void {
            this.audioContext.resume();
            this.state = 'recording';
            this.dispatchEvent(new Event('resume'));
        }

        requestData(): void {
            // not implemented, dataavailable event only fires when encoding is finished
        }

        private onWorkerMessage = (event: MessageEvent): void => {
            const message: WorkerPostMessage = event.data;

            switch (message.type) {
                case PostMessageType.WORKER_RECORDING: {
                    const event = new Event('start');
                    this.dispatchEvent(event);
                    this.state = 'recording';
                    break;
                }
                case PostMessageType.ERROR: {
                    const error = new DOMException(message.error);
                    const fallbackEvent = new Event('error');
                    (fallbackEvent as any).error = error;
                    const event = window.MediaRecorderErrorEvent
                        ? new MediaRecorderErrorEvent('error', { error })
                        : fallbackEvent;
                    this.dispatchEvent(event);
                    this.state = 'inactive';
                    break;
                }
                case PostMessageType.BLOB_READY: {
                    const stopEvent = new Event('stop');
                    const fallbackDataEvent = new Event('dataavailable');
                    (fallbackDataEvent as any).data = message.blob;
                    (fallbackDataEvent as any).timecode = Date.now();
                    const dataEvent = window.BlobEvent
                        ? new BlobEvent('dataavailable', {
                              data: message.blob,
                              timecode: Date.now()
                          })
                        : fallbackDataEvent;
                    this.dispatchEvent(dataEvent);
                    this.dispatchEvent(stopEvent);
                    this.state = 'inactive';
                    break;
                }
            }
        };
    }

    defineEventAttribute(Mp3MediaRecorder.prototype, 'start');
    defineEventAttribute(Mp3MediaRecorder.prototype, 'stop');
    defineEventAttribute(Mp3MediaRecorder.prototype, 'pause');
    defineEventAttribute(Mp3MediaRecorder.prototype, 'resume');
    defineEventAttribute(Mp3MediaRecorder.prototype, 'dataavailable');
    defineEventAttribute(Mp3MediaRecorder.prototype, 'error');

    return new Promise((resolve, reject) => {
        const wasmURL = new URL(config.wasmURL, window.location.origin).href;
        worker.postMessage(initMessage(wasmURL));
        worker.onmessage = ({ data }: { data: WorkerPostMessage }) => {
            if (data.type === PostMessageType.WORKER_READY) {
                resolve(Mp3MediaRecorder as any);
            } else {
                const errorMessage = data.type === PostMessageType.ERROR ? data.error : 'Unknown error occurred ';
                reject(errorMessage);
            }
        };
    });
};
