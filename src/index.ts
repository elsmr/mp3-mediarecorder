import type { RecorderMessage, WorkerMessage, WorkletCommand } from './messages';
import { WORKLET_PROCESSOR_NAME, workletSource } from './worklet';

export interface Mp3MediaRecorderOptions extends MediaRecorderOptions {
    /** A worker running `mp3-mediarecorder/worker`. By default one is spawned per recording and terminated after it. */
    worker?: Worker;
    /** Reuse an existing AudioContext. Chrome and Safari limit how many can be alive at once. */
    audioContext?: AudioContext;
    /**
     * 1 = mono (default), 2 = joint stereo. Not auto-detected: browsers report 2 channels for tracks whose
     * audio processing has already mixed them to mono, which would double the file size for nothing.
     */
    channelCount?: 1 | 2;
    /** Where the worker fetches `mp3.wasm` from. Defaults to the file next to the worker script. */
    wasmUrl?: string;
}

export interface Mp3MediaRecorderEventMap {
    start: Event;
    stop: Event;
    pause: Event;
    resume: Event;
    dataavailable: BlobEvent;
    error: ErrorEvent;
}

const MP3_MIME_TYPE = 'audio/mpeg';
const DEFAULT_KBPS = { 1: 64, 2: 128 } as const;
// The worklet batches 4096 frames (85 ms at 48 kHz); slicing finer than that only yields empty blobs.
const MIN_TIMESLICE_MS = 100;
const MAX_TIMER_MS = 2 ** 31 - 1;
const TRACK_POLL_MS = 250;

// One URL for the lifetime of the page: addModule() is idempotent per AudioContext for the same URL,
// while a fresh Blob URL per start() would re-register the processor name and throw.
const workletModuleUrl = URL.createObjectURL(new Blob([workletSource], { type: 'text/javascript' }));

// Spec "is type supported": "" defers to the UA; otherwise the container must be MP3 and any codecs
// parameter may only name mp3. (The spec would have `codecs=mp3` return false from isTypeSupported
// since "mp3" is not a synchronously exposed identifier; that hedge exists for hardware detection,
// which does not apply here.)
const isTypeSupported = (type: string): boolean => {
    if (type === '') return true;
    const [mime, ...params] = type
        .toLowerCase()
        .split(';')
        .map((part) => part.trim());
    if (mime !== 'audio/mpeg' && mime !== 'audio/mp3') return false;
    return params.every((param) => {
        const [key, value = ''] = param.split('=');
        if (key !== 'codecs') return false;
        return value
            .replace(/^"|"$/g, '')
            .split(',')
            .every((codec) => codec.trim().split('.')[0] === 'mp3');
    });
};

const invalidState = (method: string, state: RecordingState) =>
    new DOMException(
        `Failed to execute '${method}' on 'MediaRecorder': The MediaRecorder's state is '${state}'.`,
        'InvalidStateError',
    );

const queueTask = (task: () => void) => setTimeout(task, 0);

// Everything that belongs to one start()…stop() cycle. Sessions outlive the recorder's `state`: the
// spec flips `state` synchronously, so a new session may begin while the previous one is still flushing.
interface Session {
    audioContext: AudioContext;
    ownsAudioContext: boolean;
    worker: Worker;
    ownsWorker: boolean;
    timeslice: number;
    sourceNode: MediaStreamAudioSourceNode | null;
    captureNode: AudioWorkletNode | null;
    timer: ReturnType<typeof setInterval> | null;
    paused: boolean;
    stopping: boolean;
    aborted: boolean;
    timecodeOrigin: number | null;
    cleanupStream: () => void;
}

export class Mp3MediaRecorder extends EventTarget {
    readonly stream: MediaStream;
    mimeType: string;
    state: RecordingState = 'inactive';
    readonly audioBitsPerSecond: number;
    readonly videoBitsPerSecond = 0;
    readonly audioBitrateMode: BitrateMode = 'variable';

    private readonly options: Mp3MediaRecorderOptions;
    private readonly channels: 1 | 2;
    private session: Session | null = null;

    static isTypeSupported = (type: string): boolean => isTypeSupported(type);

    constructor(stream: MediaStream, options: Mp3MediaRecorderOptions = {}) {
        super();
        if (!isTypeSupported(options.mimeType ?? '')) {
            throw new DOMException(
                `Failed to construct 'MediaRecorder': mimeType '${options.mimeType}' is not supported.`,
                'NotSupportedError',
            );
        }
        this.stream = stream;
        this.options = options;
        this.mimeType = options.mimeType ?? '';
        this.channels = options.channelCount ?? 1;
        this.audioBitsPerSecond =
            options.bitsPerSecond ?? options.audioBitsPerSecond ?? DEFAULT_KBPS[this.channels] * 1000;
    }

    start(timeslice?: number): void {
        if (this.state !== 'inactive') {
            throw invalidState('start', this.state);
        }
        if (!this.stream.active) {
            throw new DOMException(
                "Failed to execute 'start' on 'MediaRecorder': The MediaStream is inactive.",
                'NotSupportedError',
            );
        }
        if (this.stream.getVideoTracks().length > 0) {
            throw new DOMException(
                "Failed to execute 'start' on 'MediaRecorder': Only audio tracks can be recorded as audio/mpeg.",
                'NotSupportedError',
            );
        }
        const kbps = Math.round(this.audioBitsPerSecond / 1000);
        if (kbps < 8 || kbps > 320) {
            throw new DOMException(
                `Failed to execute 'start' on 'MediaRecorder': audioBitsPerSecond must be between 8000 and 320000, got ${this.audioBitsPerSecond}.`,
                'NotSupportedError',
            );
        }
        // WebIDL `optional unsigned long`: undefined means "never slice", anything else is ToUint32.
        const slice = timeslice === undefined ? Infinity : Number(timeslice) >>> 0;
        this.state = 'recording';
        const session = this.createSession(slice);
        this.session = session;
        this.setup(session).catch((error: unknown) => this.abort(session, 'UnknownError', error, 'flush'));
    }

    stop(): void {
        if (this.state === 'inactive') return;
        this.inactivate();
        this.finish(this.session!);
    }

    pause(): void {
        if (this.state === 'inactive') {
            throw invalidState('pause', this.state);
        }
        if (this.state === 'paused') return;
        this.state = 'paused';
        const session = this.session!;
        session.paused = true;
        this.stopTimer(session);
        this.command(session, 'pause');
        queueTask(() => this.dispatchEvent(new Event('pause')));
    }

    resume(): void {
        if (this.state === 'inactive') {
            throw invalidState('resume', this.state);
        }
        if (this.state === 'recording') return;
        this.state = 'recording';
        const session = this.session!;
        session.paused = false;
        this.command(session, 'resume');
        this.startTimer(session);
        queueTask(() => this.dispatchEvent(new Event('resume')));
    }

    requestData(): void {
        if (this.state === 'inactive') {
            throw invalidState('requestData', this.state);
        }
        this.session!.worker.postMessage({ type: 'REQUEST_DATA' } satisfies RecorderMessage);
    }

    private createSession(timeslice: number): Session {
        const audioContext = this.options.audioContext ?? new AudioContext();
        const worker = this.options.worker ?? new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
        const session: Session = {
            audioContext,
            ownsAudioContext: !this.options.audioContext,
            worker,
            ownsWorker: !this.options.worker,
            timeslice,
            sourceNode: null,
            captureNode: null,
            timer: null,
            paused: false,
            stopping: false,
            aborted: false,
            timecodeOrigin: null,
            cleanupStream: () => {},
        };
        worker.onmessage = (event: MessageEvent<WorkerMessage>) => this.onWorkerMessage(session, event.data);
        worker.onerror = (event) =>
            this.abort(session, 'UnknownError', event.error ?? (event.message || 'Worker error'), 'dead');
        session.cleanupStream = this.watchStream(session, this.stream);
        worker.postMessage({
            type: 'START_RECORDING',
            config: {
                sampleRate: audioContext.sampleRate,
                channels: this.channels,
                bitrate: Math.round(this.audioBitsPerSecond / 1000),
                infoFrame: timeslice === Infinity,
                wasmUrl: this.options.wasmUrl,
            },
        } satisfies RecorderMessage);
        return session;
    }

    // Spec: all recorded tracks ending stops the recording; changing the track set is an error.
    // A locally stopped track changes readyState without firing 'ended', so the state is also polled.
    private watchStream(session: Session, stream: MediaStream): () => void {
        const tracks = stream.getAudioTracks();
        const checkEnded = () => {
            if (this.session === session && tracks.every((track) => track.readyState === 'ended')) {
                this.stop();
            }
        };
        const poll = setInterval(checkEnded, TRACK_POLL_MS);
        tracks.forEach((track) => track.addEventListener('ended', checkEnded));
        const onTrackSetChanged = () =>
            this.abort(
                session,
                'InvalidModificationError',
                'The MediaStream track set changed while recording.',
                'flush',
            );
        stream.addEventListener('addtrack', onTrackSetChanged);
        stream.addEventListener('removetrack', onTrackSetChanged);
        return () => {
            clearInterval(poll);
            tracks.forEach((track) => track.removeEventListener('ended', checkEnded));
            stream.removeEventListener('addtrack', onTrackSetChanged);
            stream.removeEventListener('removetrack', onTrackSetChanged);
        };
    }

    private async setup(session: Session): Promise<void> {
        const { audioContext } = session;
        if (audioContext.state === 'closed') {
            throw new Error('The provided AudioContext is closed.');
        }
        await audioContext.audioWorklet.addModule(workletModuleUrl);
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }
        if (session.aborted) return;
        if (session.stopping) {
            // stop() arrived while the worklet was loading: nothing was captured, let the worker flush.
            // Spec: start is still fired, since stop() only cancels once recording has begun.
            this.releaseAudio(session);
            this.dispatchEvent(new Event('start'));
            session.worker.postMessage({ type: 'STOP_RECORDING' } satisfies RecorderMessage);
            return;
        }
        const channels = this.channels;
        session.sourceNode = audioContext.createMediaStreamSource(this.stream);
        session.captureNode = new AudioWorkletNode(audioContext, WORKLET_PROCESSOR_NAME, {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            channelCount: channels,
            channelCountMode: 'explicit',
            processorOptions: { channels },
        });
        session.captureNode.port.onmessage = ({ data }: MessageEvent<Float32Array[] | null>) => {
            if (data === null) {
                this.releaseAudio(session);
                session.worker.postMessage({ type: 'STOP_RECORDING' } satisfies RecorderMessage);
            } else if (data[0]?.length > 0) {
                session.worker.postMessage(
                    { type: 'DATA_AVAILABLE', data } satisfies RecorderMessage,
                    data.map((channel) => channel.buffer),
                );
            }
        };
        session.sourceNode.connect(session.captureNode);
        // A worklet node is only rendered while it reaches the destination; its output stays silent.
        session.captureNode.connect(audioContext.destination);
        // Spec: start fires once recording of the tracks has begun, which is now that the worklet is
        // connected. The worker needs no separate readiness signal; its messages are handled in order.
        this.mimeType ||= MP3_MIME_TYPE;
        if (session.paused) this.command(session, 'pause');
        else this.startTimer(session);
        this.dispatchEvent(new Event('start'));
    }

    private onWorkerMessage(session: Session, message: WorkerMessage): void {
        switch (message.type) {
            case 'ERROR':
                // The worker follows up with a final DATA message carrying what it encoded so far.
                this.abort(session, 'UnknownError', message.error, 'worker');
                break;
            case 'DATA': {
                session.timecodeOrigin ??= message.start;
                this.dispatchEvent(
                    new BlobEvent('dataavailable', {
                        data: message.blob,
                        timecode: message.start - session.timecodeOrigin,
                    }),
                );
                if (message.final) {
                    this.releaseSession(session);
                    this.dispatchEvent(new Event('stop'));
                }
                break;
            }
        }
    }

    // Spec "inactivate the recorder".
    private inactivate(): void {
        this.state = 'inactive';
        this.mimeType = this.options.mimeType ?? '';
    }

    // Normal end of a session: drain the worklet, then the worker delivers the final blob.
    private finish(session: Session): void {
        if (session.stopping) return;
        session.stopping = true;
        this.stopTimer(session);
        session.cleanupStream();
        if (session.captureNode) {
            this.command(session, 'flush');
        }
        // Otherwise setup() is still running and will notice `stopping`.
    }

    // Recording cannot continue: error first, then whatever data was gathered, then stop. `drain` says
    // who delivers that final blob: the worker after we ask it ('flush'), the worker on its own ('worker'),
    // or nobody because the worker is gone ('dead').
    private abort(session: Session, name: string, error: unknown, drain: 'flush' | 'worker' | 'dead'): void {
        if (this.session !== session || session.stopping) return;
        this.inactivate();
        session.stopping = true;
        session.aborted = true;
        this.stopTimer(session);
        session.cleanupStream();
        this.releaseAudio(session);
        if (drain === 'worker') {
            this.fireError(name, error);
            return;
        }
        queueTask(() => {
            this.fireError(name, error);
            if (drain === 'flush') {
                session.worker.postMessage({ type: 'STOP_RECORDING' } satisfies RecorderMessage);
            } else {
                this.releaseSession(session);
                this.dispatchEvent(
                    new BlobEvent('dataavailable', { data: new Blob([], { type: MP3_MIME_TYPE }), timecode: 0 }),
                );
                this.dispatchEvent(new Event('stop'));
            }
        });
    }

    private fireError(name: string, error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        const exception = error instanceof DOMException ? error : new DOMException(message, name);
        this.dispatchEvent(new ErrorEvent('error', { error: exception, message: exception.message }));
    }

    private command(session: Session, command: WorkletCommand) {
        session.captureNode?.port.postMessage(command);
    }

    private startTimer(session: Session) {
        if (session.timer || session.timeslice > MAX_TIMER_MS) return;
        session.timer = setInterval(
            () => session.worker.postMessage({ type: 'REQUEST_DATA' } satisfies RecorderMessage),
            Math.max(session.timeslice, MIN_TIMESLICE_MS),
        );
    }

    private stopTimer(session: Session) {
        if (session.timer) clearInterval(session.timer);
        session.timer = null;
    }

    private releaseAudio(session: Session): void {
        if (session.captureNode) {
            session.sourceNode?.disconnect(session.captureNode);
            session.captureNode.disconnect();
            session.captureNode.port.onmessage = null;
        }
        session.sourceNode = null;
        session.captureNode = null;
        if (session.ownsAudioContext && session.audioContext.state !== 'closed') {
            session.audioContext.close();
        }
    }

    private releaseSession(session: Session): void {
        this.stopTimer(session);
        session.cleanupStream();
        this.releaseAudio(session);
        session.worker.onmessage = null;
        session.worker.onerror = null;
        if (session.ownsWorker) session.worker.terminate();
        if (this.session === session) this.session = null;
    }
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

type Handler<K extends keyof Mp3MediaRecorderEventMap> = (
    this: Mp3MediaRecorder,
    event: Mp3MediaRecorderEventMap[K],
) => void;

declare module './index' {
    interface Mp3MediaRecorder {
        onstart: Handler<'start'> | null;
        onstop: Handler<'stop'> | null;
        onpause: Handler<'pause'> | null;
        onresume: Handler<'resume'> | null;
        ondataavailable: Handler<'dataavailable'> | null;
        onerror: Handler<'error'> | null;
        addEventListener<K extends keyof Mp3MediaRecorderEventMap>(
            type: K,
            listener: Handler<K>,
            options?: boolean | AddEventListenerOptions,
        ): void;
        addEventListener(
            type: string,
            listener: EventListenerOrEventListenerObject | null,
            options?: boolean | AddEventListenerOptions,
        ): void;
        removeEventListener<K extends keyof Mp3MediaRecorderEventMap>(
            type: K,
            listener: Handler<K>,
            options?: boolean | EventListenerOptions,
        ): void;
        removeEventListener(
            type: string,
            listener: EventListenerOrEventListenerObject | null,
            options?: boolean | EventListenerOptions,
        ): void;
    }
}
