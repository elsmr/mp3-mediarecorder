import { mock } from 'bun:test';

const node = () => ({ connect: mock(), disconnect: mock(), gain: { value: 0 } });

Object.assign(globalThis, {
    MediaStream: class {},
    AudioContext: class {
        state = 'running';
        sampleRate = 44100;
        resume = mock(() => Promise.resolve());
        suspend = mock(() => Promise.resolve());
        close = mock();
        createMediaStreamSource = mock(node);
        createGain = mock(node);
        createScriptProcessor = mock(node);
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
