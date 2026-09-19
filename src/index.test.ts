import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Mp3MediaRecorder } from './index';

const nextEvent = (target: Mp3MediaRecorder, type: string) =>
    new Promise<Event>((resolve) => target.addEventListener(type, resolve as never));

const tick = () => new Promise((resolve) => setTimeout(resolve));

describe('mp3-mediarecorder', () => {
    let worker: Worker & { postMessage: ReturnType<typeof mock> };
    let audioContext: AudioContext;

    beforeEach(() => {
        audioContext = new AudioContext();
        worker = { postMessage: mock(), onmessage: null } as never;
    });

    const instantiateRecorder = () => new Mp3MediaRecorder(new MediaStream(), { audioContext, worker });
    const fromWorker = (data: unknown) => worker.onmessage!({ data } as MessageEvent);
    const captureNode = (recorder: Mp3MediaRecorder) => recorder['captureNode']!;
    const fromWorklet = (recorder: Mp3MediaRecorder, data: Float32Array | null) =>
        captureNode(recorder).port.onmessage!({ data } as MessageEvent);
    const startRecording = async (recorder: Mp3MediaRecorder) => {
        recorder.start();
        await tick();
        fromWorker({ type: 'WORKER_RECORDING' });
    };

    describe('start', () => {
        it('loads the worklet and tells the worker to start with the context sample rate', async () => {
            const recorder = instantiateRecorder();
            recorder.start();
            await tick();
            expect(audioContext.audioWorklet.addModule).toHaveBeenCalledWith(expect.stringMatching(/^blob:/));
            expect(captureNode(recorder).connect).toHaveBeenCalledWith(audioContext.destination);
            expect(worker.postMessage).toHaveBeenCalledWith(
                { type: 'START_RECORDING', config: { sampleRate: 44100 } },
                [],
            );
        });

        it('becomes "recording" and emits start once the worker confirms', async () => {
            const recorder = instantiateRecorder();
            const started = nextEvent(recorder, 'start');
            recorder.start();
            expect(recorder.state).toBe('inactive');
            await tick();
            fromWorker({ type: 'WORKER_RECORDING' });
            expect(recorder.state).toBe('recording');
            expect((await started).type).toBe('start');
        });

        it('throws when already recording', async () => {
            const recorder = instantiateRecorder();
            await startRecording(recorder);
            expect(() => recorder.start()).toThrowError(
                "Failed to execute 'start' on 'MediaRecorder': The MediaRecorder's state is 'recording'.",
            );
        });

        it('emits an error event when the worklet fails to load', async () => {
            audioContext.audioWorklet.addModule = mock(() => Promise.reject(new Error('nope')));
            const recorder = instantiateRecorder();
            const failed = nextEvent(recorder, 'error');
            recorder.start();
            expect(((await failed) as ErrorEvent).error.message).toBe('nope');
            expect(recorder.state).toBe('inactive');
        });

        it('refuses a closed user-provided AudioContext', async () => {
            (audioContext as any).state = 'closed';
            const recorder = instantiateRecorder();
            const failed = nextEvent(recorder, 'error');
            recorder.start();
            expect(((await failed) as ErrorEvent).error.message).toBe('The provided AudioContext is closed.');
        });
    });

    describe('audio data', () => {
        it('forwards worklet chunks to the worker, transferring the buffer', async () => {
            const recorder = instantiateRecorder();
            await startRecording(recorder);
            const data = new Float32Array([0.1, 0.2]);
            fromWorklet(recorder, data);
            expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'DATA_AVAILABLE', data }, [data.buffer]);
        });

        it('drops empty chunks', async () => {
            const recorder = instantiateRecorder();
            await startRecording(recorder);
            const calls = worker.postMessage.mock.calls.length;
            fromWorklet(recorder, new Float32Array(0));
            expect(worker.postMessage.mock.calls.length).toBe(calls);
        });
    });

    describe('pause / resume', () => {
        let recorder: Mp3MediaRecorder;
        beforeEach(async () => {
            recorder = instantiateRecorder();
            await startRecording(recorder);
        });

        it('suspends the context and emits pause', async () => {
            const paused = nextEvent(recorder, 'pause');
            recorder.pause();
            expect((await paused).type).toBe('pause');
            expect(recorder.state).toBe('paused');
            expect(audioContext.suspend).toHaveBeenCalled();
        });

        it('resumes the context and emits resume', async () => {
            const paused = nextEvent(recorder, 'pause');
            recorder.pause();
            await paused;
            const resumed = nextEvent(recorder, 'resume');
            recorder.resume();
            expect((await resumed).type).toBe('resume');
            expect(recorder.state).toBe('recording');
        });

        it('throw when inactive', () => {
            const fresh = instantiateRecorder();
            expect(() => fresh.pause()).toThrowError("The MediaRecorder's state is 'inactive'.");
            expect(() => fresh.resume()).toThrowError("The MediaRecorder's state is 'inactive'.");
        });
    });

    describe('stop', () => {
        let recorder: Mp3MediaRecorder;
        beforeEach(async () => {
            recorder = instantiateRecorder();
            await startRecording(recorder);
        });

        it('flushes the worklet, then tells the worker to stop and tears down the graph', () => {
            const node = captureNode(recorder);
            recorder.stop();
            expect(node.port.postMessage).toHaveBeenCalledWith('flush');
            expect(worker.postMessage).not.toHaveBeenCalledWith({ type: 'STOP_RECORDING' }, []);

            const tail = new Float32Array([0.5]);
            fromWorklet(recorder, tail);
            fromWorklet(recorder, null);
            expect(worker.postMessage.mock.calls.slice(-2)).toEqual([
                [{ type: 'DATA_AVAILABLE', data: tail }, [tail.buffer]],
                [{ type: 'STOP_RECORDING' }, []],
            ]);
            expect(node.disconnect).toHaveBeenCalled();
            expect(audioContext.close).not.toHaveBeenCalled();
        });

        it('closes an internally created AudioContext', async () => {
            const own = new Mp3MediaRecorder(new MediaStream(), { worker });
            await startRecording(own);
            own.stop();
            fromWorklet(own, null);
            expect(own['audioContext'].close).toHaveBeenCalled();
        });

        it('emits dataavailable then stop when the worker delivers the blob', async () => {
            const blob = new Blob([]);
            const events: string[] = [];
            recorder.ondataavailable = (event) => events.push(`${event.type}:${event.data === blob}`);
            recorder.onstop = (event) => events.push(event.type);
            fromWorker({ type: 'BLOB_READY', blob });
            expect(events).toEqual(['dataavailable:true', 'stop']);
            expect(recorder.state).toBe('inactive');
        });

        it('throws when inactive', () => {
            const fresh = instantiateRecorder();
            expect(() => fresh.stop()).toThrowError("The MediaRecorder's state is 'inactive'.");
        });
    });

    describe('worker errors', () => {
        it('emits an error event and resets to inactive', async () => {
            const recorder = instantiateRecorder();
            await startRecording(recorder);
            const failed = nextEvent(recorder, 'error');
            fromWorker({ type: 'ERROR', error: 'encoding_failed' });
            expect(((await failed) as ErrorEvent).error.message).toBe('encoding_failed');
            expect(recorder.state).toBe('inactive');
            expect(captureNode(recorder)).toBeNull();
        });
    });
});
