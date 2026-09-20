import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Mp3MediaRecorder, type Mp3MediaRecorderOptions } from './index';

const nextEvent = <T extends Event = Event>(target: Mp3MediaRecorder, type: string) =>
    new Promise<T>((resolve) => target.addEventListener(type, resolve as never));

const tick = () => new Promise((resolve) => setTimeout(resolve));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type FakeWorker = Worker & {
    postMessage: ReturnType<typeof mock>;
    terminate: ReturnType<typeof mock>;
    url: URL;
};
type FakeStream = MediaStream & { tracks: (EventTarget & { stop: () => void })[] };

const baseConfig = { sampleRate: 44100, channels: 1, bitrate: 64, infoFrame: true, wasmUrl: undefined };

describe('mp3-mediarecorder', () => {
    let worker: FakeWorker;
    let audioContext: AudioContext;
    let stream: FakeStream;

    beforeEach(() => {
        audioContext = new AudioContext();
        worker = new Worker('fake') as FakeWorker;
        stream = new MediaStream() as FakeStream;
    });

    const instantiateRecorder = (options: Mp3MediaRecorderOptions = {}) =>
        new Mp3MediaRecorder(stream, { audioContext, worker, ...options });
    const session = (recorder: Mp3MediaRecorder) => recorder['session']!;
    const captureNode = (recorder: Mp3MediaRecorder) => session(recorder).captureNode!;
    const fromWorker = (recorder: Mp3MediaRecorder, data: unknown) =>
        (session(recorder).worker as FakeWorker).onmessage!({ data } as MessageEvent);
    const fromWorklet = (recorder: Mp3MediaRecorder, data: Float32Array[] | null) =>
        captureNode(recorder).port.onmessage!({ data } as MessageEvent);
    const messages = (w: FakeWorker = worker) => w.postMessage.mock.calls.map(([message]) => message.type);
    const startRecording = async (recorder: Mp3MediaRecorder, timeslice?: number) => {
        recorder.start(timeslice);
        await tick();
    };
    const finalData = (recorder: Mp3MediaRecorder, blob = new Blob([]), start = 0) =>
        fromWorker(recorder, { type: 'DATA', blob, start, final: true });

    describe('constructor', () => {
        it('exposes the spec attributes with sensible defaults', () => {
            const recorder = instantiateRecorder();
            expect(recorder.state).toBe('inactive');
            expect(recorder.mimeType).toBe('');
            expect(recorder.stream).toBe(stream);
            expect(recorder.audioBitsPerSecond).toBe(64000);
            expect(recorder.videoBitsPerSecond).toBe(0);
            expect(recorder.audioBitrateMode).toBe('variable');
        });

        it('accepts supported mimeTypes and rejects others with NotSupportedError', () => {
            expect(instantiateRecorder({ mimeType: 'audio/mpeg' }).mimeType).toBe('audio/mpeg');
            expect(instantiateRecorder({ mimeType: 'audio/mpeg; codecs="mp3"' }).mimeType).toBe(
                'audio/mpeg; codecs="mp3"',
            );
            expect(() => instantiateRecorder({ mimeType: 'audio/webm' })).toThrow(DOMException);
            try {
                instantiateRecorder({ mimeType: 'audio/webm' });
            } catch (error) {
                expect((error as DOMException).name).toBe('NotSupportedError');
            }
        });

        it('honours bitsPerSecond over audioBitsPerSecond and stereo defaults', () => {
            expect(instantiateRecorder({ audioBitsPerSecond: 96500 }).audioBitsPerSecond).toBe(96500);
            expect(instantiateRecorder({ audioBitsPerSecond: 96000, bitsPerSecond: 128000 }).audioBitsPerSecond).toBe(
                128000,
            );
            expect(instantiateRecorder({ channelCount: 2 }).audioBitsPerSecond).toBe(128000);
        });
    });

    describe('isTypeSupported', () => {
        it('accepts only mp3', () => {
            expect(Mp3MediaRecorder.isTypeSupported('')).toBe(true);
            expect(Mp3MediaRecorder.isTypeSupported('audio/mpeg')).toBe(true);
            expect(Mp3MediaRecorder.isTypeSupported('AUDIO/MP3')).toBe(true);
            expect(Mp3MediaRecorder.isTypeSupported('audio/mpeg;codecs=mp3')).toBe(true);
            expect(Mp3MediaRecorder.isTypeSupported('audio/mpeg;codecs=opus')).toBe(false);
            expect(Mp3MediaRecorder.isTypeSupported('audio/webm')).toBe(false);
            expect(Mp3MediaRecorder.isTypeSupported('nonsense')).toBe(false);
        });
    });

    describe('start', () => {
        it('switches to "recording" synchronously and tells the worker to start before the worklet loads', () => {
            const recorder = instantiateRecorder();
            recorder.start();
            expect(recorder.state).toBe('recording');
            expect(recorder.mimeType).toBe('');
            expect(worker.postMessage).toHaveBeenCalledWith({ type: 'START_RECORDING', config: baseConfig });
        });

        it('loads the worklet, connects the graph and fires start once capture begins', async () => {
            const recorder = instantiateRecorder();
            const events: string[] = [];
            recorder.onstart = () => {
                events.push('start');
                expect(captureNode(recorder).connect).toHaveBeenCalledWith(audioContext.destination);
                expect(recorder.mimeType).toBe('audio/mpeg');
            };
            recorder.start();
            expect(events).toEqual([]);
            await tick();
            expect(audioContext.audioWorklet.addModule).toHaveBeenCalledWith(expect.stringMatching(/^blob:/));
            expect(events).toEqual(['start']);
        });

        it('does not fire start when the worker fails before capture begins', async () => {
            const recorder = instantiateRecorder();
            const events: string[] = [];
            recorder.onstart = () => events.push('start');
            recorder.onerror = () => events.push('error');
            recorder.ondataavailable = () => events.push('dataavailable');
            recorder.onstop = () => events.push('stop');
            recorder.start();
            fromWorker(recorder, { type: 'ERROR', error: 'no wasm' });
            await tick();
            expect(messages()).toEqual(['START_RECORDING']);
            finalData(recorder);
            expect(events).toEqual(['error', 'dataavailable', 'stop']);
        });

        it('throws InvalidStateError when not inactive', async () => {
            const recorder = instantiateRecorder();
            await startRecording(recorder);
            expect(() => recorder.start()).toThrow(DOMException);
            try {
                recorder.start();
            } catch (error) {
                expect((error as DOMException).name).toBe('InvalidStateError');
                expect((error as DOMException).message).toBe(
                    "Failed to execute 'start' on 'MediaRecorder': The MediaRecorder's state is 'recording'.",
                );
            }
        });

        it('throws NotSupportedError for inactive streams, video tracks and out-of-range bitrates', () => {
            const name = (fn: () => void) => {
                try {
                    fn();
                } catch (error) {
                    return (error as DOMException).name;
                }
            };
            stream.tracks[0].stop();
            expect(name(() => instantiateRecorder().start())).toBe('NotSupportedError');
            stream = new (MediaStream as any)(['audio', 'video']);
            expect(name(() => instantiateRecorder().start())).toBe('NotSupportedError');
            stream = new MediaStream() as FakeStream;
            expect(name(() => instantiateRecorder({ audioBitsPerSecond: 400000 }).start())).toBe('NotSupportedError');
        });

        it('coerces timeslice like an unsigned long instead of throwing', async () => {
            const recorder = instantiateRecorder();
            expect(() => recorder.start(0)).not.toThrow();
            expect(session(recorder).timeslice).toBe(0);
            recorder.stop();
            const other = instantiateRecorder();
            other.start(-1);
            expect(session(other).timeslice).toBe(4294967295);
        });

        it('fires error, then the (empty) data and stop, when the worklet fails to load', async () => {
            audioContext.audioWorklet.addModule = mock(() => Promise.reject(new Error('nope')));
            const recorder = instantiateRecorder();
            const events: string[] = [];
            recorder.onerror = (event) => events.push(`error:${event.error.name}:${event.error.message}`);
            recorder.ondataavailable = () => events.push('dataavailable');
            recorder.onstop = () => events.push('stop');
            recorder.start();
            await tick();
            await tick();
            expect(recorder.state).toBe('inactive');
            expect(messages().slice(-1)).toEqual(['STOP_RECORDING']);
            finalData(recorder);
            expect(events).toEqual(['error:UnknownError:nope', 'dataavailable', 'stop']);
            expect(recorder['session']).toBeNull();
        });

        it('still fires start when stop() ran before recording began', async () => {
            const recorder = instantiateRecorder();
            const events: string[] = [];
            recorder.onstart = () => events.push('start');
            recorder.ondataavailable = () => events.push('dataavailable');
            recorder.onstop = () => events.push('stop');
            recorder.start();
            recorder.stop();
            await tick();
            expect(recorder.mimeType).toBe('');
            finalData(recorder);
            expect(events).toEqual(['start', 'dataavailable', 'stop']);
        });

        it('keeps a constrained mimeType with parameters while recording', async () => {
            const recorder = instantiateRecorder({ mimeType: 'audio/mpeg;codecs=mp3' });
            await startRecording(recorder);
            expect(recorder.mimeType).toBe('audio/mpeg;codecs=mp3');
        });

        it('refuses a closed user-provided AudioContext', async () => {
            (audioContext as any).state = 'closed';
            const recorder = instantiateRecorder();
            const failed = nextEvent<ErrorEvent>(recorder, 'error');
            recorder.start();
            expect((await failed).error.message).toBe('The provided AudioContext is closed.');
            expect(recorder.state).toBe('inactive');
        });
    });

    describe('encoding options', () => {
        it('records stereo with a 128 kbps default when channelCount is 2', async () => {
            const recorder = instantiateRecorder({ channelCount: 2 });
            recorder.start();
            await tick();
            expect(worker.postMessage).toHaveBeenCalledWith({
                type: 'START_RECORDING',
                config: { ...baseConfig, channels: 2, bitrate: 128 },
            });
            expect((captureNode(recorder) as any).options).toMatchObject({
                channelCount: 2,
                processorOptions: { channels: 2 },
            });
        });

        it('forwards wasmUrl and disables the info frame when using a timeslice', async () => {
            const recorder = instantiateRecorder({ wasmUrl: 'https://cdn/mp3.wasm' });
            recorder.start(1000);
            expect(worker.postMessage).toHaveBeenCalledWith({
                type: 'START_RECORDING',
                config: { ...baseConfig, infoFrame: false, wasmUrl: 'https://cdn/mp3.wasm' },
            });
        });
    });

    describe('audio data', () => {
        it('forwards worklet chunks to the worker, transferring the buffers', async () => {
            const recorder = instantiateRecorder();
            await startRecording(recorder);
            const data = [new Float32Array([0.1, 0.2])];
            fromWorklet(recorder, data);
            expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'DATA_AVAILABLE', data }, [data[0].buffer]);
        });

        it('drops empty chunks', async () => {
            const recorder = instantiateRecorder();
            await startRecording(recorder);
            const calls = worker.postMessage.mock.calls.length;
            fromWorklet(recorder, [new Float32Array(0)]);
            expect(worker.postMessage.mock.calls.length).toBe(calls);
        });

        it('emits dataavailable with timecodes relative to the first blob', async () => {
            const recorder = instantiateRecorder();
            await startRecording(recorder);
            const timecodes: number[] = [];
            recorder.ondataavailable = (event) => timecodes.push(event.timecode);
            fromWorker(recorder, { type: 'DATA', blob: new Blob([]), start: 1000, final: false });
            fromWorker(recorder, { type: 'DATA', blob: new Blob([]), start: 1500, final: false });
            expect(timecodes).toEqual([0, 500]);
            expect(recorder.state).toBe('recording');
        });
    });

    describe('timeslice / requestData', () => {
        it('requestData asks the worker for the data so far', async () => {
            const recorder = instantiateRecorder();
            await startRecording(recorder);
            recorder.requestData();
            expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'REQUEST_DATA' });
        });

        it('requestData throws InvalidStateError when inactive', () => {
            expect(() => instantiateRecorder().requestData()).toThrow(DOMException);
        });

        it('requests data every timeslice while recording, not while paused, with a 100 ms floor', async () => {
            const recorder = instantiateRecorder();
            await startRecording(recorder, 1);
            const requests = () => messages().filter((type) => type === 'REQUEST_DATA').length;
            await sleep(30);
            expect(requests()).toBe(0);
            await sleep(90);
            expect(requests()).toBe(1);
            recorder.pause();
            await sleep(120);
            expect(requests()).toBe(1);
            recorder.resume();
            await sleep(120);
            expect(requests()).toBe(2);
            recorder.stop();
            await sleep(120);
            expect(requests()).toBe(2);
        });
    });

    describe('pause / resume', () => {
        let recorder: Mp3MediaRecorder;
        beforeEach(async () => {
            recorder = instantiateRecorder();
            await startRecording(recorder);
        });

        it('pauses the worklet without touching the AudioContext and fires pause asynchronously', async () => {
            const events: string[] = [];
            recorder.onpause = () => events.push('pause');
            recorder.pause();
            expect(recorder.state).toBe('paused');
            expect(events).toEqual([]);
            await tick();
            expect(events).toEqual(['pause']);
            expect(captureNode(recorder).port.postMessage).toHaveBeenCalledWith('pause');
            expect(audioContext.suspend).not.toHaveBeenCalled();
        });

        it('resumes the worklet and fires resume', async () => {
            recorder.pause();
            const resumed = nextEvent(recorder, 'resume');
            recorder.resume();
            expect(recorder.state).toBe('recording');
            expect((await resumed).type).toBe('resume');
            expect(captureNode(recorder).port.postMessage).toHaveBeenCalledWith('resume');
        });

        it('is a no-op when already in that state', async () => {
            recorder.pause();
            recorder.pause();
            recorder.resume();
            recorder.resume();
            await tick();
            const commands = (captureNode(recorder).port.postMessage as ReturnType<typeof mock>).mock.calls.map(
                (call: unknown[]) => call[0],
            );
            expect(commands).toEqual(['pause', 'resume']);
        });

        it('pauses a recording whose worklet is still loading', async () => {
            const fresh = instantiateRecorder();
            fresh.start();
            fresh.pause();
            await tick();
            expect(captureNode(fresh).port.postMessage).toHaveBeenCalledWith('pause');
        });

        it('throw InvalidStateError when inactive', () => {
            const fresh = instantiateRecorder();
            expect(() => fresh.pause()).toThrow(DOMException);
            expect(() => fresh.resume()).toThrow(DOMException);
        });
    });

    describe('stop', () => {
        let recorder: Mp3MediaRecorder;
        beforeEach(async () => {
            recorder = instantiateRecorder();
            await startRecording(recorder);
        });

        it('becomes inactive synchronously, flushes the worklet, then tells the worker to stop', () => {
            const node = captureNode(recorder);
            recorder.stop();
            expect(recorder.state).toBe('inactive');
            expect(recorder.mimeType).toBe('');
            expect(node.port.postMessage).toHaveBeenCalledWith('flush');
            expect(messages()).not.toContain('STOP_RECORDING');

            const tail = [new Float32Array([0.5])];
            fromWorklet(recorder, tail);
            fromWorklet(recorder, null);
            expect(worker.postMessage.mock.calls.slice(-2)).toEqual([
                [{ type: 'DATA_AVAILABLE', data: tail }, [tail[0].buffer]],
                [{ type: 'STOP_RECORDING' }],
            ]);
            expect(node.disconnect).toHaveBeenCalled();
            expect(audioContext.close).not.toHaveBeenCalled();
        });

        it('is a no-op when inactive', () => {
            expect(() => instantiateRecorder().stop()).not.toThrow();
        });

        it('closes an internally created AudioContext', async () => {
            const own = new Mp3MediaRecorder(stream, { worker });
            await startRecording(own);
            const context = session(own).audioContext;
            own.stop();
            fromWorklet(own, null);
            expect(context.close).toHaveBeenCalled();
        });

        it('fires dataavailable then stop when the worker delivers the final blob', () => {
            const blob = new Blob([]);
            const events: string[] = [];
            recorder.ondataavailable = (event) => events.push(`dataavailable:${event.data === blob}`);
            recorder.onstop = (event) => events.push(event.type);
            recorder.stop();
            fromWorklet(recorder, null);
            finalData(recorder, blob);
            expect(events).toEqual(['dataavailable:true', 'stop']);
            expect(worker.terminate).not.toHaveBeenCalled();
        });

        it('stops a recording whose worklet is still loading', async () => {
            const fresh = instantiateRecorder();
            fresh.start();
            fresh.stop();
            expect(fresh.state).toBe('inactive');
            await tick();
            expect(messages().slice(-2)).toEqual(['START_RECORDING', 'STOP_RECORDING']);
        });

        it('lets a new recording start while the previous one is still flushing', async () => {
            const own = new Mp3MediaRecorder(stream, { audioContext });
            await startRecording(own);
            const first = session(own);
            const events: string[] = [];
            own.onstop = () => events.push('stop');
            own.onstart = () => events.push('start');
            own.stop();
            await startRecording(own);
            const second = session(own);
            expect(second).not.toBe(first);
            expect(own.state).toBe('recording');
            fromWorklet(own, null);
            (first.worker as FakeWorker).onmessage!({
                data: { type: 'DATA', blob: new Blob([]), start: 0, final: true },
            } as MessageEvent);
            expect(events).toEqual(['start', 'stop']);
            expect(own.state).toBe('recording');
            expect(own['session']).toBe(second);
            expect((first.worker as FakeWorker).terminate).toHaveBeenCalled();
        });
    });

    describe('stream lifecycle', () => {
        it('stops when all audio tracks end', async () => {
            const recorder = instantiateRecorder();
            await startRecording(recorder);
            stream.tracks[0].stop();
            await sleep(300);
            expect(recorder.state).toBe('inactive');
            expect(captureNode(recorder).port.postMessage).toHaveBeenCalledWith('flush');
        });

        it('stops immediately when a track fires ended', async () => {
            const recorder = instantiateRecorder();
            await startRecording(recorder);
            stream.tracks[0].stop();
            stream.tracks[0].dispatchEvent(new Event('ended'));
            expect(recorder.state).toBe('inactive');
        });

        it('fires InvalidModificationError and drains when the track set changes', async () => {
            const recorder = instantiateRecorder();
            await startRecording(recorder);
            const events: string[] = [];
            recorder.onerror = (event) => events.push(`error:${event.error.name}`);
            recorder.ondataavailable = () => events.push('dataavailable');
            recorder.onstop = () => events.push('stop');
            stream.dispatchEvent(new Event('addtrack'));
            expect(recorder.state).toBe('inactive');
            expect(events).toEqual([]);
            await tick();
            expect(messages().slice(-1)).toEqual(['STOP_RECORDING']);
            finalData(recorder);
            expect(events).toEqual(['error:InvalidModificationError', 'dataavailable', 'stop']);
        });
    });

    describe('default worker', () => {
        it('spawns a module worker next to the library and terminates it after the recording', async () => {
            const recorder = new Mp3MediaRecorder(stream, { audioContext });
            await startRecording(recorder);
            const spawned = session(recorder).worker as FakeWorker;
            expect(spawned.url.href).toMatch(/\/worker\.js$/);
            recorder.stop();
            fromWorklet(recorder, null);
            finalData(recorder);
            expect(spawned.terminate).toHaveBeenCalled();
            expect(recorder['session']).toBeNull();
        });
    });

    describe('worker errors', () => {
        it('fires an UnknownError ErrorEvent, then the partial data and stop the worker sends', async () => {
            const recorder = instantiateRecorder();
            await startRecording(recorder);
            const events: string[] = [];
            recorder.onerror = (event) => events.push(`error:${event.error.name}:${event.error.message}`);
            recorder.ondataavailable = () => events.push('dataavailable');
            recorder.onstop = () => events.push('stop');
            fromWorker(recorder, { type: 'ERROR', error: 'encoding_failed' });
            expect(recorder.state).toBe('inactive');
            expect(messages()).not.toContain('STOP_RECORDING');
            finalData(recorder);
            expect(events).toEqual(['error:UnknownError:encoding_failed', 'dataavailable', 'stop']);
        });

        it('synthesises an empty dataavailable and stop when the worker itself crashes', async () => {
            const recorder = instantiateRecorder();
            await startRecording(recorder);
            const events: string[] = [];
            recorder.onerror = (event) => events.push(`error:${event.error.name}`);
            recorder.ondataavailable = (event) => events.push(`dataavailable:${event.data.size}`);
            recorder.onstop = () => events.push('stop');
            worker.onerror!({ message: 'boom' } as ErrorEvent);
            expect(recorder.state).toBe('inactive');
            await tick();
            expect(events).toEqual(['error:UnknownError', 'dataavailable:0', 'stop']);
            expect(recorder.state).toBe('inactive');
        });
    });
});
