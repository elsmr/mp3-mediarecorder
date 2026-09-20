import { beforeAll, describe, expect, it } from 'bun:test';
import { createMp3Encoder, loadMp3Module, type Mp3EncoderConfig } from './encoder';

const SAMPLE_RATE = 48000;
const SECONDS = 2;
const CHUNK = 4096;

const sine = (hz: number, offset: number, length: number) =>
    Float32Array.from({ length }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * (offset + i)) / SAMPLE_RATE));

const concat = (parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    parts.reduce((offset, part) => (out.set(part, offset), offset + part.length), 0);
    return out;
};

const FRAME_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const FRAME_SAMPLE_RATES = [44100, 48000, 32000];

// Walks MPEG-1 Layer III frame headers; returns null if the sync chain breaks.
const parseFrames = (mp3: Uint8Array) => {
    const frames: { bitrate: number; channels: number }[] = [];
    for (let offset = 0; offset + 4 <= mp3.length;) {
        const [b0, b1, b2, b3] = [mp3[offset], mp3[offset + 1], mp3[offset + 2], mp3[offset + 3]];
        if (b0 !== 0xff || (b1 & 0xfe) !== 0xfa) return null;
        const bitrate = FRAME_BITRATES[b2 >> 4];
        const sampleRate = FRAME_SAMPLE_RATES[(b2 >> 2) & 3];
        const padding = (b2 >> 1) & 1;
        const channels = b3 >> 6 === 3 ? 1 : 2;
        frames.push({ bitrate, channels });
        offset += Math.floor((144000 * bitrate) / sampleRate) + padding;
    }
    return frames;
};

let module: WebAssembly.Module;
beforeAll(async () => {
    module = await loadMp3Module(new URL('./mp3.wasm', import.meta.url).href);
});

const record = async (config: Partial<Mp3EncoderConfig>) => {
    const full: Mp3EncoderConfig = { sampleRate: SAMPLE_RATE, channels: 1, bitrate: 64, infoFrame: true, ...config };
    const encoder = await createMp3Encoder(module, full);
    const parts: Uint8Array[] = [];
    for (let offset = 0; offset < SAMPLE_RATE * SECONDS; offset += CHUNK) {
        const pcm = Array.from({ length: full.channels }, (_, ch) => sine(ch ? 660 : 440, offset, CHUNK));
        parts.push(encoder.encode(pcm));
    }
    const { tail, infoFrame } = encoder.finish();
    const mp3 = concat([...parts, tail]);
    if (infoFrame) mp3.set(infoFrame, 0);
    return { mp3, infoFrame, firstPart: parts.find((part) => part.length > 0)! };
};

describe('mp3 encoder', () => {
    it('imports only JS math and the allocator seed, so libm and stdio stay out of the binary', () => {
        const imports = WebAssembly.Module.imports(module).map(({ module: m, name }) => `${m}.${name}`);
        expect(imports.sort()).toEqual(
            [
                ...['pow', 'powf', 'exp', 'log', 'log10', 'sin', 'cos', 'atan'].map((name) => `env.${name}`),
                'wasi_snapshot_preview1.random_get',
            ].sort(),
        );
    });

    it('produces a contiguous mono MPEG-1 Layer III stream around the target bitrate', async () => {
        const { mp3 } = await record({ channels: 1, bitrate: 64 });
        const frames = parseFrames(mp3)!;
        expect(frames).not.toBeNull();
        expect(frames.length).toBeGreaterThanOrEqual(Math.floor((SAMPLE_RATE * SECONDS) / 1152));
        expect(frames.every((frame) => frame.channels === 1)).toBe(true);
        const kbps = (mp3.length * 8) / SECONDS / 1000;
        expect(kbps).toBeGreaterThan(30);
        expect(kbps).toBeLessThan(80);
    });

    it('encodes stereo as joint stereo', async () => {
        const { mp3 } = await record({ channels: 2, bitrate: 128 });
        const frames = parseFrames(mp3)!;
        expect(frames).not.toBeNull();
        expect(frames.every((frame) => frame.channels === 2)).toBe(true);
    });

    it('returns an info frame that replaces the placeholder at the start of the stream', async () => {
        const { mp3, infoFrame, firstPart } = await record({ infoFrame: true });
        expect(infoFrame!.length).toBeGreaterThan(0);
        expect(firstPart.length).toBeGreaterThanOrEqual(infoFrame!.length);
        expect(new TextDecoder().decode(mp3.subarray(0, infoFrame!.length))).toContain('Xing');
        expect(new TextDecoder().decode(mp3.subarray(0, infoFrame!.length))).toContain('LAME3.100');
    });

    it('reports the placeholder length mid-stream so a partial delivery can drop it', async () => {
        const encoder = await createMp3Encoder(module, {
            sampleRate: SAMPLE_RATE,
            channels: 1,
            bitrate: 64,
            infoFrame: true,
        });
        expect(encoder.infoFrameLength()).toBe(0);
        const parts = Array.from({ length: 4 }, (_, i) => encoder.encode([sine(440, i * CHUNK, CHUNK)]));
        const first = parts.find((part) => part.length > 0)!;
        const length = encoder.infoFrameLength();
        expect(length).toBeGreaterThan(0);
        // The placeholder is a valid frame header followed by zeros: a frame of silence, not a tag.
        expect(first[0]).toBe(0xff);
        expect(first.subarray(4, length).every((byte) => byte === 0)).toBe(true);
        expect(parseFrames(concat([first.subarray(length), ...parts.slice(parts.indexOf(first) + 1)]))).not.toBeNull();
        expect(encoder.finish().infoFrame!.length).toBe(length);
        const plain = await createMp3Encoder(module, {
            sampleRate: SAMPLE_RATE,
            channels: 1,
            bitrate: 64,
            infoFrame: false,
        });
        plain.encode([sine(440, 0, CHUNK)]);
        expect(plain.infoFrameLength()).toBe(0);
        plain.finish();
    });

    it('omits the info frame when not requested', async () => {
        const { mp3, infoFrame } = await record({ infoFrame: false });
        expect(infoFrame).toBeNull();
        expect(new TextDecoder().decode(mp3.subarray(0, 400))).not.toContain('Xing');
        expect(parseFrames(mp3)).not.toBeNull();
    });

    it('rejects invalid configuration and channel mismatches', async () => {
        await expect(
            createMp3Encoder(module, { sampleRate: 48000, channels: 3 as never, bitrate: 64, infoFrame: false }),
        ).rejects.toThrow('Unsupported channel count');
        await expect(
            createMp3Encoder(module, { sampleRate: 48000, channels: 1, bitrate: 999, infoFrame: false }),
        ).rejects.toThrow('Bitrate must be');
        const encoder = await createMp3Encoder(module, {
            sampleRate: 48000,
            channels: 2,
            bitrate: 128,
            infoFrame: false,
        });
        expect(() => encoder.encode([new Float32Array(10)])).toThrow('Expected 2 channel(s)');
        expect(() => encoder.encode([new Float32Array(10), new Float32Array(9)])).toThrow('Expected 2 channel(s)');
        encoder.finish();
        expect(() => encoder.finish()).toThrow('already finished');
    });
});
