import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';

const TONE_HZ = 440;
const TONE_SECONDS = 4;
const RECORD_SECONDS = 2;

// 16-bit mono PCM WAV of a sine tone, the format Chromium's fake audio capture accepts.
const sineWav = (hz: number, seconds: number, sampleRate = 48000) => {
    const samples = seconds * sampleRate;
    const buffer = Buffer.alloc(44 + samples * 2);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + samples * 2, 4);
    buffer.write('WAVEfmt ', 8);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20); // PCM
    buffer.writeUInt16LE(1, 22); // mono
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(samples * 2, 40);
    for (let i = 0; i < samples; i++) {
        buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / sampleRate) * 0.5 * 0x7fff), 44 + i * 2);
    }
    return buffer;
};

let server: ViteDevServer;
let browser: Browser;
let url: string;

beforeAll(async () => {
    const wavPath = join(await mkdtemp(join(tmpdir(), 'mp3-e2e-')), 'tone.wav');
    await writeFile(wavPath, sineWav(TONE_HZ, TONE_SECONDS));

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

    const result = await audio.evaluate(async (element: HTMLAudioElement) => {
        const blob = await fetch(element.src).then((response) => response.blob());
        const bytes = await blob.arrayBuffer();
        const header = Array.from(new Uint8Array(bytes.slice(0, 2)));
        const context = new AudioContext();
        const decoded = await context.decodeAudioData(bytes.slice(0));
        const pcm = decoded.getChannelData(0);
        // Skip the encoder's leading padding; measure loudness and pitch (via zero crossings) on the middle second.
        const start = Math.floor(decoded.sampleRate * 0.5);
        const window = pcm.subarray(start, start + decoded.sampleRate);
        const rms = Math.sqrt(window.reduce((sum, sample) => sum + sample * sample, 0) / window.length);
        const zeroCrossings = window.reduce(
            (count, sample, i) => count + (i > 0 && sample >= 0 !== window[i - 1] >= 0 ? 1 : 0),
            0,
        );
        return { type: blob.type, size: blob.size, header, duration: decoded.duration, rms, hz: zeroCrossings / 2 };
    });

    expect(errors).toEqual([]);
    expect(result.type).toBe('audio/mpeg');
    expect(result.header).toEqual([0xff, 0xfb]);
    expect(result.duration).toBeGreaterThan(RECORD_SECONDS - 0.5);
    expect(result.duration).toBeLessThan(RECORD_SECONDS + 1);
    expect(result.rms).toBeGreaterThan(0.05);
    expect(Math.abs(result.hz - TONE_HZ)).toBeLessThan(TONE_HZ * 0.05);
}, 30_000);
