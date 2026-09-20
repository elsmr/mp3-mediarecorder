import { mock } from 'bun:test';

const node = () => ({ connect: mock(), disconnect: mock() });

class FakeTrack extends EventTarget {
    readyState: 'live' | 'ended' = 'live';
    constructor(public kind: 'audio' | 'video') {
        super();
    }
    stop() {
        this.readyState = 'ended';
    }
}

class FakeMediaStream extends EventTarget {
    tracks: FakeTrack[];
    constructor(kinds: ('audio' | 'video')[] = ['audio']) {
        super();
        this.tracks = kinds.map((kind) => new FakeTrack(kind));
    }
    get active() {
        return this.tracks.some((track) => track.readyState === 'live');
    }
    getAudioTracks = () => this.tracks.filter((track) => track.kind === 'audio');
    getVideoTracks = () => this.tracks.filter((track) => track.kind === 'video');
}

class FakeAudioContext {
    state = 'running';
    sampleRate = 44100;
    destination = {};
    audioWorklet = { addModule: mock(() => Promise.resolve()) };
    resume = mock(() => Promise.resolve());
    suspend = mock(() => Promise.resolve());
    close = mock(() => {
        this.state = 'closed';
    });
    createMediaStreamSource = mock(node);
}

Object.assign(globalThis, {
    MediaStream: FakeMediaStream,
    AudioContext: FakeAudioContext,
    AudioWorkletNode: class {
        connect = mock();
        disconnect = mock();
        port = { postMessage: mock(), onmessage: null as ((event: MessageEvent) => void) | null };
        constructor(
            public context: AudioContext,
            public name: string,
            public options: AudioWorkletNodeOptions,
        ) {}
    },
    Worker: class {
        postMessage = mock();
        terminate = mock();
        onmessage: ((event: MessageEvent) => void) | null = null;
        onerror: ((event: ErrorEvent) => void) | null = null;
        constructor(public url: URL | string) {}
    },
    BlobEvent: class extends Event {
        data: Blob;
        timecode: number;
        constructor(type: string, { data, timecode = 0 }: BlobEventInit) {
            super(type);
            this.data = data;
            this.timecode = timecode;
        }
    },
});
