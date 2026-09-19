import { mock } from 'bun:test';

const node = () => ({ connect: mock(), disconnect: mock() });

Object.assign(globalThis, {
    MediaStream: class {},
    AudioContext: class {
        state = 'running';
        sampleRate = 44100;
        destination = {};
        audioWorklet = { addModule: mock(() => Promise.resolve()) };
        resume = mock(() => Promise.resolve());
        suspend = mock(() => Promise.resolve());
        close = mock();
        createMediaStreamSource = mock(node);
    },
    AudioWorkletNode: class {
        connect = mock();
        disconnect = mock();
        port = { postMessage: mock(), onmessage: null as ((event: MessageEvent) => void) | null };
        constructor(
            public context: AudioContext,
            public name: string,
        ) {}
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
