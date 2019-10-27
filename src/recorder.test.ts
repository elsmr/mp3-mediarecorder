import { getMp3MediaRecorder } from './recorder';
import { Mp3MediaRecorderOptions } from './types/config.type';
import { blobReadyMessage, workerRecordingMessage } from './types/post-message.type';

declare class Mp3MediaRecorder extends MediaRecorder {
    constructor(stream: MediaStream, options: Mp3MediaRecorderOptions);
}

describe('mp3-mediarecorder', () => {
    let workerPostMessageListeners: Record<string, Function[]>;
    let workerPostMessage;
    let worker: any;
    let audioContext: AudioContext;
    let mediaStream: MediaStream;
    let sourceNode: AudioNode;
    let gainNode: GainNode;
    let processorNode: ScriptProcessorNode;

    beforeEach(() => {
        workerPostMessageListeners = {};
        mediaStream = {} as any;
        sourceNode = { connect: jest.fn() } as any;
        gainNode = {
            connect: jest.fn(),
            gain: { value: 0 }
        } as any;
        processorNode = {
            connect: jest.fn(),
            disconnect: jest.fn(),
            onaudioprocess: jest.fn()
        } as any;
        workerPostMessage = jest.fn();
        audioContext = {
            resume: jest.fn(),
            close: jest.fn(),
            suspend: jest.fn(),
            createMediaStreamSource: jest.fn(() => sourceNode),
            createGain: jest.fn(() => gainNode),
            createScriptProcessor: jest.fn(() => processorNode)
        } as any;
        worker = {
            postMessage: workerPostMessage,
            terminate: jest.fn(),
            onmessage: jest.fn(),
            onerror: jest.fn(),
            addEventListener: jest.fn((event, listener) => {
                if (workerPostMessageListeners[event]) {
                    workerPostMessageListeners[event].push(listener as Function);
                } else {
                    workerPostMessageListeners[event] = [listener] as [Function];
                }
            }),
            removeEventListener: jest.fn((event, listener) => {
                const index = workerPostMessageListeners[event].findIndex(l => l === listener);
                if (index > -1) {
                    workerPostMessageListeners[event].splice(index);
                }
            }),
            dispatchEvent: jest.fn((event: Event) => {
                try {
                    workerPostMessageListeners[event.type].forEach(l => l(event));
                    return true;
                } catch (e) {
                    return false;
                }
            })
        };

        window.Worker = jest.fn(() => worker);
        window.MediaStream = jest.fn(() => mediaStream);

        window.URL = class extends URL {
            static createObjectURL = jest.fn();
            static revokeObjectURL = jest.fn();
        };
    });

    async function instantiateRecorder(): Promise<Mp3MediaRecorder> {
        const Mp3MediaRecorderPromise = getMp3MediaRecorder({ wasmURL: 'mockUrl' });
        worker.onmessage({ data: { type: 'WORKER_READY' } });
        const RecorderClass = await Mp3MediaRecorderPromise;
        return new RecorderClass(new MediaStream(), { audioContext });
    }

    describe('export typing', () => {
        it('should have an export called getMp3MediaRecorder', () => {
            expect(getMp3MediaRecorder).toBeDefined();
        });

        it('getMp3MediaRecorder should return a Promise with a MediaRecorder', async () => {
            const recorderPromise = getMp3MediaRecorder({ wasmURL: 'mockUrl' });
            worker.onmessage({ data: { type: 'WORKER_READY' } });
            expect(recorderPromise).toBeInstanceOf(Promise);
            const RecorderClass = await recorderPromise;
            const recorder = new RecorderClass(mediaStream, { audioContext });
            expect(recorder.start).toBeInstanceOf(Function);
            expect(recorder.stop).toBeInstanceOf(Function);
            expect(recorder.pause).toBeInstanceOf(Function);
            expect(recorder.resume).toBeInstanceOf(Function);
        });
    });

    describe('start', () => {
        it('should set the recorder state to "recording" when worker starts recording', async () => {
            const recorder = await instantiateRecorder();
            recorder.start();
            expect(recorder.state).toBe('inactive');
            worker.onmessage({ data: workerRecordingMessage() });
            expect(recorder.state).toBe('recording');
        });

        it('should emit a start event', async done => {
            const recorder = await instantiateRecorder();
            recorder.addEventListener('start', event => {
                expect(event.type).toEqual('start');
                done();
            });

            recorder.start();
            worker.onmessage({ data: workerRecordingMessage() });
        });

        it('should throw when start is called while recording', async () => {
            const recorder = await instantiateRecorder();
            worker.onmessage({ data: workerRecordingMessage() });
            expect(() => recorder.start()).toThrowError(
                new Error(
                    "Uncaught DOMException: Failed to execute 'start' on 'MediaRecorder': The MediaRecorder's state is 'recording'."
                )
            );
        });
    });

    describe('pause', () => {
        let recorder: Mp3MediaRecorder;
        beforeEach(async () => {
            recorder = await instantiateRecorder();
            recorder.start();
            worker.onmessage({ data: workerRecordingMessage() });
        });

        it('should set the recorder state to "paused"', async () => {
            recorder.pause();
            expect(recorder.state).toBe('paused');
        });

        it('should emit a pause event', async done => {
            recorder.addEventListener('pause', event => {
                expect(event.type).toEqual('pause');
                done();
            });
            recorder.pause();
        });

        it('should throw when pause is called before recording', async () => {
            const recorder = await instantiateRecorder();
            expect(() => recorder.pause()).toThrowError(
                new Error(
                    "Uncaught DOMException: Failed to execute 'pause' on 'MediaRecorder': The MediaRecorder's state is 'inactive'."
                )
            );
        });
    });

    describe('resume', () => {
        let recorder: Mp3MediaRecorder;

        beforeEach(async () => {
            recorder = await instantiateRecorder();
            recorder.start();
            worker.onmessage({ data: workerRecordingMessage() });
            recorder.pause();
        });

        it('should set the recorder state to "recording"', async () => {
            expect(recorder.state).toBe('paused');
            recorder.resume();
            expect(recorder.state).toBe('recording');
        });

        it('should emit a resume event', async done => {
            recorder.addEventListener('resume', event => {
                expect(event.type).toEqual('resume');
                done();
            });
            recorder.resume();
        });

        it('should throw when resume is called before recording', async () => {
            const recorder = await instantiateRecorder();
            expect(() => recorder.resume()).toThrowError(
                new Error(
                    "Uncaught DOMException: Failed to execute 'resume' on 'MediaRecorder': The MediaRecorder's state is 'inactive'."
                )
            );
        });
    });

    describe('stop', () => {
        let recorder: Mp3MediaRecorder;

        beforeEach(async () => {
            recorder = await instantiateRecorder();
            recorder.start();
            worker.onmessage({ data: workerRecordingMessage() });
        });

        it('should set the recorder state to "inactive" when worker stops recording', async () => {
            expect(recorder.state).toBe('recording');
            recorder.stop();
            worker.onmessage({ data: blobReadyMessage(new Blob([])) });
            expect(recorder.state).toBe('inactive');
        });

        it('should suspend audio context and clean up audio nodes', async () => {
            recorder.stop();
            expect(audioContext.suspend).toHaveBeenCalled();
            expect(processorNode.disconnect).toHaveBeenCalled();
        });

        it('should emit a stop event', async done => {
            recorder.addEventListener('stop', event => {
                expect(event.type).toEqual('stop');
                done();
            });
            recorder.stop();
            worker.onmessage({ data: blobReadyMessage(new Blob([])) });
        });

        it('should throw when stop is called before starting a recording', async () => {
            const recorder = await instantiateRecorder();
            expect(() => recorder.stop()).toThrowError(
                new Error(
                    "Uncaught DOMException: Failed to execute 'stop' on 'MediaRecorder': The MediaRecorder's state is 'inactive'."
                )
            );
        });
    });

    describe('recorded data', () => {
        let recorder: Mp3MediaRecorder;
        let recording: Blob;

        beforeEach(async () => {
            recording = new Blob([]);
            recorder = await instantiateRecorder();
        });

        it('should emit a dataavailable event when the worker has recorded', async done => {
            recorder.ondataavailable = event => {
                const { data, type } = event;
                expect(type).toEqual('dataavailable');
                expect(data).toEqual(recording);
                done();
            };

            worker.onmessage({ data: blobReadyMessage(recording) });
        });
    });
});
