import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Mp3MediaRecorder } from './index';

const nextEvent = (target: Mp3MediaRecorder, type: string) =>
    new Promise<Event>((resolve) => target.addEventListener(type, resolve as never));

describe('mp3-mediarecorder', () => {
    let worker: Worker;
    let audioContext: AudioContext;

    beforeEach(() => {
        audioContext = new AudioContext();
        worker = { postMessage: mock(), onmessage: null } as never;
    });

    const instantiateRecorder = () => new Mp3MediaRecorder(new MediaStream(), { audioContext, worker });
    const startRecording = (recorder: Mp3MediaRecorder) => {
        recorder.start();
        worker.onmessage!({ data: { type: 'WORKER_RECORDING' } } as MessageEvent);
    };

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
        it('should set the recorder state to "recording" when worker starts recording', () => {
            const recorder = instantiateRecorder();
            recorder.start();
            expect(recorder.state).toBe('inactive');
            worker.onmessage!({ data: { type: 'WORKER_RECORDING' } } as MessageEvent);
            expect(recorder.state).toBe('recording');
        });

        it('should emit a start event', async () => {
            const recorder = instantiateRecorder();
            const started = nextEvent(recorder, 'start');
            startRecording(recorder);
            expect((await started).type).toEqual('start');
        });

        it('should throw when start is called while recording', () => {
            const recorder = instantiateRecorder();
            worker.onmessage!({ data: { type: 'WORKER_RECORDING' } } as MessageEvent);
            expect(() => recorder.start()).toThrowError(
                "Failed to execute 'start' on 'MediaRecorder': The MediaRecorder's state is 'recording'.",
            );
        });
    });

    describe('pause', () => {
        let recorder: Mp3MediaRecorder;
        beforeEach(() => {
            recorder = instantiateRecorder();
            startRecording(recorder);
        });

        it('should set the recorder state to "paused"', async () => {
            const paused = nextEvent(recorder, 'pause');
            recorder.pause();
            await paused;
            expect(recorder.state).toBe('paused');
        });

        it('should emit a pause event', async () => {
            const paused = nextEvent(recorder, 'pause');
            recorder.pause();
            expect((await paused).type).toEqual('pause');
        });

        it('should throw when pause is called before recording', () => {
            const recorder = instantiateRecorder();
            expect(() => recorder.pause()).toThrowError(
                "Failed to execute 'pause' on 'MediaRecorder': The MediaRecorder's state is 'inactive'.",
            );
        });
    });

    describe('resume', () => {
        let recorder: Mp3MediaRecorder;

        beforeEach(async () => {
            recorder = instantiateRecorder();
            startRecording(recorder);
            const paused = nextEvent(recorder, 'pause');
            recorder.pause();
            await paused;
        });

        it('should set the recorder state to "recording"', async () => {
            expect(recorder.state).toBe('paused');
            const resumed = nextEvent(recorder, 'resume');
            recorder.resume();
            await resumed;
            expect(recorder.state).toBe('recording');
        });

        it('should emit a resume event', async () => {
            const resumed = nextEvent(recorder, 'resume');
            recorder.resume();
            expect((await resumed).type).toEqual('resume');
        });

        it('should throw when resume is called before recording', () => {
            const recorder = instantiateRecorder();
            expect(() => recorder.resume()).toThrowError(
                "Failed to execute 'resume' on 'MediaRecorder': The MediaRecorder's state is 'inactive'.",
            );
        });
    });

    describe('stop', () => {
        let recorder: Mp3MediaRecorder;

        beforeEach(() => {
            recorder = instantiateRecorder();
            startRecording(recorder);
        });

        it('should set the recorder state to "inactive" when worker stops recording', () => {
            expect(recorder.state).toBe('recording');
            recorder.stop();
            worker.onmessage!({ data: { type: 'BLOB_READY', blob: new Blob([]) } } as MessageEvent);
            expect(recorder.state).toBe('inactive');
        });

        it('should NOT close a user-provided audio context, but clean up audio nodes', () => {
            recorder.stop();
            expect(audioContext.close).not.toHaveBeenCalled();
            expect(recorder['processorNode'].disconnect).toHaveBeenCalled();
        });

        it('should close an internally created audio context', () => {
            recorder = new Mp3MediaRecorder(new MediaStream(), { worker });
            startRecording(recorder);
            recorder.stop();
            expect(recorder['audioContext'].close).toHaveBeenCalled();
        });

        it('should emit a stop event', async () => {
            const stopped = nextEvent(recorder, 'stop');
            recorder.stop();
            worker.onmessage!({ data: { type: 'BLOB_READY', blob: new Blob([]) } } as MessageEvent);
            expect((await stopped).type).toEqual('stop');
        });

        it('should throw when stop is called before starting a recording', () => {
            const recorder = instantiateRecorder();
            expect(() => recorder.stop()).toThrowError(
                "Failed to execute 'stop' on 'MediaRecorder': The MediaRecorder's state is 'inactive'.",
            );
        });
    });

    describe('recorded data', () => {
        it('should emit a dataavailable event when the worker has recorded', async () => {
            const recording = new Blob([]);
            const recorder = instantiateRecorder();
            const dataAvailable = new Promise<BlobEvent>((resolve) => {
                recorder.ondataavailable = resolve;
            });
            worker.onmessage!({ data: { type: 'BLOB_READY', blob: recording } } as MessageEvent);
            const { data, type } = await dataAvailable;
            expect(type).toEqual('dataavailable');
            expect(data).toEqual(recording);
        });
    });
});
