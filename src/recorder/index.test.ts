import { blobReadyMessage, workerRecordingMessage } from '../types/post-message.type';
import { Mp3MediaRecorder } from './index';

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
            gain: { value: 0 },
        } as any;
        processorNode = {
            connect: jest.fn(),
            disconnect: jest.fn(),
            onaudioprocess: jest.fn(),
        } as any;
        workerPostMessage = jest.fn();
        audioContext = new AudioContext();
        (audioContext as any)._setMockNodes({ gainNode, processorNode, sourceNode });
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
                const index = workerPostMessageListeners[event].findIndex((l) => l === listener);
                if (index > -1) {
                    workerPostMessageListeners[event].splice(index);
                }
            }),
            dispatchEvent: jest.fn((event: Event) => {
                try {
                    workerPostMessageListeners[event.type].forEach((l) => l(event));
                    return true;
                } catch (e) {
                    return false;
                }
            }),
        };
        window.Worker = jest.fn(() => worker);
        Object.setPrototypeOf(worker, window.Worker);
        window.MediaStream = jest.fn(() => mediaStream);
    });

    function instantiateRecorder(): Mp3MediaRecorder {
        return new Mp3MediaRecorder(new MediaStream(), { audioContext, worker });
    }

    describe('export typing', () => {
        it('should have an export called Mp3MediaRecorder', () => {
            expect(Mp3MediaRecorder).toBeDefined();
            const recorder = instantiateRecorder();
            expect(recorder.start).toBeInstanceOf(Function);
            expect(recorder.stop).toBeInstanceOf(Function);
            expect(recorder.pause).toBeInstanceOf(Function);
            expect(recorder.resume).toBeInstanceOf(Function);
        });
    });

    describe('start', () => {
        it('should set the recorder state to "recording" when worker starts recording', async () => {
            const recorder = instantiateRecorder();
            recorder.start();
            expect(recorder.state).toBe('inactive');
            worker.onmessage({ data: workerRecordingMessage() });
            expect(recorder.state).toBe('recording');
        });

        it('should emit a start event', (done) => {
            const recorder = instantiateRecorder();
            recorder.addEventListener('start', (event) => {
                expect(event.type).toEqual('start');
                done();
            });

            recorder.start();
            worker.onmessage({ data: workerRecordingMessage() });
        });

        it('should throw when start is called while recording', async () => {
            const recorder = instantiateRecorder();
            worker.onmessage({ data: workerRecordingMessage() });
            expect(() => recorder.start()).toThrowError(
                new Error("Failed to execute 'start' on 'MediaRecorder': The MediaRecorder's state is 'recording'."),
            );
        });
    });

    describe('pause', () => {
        let recorder: Mp3MediaRecorder;
        beforeEach(async () => {
            recorder = instantiateRecorder();
            recorder.start();
            worker.onmessage({ data: workerRecordingMessage() });
        });

        it('should set the recorder state to "paused"', (done) => {
            recorder.addEventListener('pause', () => {
                expect(recorder.state).toBe('paused');
                done();
            });
            recorder.pause();
        });

        it('should emit a pause event', (done) => {
            recorder.addEventListener('pause', (event) => {
                expect(event.type).toEqual('pause');
                done();
            });
            recorder.pause();
        });

        it('should throw when pause is called before recording', async () => {
            const recorder = instantiateRecorder();
            expect(() => recorder.pause()).toThrowError(
                new Error("Failed to execute 'pause' on 'MediaRecorder': The MediaRecorder's state is 'inactive'."),
            );
        });
    });

    describe('resume', () => {
        let recorder: Mp3MediaRecorder;

        beforeEach(async () => {
            recorder = instantiateRecorder();
            recorder.start();
            worker.onmessage({ data: workerRecordingMessage() });
            recorder.pause();
        });

        it('should set the recorder state to "recording"', (done) => {
            expect(recorder.state).toBe('paused');
            recorder.addEventListener('resume', () => {
                expect(recorder.state).toBe('recording');
                done();
            });
            recorder.resume();
        });

        it('should emit a resume event', (done) => {
            recorder.addEventListener('resume', (event) => {
                expect(event.type).toEqual('resume');
                done();
            });
            recorder.resume();
        });

        it('should throw when resume is called before recording', async () => {
            const recorder = instantiateRecorder();
            expect(() => recorder.resume()).toThrowError(
                new Error("Failed to execute 'resume' on 'MediaRecorder': The MediaRecorder's state is 'inactive'."),
            );
        });
    });

    describe('stop', () => {
        let recorder: Mp3MediaRecorder;

        beforeEach(async () => {
            recorder = instantiateRecorder();
            recorder.start();
            worker.onmessage({ data: workerRecordingMessage() });
        });

        it('should set the recorder state to "inactive" when worker stops recording', async () => {
            expect(recorder.state).toBe('recording');
            recorder.stop();
            worker.onmessage({ data: blobReadyMessage(new Blob([])) });
            expect(recorder.state).toBe('inactive');
        });

        describe('when the AudioContext is passed in by the library user', () => {
            it('should NOT close audio context and clean up audio nodes', async () => {
                recorder.stop();
                expect(audioContext.close).not.toHaveBeenCalled();
                expect(processorNode.disconnect).toHaveBeenCalled();
            });
        });

        describe('when the AudioContext is generated by the recorder', () => {
            it('should close audio context and clean up audio nodes', async () => {
                recorder = new Mp3MediaRecorder(new MediaStream(), { worker });
                recorder.start();
                worker.onmessage({ data: workerRecordingMessage() });
                recorder.stop();
                expect(recorder['audioContext'].close).toHaveBeenCalled();
            });
        });

        it('should emit a stop event', (done) => {
            recorder.addEventListener('stop', (event) => {
                expect(event.type).toEqual('stop');
                done();
            });
            recorder.stop();
            worker.onmessage({ data: blobReadyMessage(new Blob([])) });
        });

        it('should throw when stop is called before starting a recording', async () => {
            const recorder = instantiateRecorder();
            expect(() => recorder.stop()).toThrowError(
                new Error("Failed to execute 'stop' on 'MediaRecorder': The MediaRecorder's state is 'inactive'."),
            );
        });
    });

    describe('recorded data', () => {
        let recorder: Mp3MediaRecorder;
        let recording: Blob;

        beforeEach(() => {
            recording = new Blob([]);
            recorder = instantiateRecorder();
        });

        it('should emit a dataavailable event when the worker has recorded', (done) => {
            recorder.ondataavailable = (event) => {
                const { data, type } = event;
                expect(type).toEqual('dataavailable');
                expect(data).toEqual(recording);
                done();
            };

            worker.onmessage({ data: blobReadyMessage(recording) });
        });
    });
});
