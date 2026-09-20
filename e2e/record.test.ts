import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';

const TONE_HZ = 440;
const TONE_SECONDS = 4;
const RECORD_SECONDS = 2;

const RIGHT_TONE_HZ = 660;

// 16-bit PCM WAV with one sine tone per channel, the format Chromium's fake audio capture accepts.
const sineWav = (channelHz: number[], seconds: number, sampleRate = 48000) => {
    const channels = channelHz.length;
    const frames = seconds * sampleRate;
    const dataSize = frames * 2 * channels;
    const buffer = Buffer.alloc(44 + dataSize);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVEfmt ', 8);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20); // PCM
    buffer.writeUInt16LE(channels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2 * channels, 28);
    buffer.writeUInt16LE(2 * channels, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);
    for (let i = 0; i < frames; i++) {
        channelHz.forEach((hz, channel) => {
            const sample = Math.round(Math.sin((2 * Math.PI * hz * i) / sampleRate) * 0.5 * 0x7fff);
            buffer.writeInt16LE(sample, 44 + (i * channels + channel) * 2);
        });
    }
    return buffer;
};

// Runs in the page: decodes an mp3 blob and measures loudness and pitch (via zero crossings) per channel,
// skipping the encoder's leading padding.
const analyse = async (blob: Blob) => {
    const bytes = await blob.arrayBuffer();
    const header = Array.from(new Uint8Array(bytes.slice(0, 2)));
    const context = new AudioContext();
    const decoded = await context.decodeAudioData(bytes.slice(0));
    const start = Math.floor(decoded.sampleRate * 0.5);
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, channel) => {
        const window = decoded.getChannelData(channel).subarray(start, start + decoded.sampleRate);
        const rms = Math.sqrt(window.reduce((sum, sample) => sum + sample * sample, 0) / window.length);
        const zeroCrossings = window.reduce(
            (count, sample, i) => count + (i > 0 && sample >= 0 !== window[i - 1] >= 0 ? 1 : 0),
            0,
        );
        return { rms, hz: zeroCrossings / 2 };
    });
    return { type: blob.type, size: blob.size, header, duration: decoded.duration, channels };
};
type Analysis = Awaited<ReturnType<typeof analyse>>;
// Playwright only serialises the outer function, so helpers are shipped as source and revived in the page.
const inPage = (source: string) => new Function(`return (${source})`)() as (blob: Blob) => Promise<Analysis>;

let server: ViteDevServer;
let browser: Browser;
let url: string;

beforeAll(async () => {
    const wavPath = join(await mkdtemp(join(tmpdir(), 'mp3-e2e-')), 'tone.wav');
    await writeFile(wavPath, sineWav([TONE_HZ, RIGHT_TONE_HZ], TONE_SECONDS));

    server = await createServer({
        configFile: 'vite.config.ts',
        root: 'examples/basic',
        server: { port: 0 },
        logLevel: 'error',
    });
    await server.listen();
    url = server.resolvedUrls!.local[0];

    browser = await chromium.launch({
        args: [
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            `--use-file-for-fake-audio-capture=${wavPath}`,
        ],
    });
});

afterAll(async () => {
    await browser?.close();
    await server?.close();
});

test('records the microphone to a playable mp3 containing the input tone', async () => {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));

    await page.goto(url);
    await page.getByRole('button', { name: 'Record' }).click();
    await page.getByText('Recording', { exact: true }).waitFor();
    await page.waitForTimeout(RECORD_SECONDS * 1000);
    await page.getByRole('button', { name: 'Stop' }).click();
    const audio = page.locator('#recordings audio');
    await audio.waitFor();

    const result = await audio.evaluate(
        (element: HTMLAudioElement, { analyseSource, inPageSource }) => {
            const analyse = new Function(`return (${inPageSource})`)()(analyseSource) as (
                blob: Blob,
            ) => Promise<Analysis>;
            return fetch(element.src)
                .then((response) => response.blob())
                .then(analyse);
        },
        { analyseSource: analyse.toString(), inPageSource: inPage.toString() },
    );

    expect(errors).toEqual([]);
    expect(result.type).toBe('audio/mpeg');
    expect(result.header).toEqual([0xff, 0xfb]);
    expect(result.duration).toBeGreaterThan(RECORD_SECONDS - 0.5);
    expect(result.duration).toBeLessThan(RECORD_SECONDS + 1);
    expect(result.channels).toHaveLength(1);
    expect(result.channels[0].rms).toBeGreaterThan(0.05);
    // Chromium's default audio processing mixes the fake stereo file down to mono.
    expect(result.channels[0].hz).toBeGreaterThan(TONE_HZ * 0.95);
    expect(result.channels[0].hz).toBeLessThan(RIGHT_TONE_HZ * 1.05);
}, 30_000);

// Drives the library directly (served from src/ by Vite) for the options the example UI does not expose.
const recordInPage = async (options: { channelCount?: 1 | 2; timeslice?: number; endTrack?: boolean }) => {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);
    const result = await page.evaluate(
        async ({ modulePath, options, seconds, analyseSource, inPageSource }) => {
            const analyse = new Function(`return (${inPageSource})`)()(analyseSource) as (
                blob: Blob,
            ) => Promise<Analysis>;
            const { Mp3MediaRecorder } = (await import(modulePath)) as typeof import('../src/index');
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
            });
            const recorder = new Mp3MediaRecorder(stream, { channelCount: options.channelCount });
            const blobs: Blob[] = [];
            const events: string[] = [];
            recorder.addEventListener('dataavailable', (event) => {
                blobs.push(event.data);
                events.push('dataavailable');
            });
            recorder.addEventListener('error', (event) => events.push(`error:${event.error.message}`));
            const stopped = new Promise((resolve) => recorder.addEventListener('stop', resolve));
            const finish = () =>
                options.endTrack ? stream.getTracks().forEach((track) => track.stop()) : recorder.stop();
            recorder.addEventListener('start', () => setTimeout(finish, seconds * 1000));
            recorder.start(options.timeslice);
            const stateAfterStart = recorder.state;
            await stopped;
            return {
                events,
                stateAfterStart,
                stateAfterStop: recorder.state,
                mimeType: recorder.mimeType,
                blobSizes: blobs.map((blob) => blob.size),
                audioBitsPerSecond: recorder.audioBitsPerSecond,
                combined: await analyse(new Blob(blobs, { type: 'audio/mpeg' })),
            };
        },
        {
            modulePath: `/@fs${fileURLToPath(new URL('../src/index.ts', import.meta.url))}`,
            options,
            seconds: RECORD_SECONDS,
            analyseSource: analyse.toString(),
            inPageSource: inPage.toString(),
        },
    );
    await page.close();
    expect(errors).toEqual([]);
    return result;
};

test('records stereo when asked to', async () => {
    const result = await recordInPage({ channelCount: 2 });
    expect(result.events).toEqual(['dataavailable']);
    expect(result.stateAfterStart).toBe('recording');
    expect(result.stateAfterStop).toBe('inactive');
    expect(result.mimeType).toBe('');
    expect(result.audioBitsPerSecond).toBe(128000);
    expect(result.combined.channels).toHaveLength(2);
    const [left, right] = result.combined.channels;
    expect(Math.abs(left.hz - TONE_HZ)).toBeLessThan(TONE_HZ * 0.05);
    expect(Math.abs(right.hz - RIGHT_TONE_HZ)).toBeLessThan(RIGHT_TONE_HZ * 0.05);
}, 30_000);

test('emits a chunk per timeslice that concatenates into a playable mp3', async () => {
    const result = await recordInPage({ timeslice: 500 });
    expect(result.events.filter((event) => event === 'dataavailable').length).toBeGreaterThanOrEqual(3);
    expect(result.blobSizes.every((size) => size > 0)).toBe(true);
    expect(result.combined.header).toEqual([0xff, 0xfb]);
    expect(result.combined.duration).toBeGreaterThan(RECORD_SECONDS - 0.5);
    expect(result.combined.channels).toHaveLength(1);
    expect(result.combined.channels[0].rms).toBeGreaterThan(0.05);
}, 30_000);

test('stops by itself when the microphone track ends', async () => {
    const result = await recordInPage({ endTrack: true });
    expect(result.events).toEqual(['dataavailable']);
    expect(result.stateAfterStop).toBe('inactive');
    expect(result.combined.duration).toBeGreaterThan(RECORD_SECONDS - 0.5);
}, 30_000);
