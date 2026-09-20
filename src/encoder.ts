export interface Mp3EncoderConfig {
    sampleRate: number;
    channels: 1 | 2;
    /** Average bitrate in kbps, 8–320. LAME clamps it further for low sample rates. */
    bitrate: number;
    /**
     * Reserve a Xing/LAME info frame at the start of the stream so players get exact duration and
     * seeking. Only useful when the whole stream is still in hand at `finish()`, since the frame
     * returned there must overwrite the first bytes emitted by `encode()`.
     */
    infoFrame: boolean;
}

export interface Mp3Encoder {
    /** One Float32Array per channel, equal lengths, samples in [-1, 1]. Returns encoded bytes (possibly empty). */
    encode(pcm: readonly Float32Array[]): Uint8Array;
    /** Bytes LAME reserved at the start of the stream for the info frame; 0 until the first frame is out. */
    infoFrameLength(): number;
    /** Flushes remaining frames and releases the encoder. `infoFrame` replaces the first bytes of the stream. */
    finish(): { tail: Uint8Array; infoFrame: Uint8Array | null };
}

// Contract with native/encoder.c.
interface Exports {
    memory: WebAssembly.Memory;
    _initialize?: () => void;
    mp3_create: (sampleRate: number, channels: number, kbps: number, infoFrame: number) => number;
    mp3_pcm: (handle: number, channel: number, samples: number) => number;
    mp3_out: (handle: number) => number;
    mp3_encode: (handle: number, samples: number) => number;
    mp3_flush: (handle: number) => number;
    mp3_info_frame: (handle: number) => number;
    mp3_destroy: (handle: number) => void;
}

export const loadMp3Module = (url: string): Promise<WebAssembly.Module> => {
    const fallback = () =>
        fetch(url)
            .then((response) => response.arrayBuffer())
            .then((buffer) => WebAssembly.compile(buffer));
    return WebAssembly.compileStreaming ? WebAssembly.compileStreaming(fetch(url)).catch(fallback) : fallback();
};

export const createMp3Encoder = async (module: WebAssembly.Module, config: Mp3EncoderConfig): Promise<Mp3Encoder> => {
    if (config.channels !== 1 && config.channels !== 2) {
        throw new Error(`Unsupported channel count: ${config.channels}`);
    }
    if (!Number.isInteger(config.bitrate) || config.bitrate < 8 || config.bitrate > 320) {
        throw new Error(`Bitrate must be an integer between 8 and 320 kbps, got ${config.bitrate}`);
    }
    if (!Number.isFinite(config.sampleRate) || config.sampleRate <= 0) {
        throw new Error(`Invalid sample rate: ${config.sampleRate}`);
    }

    // The wasm imports its transcendental math from here instead of carrying libm (see native/config.h);
    // wasi-libc's allocator seeds itself through random_get.
    let memory: WebAssembly.Memory;
    const instance = await WebAssembly.instantiate(module, {
        env: {
            pow: Math.pow,
            powf: Math.pow,
            exp: Math.exp,
            log: Math.log,
            log10: Math.log10,
            log10f: Math.log10,
            sin: Math.sin,
            cos: Math.cos,
            atan: Math.atan,
        },
        wasi_snapshot_preview1: {
            random_get: (ptr: number, length: number) => {
                crypto.getRandomValues(new Uint8Array(memory.buffer, ptr, length));
                return 0;
            },
        },
    });
    const wasm = instance.exports as unknown as Exports;
    memory = wasm.memory;
    wasm._initialize?.();

    const handle = wasm.mp3_create(config.sampleRate, config.channels, config.bitrate, config.infoFrame ? 1 : 0);
    if (!handle) {
        throw new Error('Failed to initialise the mp3 encoder');
    }
    let finished = false;

    const output = (length: number): Uint8Array => {
        if (length < 0) {
            throw new Error('mp3 encoding failed');
        }
        return new Uint8Array(memory.buffer, wasm.mp3_out(handle), length).slice();
    };

    return {
        encode(pcm) {
            if (finished) {
                throw new Error('Encoder already finished');
            }
            if (pcm.length !== config.channels || pcm.some((channel) => channel.length !== pcm[0].length)) {
                throw new Error(`Expected ${config.channels} channel(s) of equal length`);
            }
            const samples = pcm[0].length;
            if (samples === 0) {
                return new Uint8Array(0);
            }
            // Views must be created after each mp3_pcm call: growing memory detaches earlier buffers.
            pcm.forEach((channel, index) => {
                const ptr = wasm.mp3_pcm(handle, index, samples);
                if (!ptr) {
                    throw new Error('mp3 encoder out of memory');
                }
                new Float32Array(memory.buffer, ptr, samples).set(channel);
            });
            return output(wasm.mp3_encode(handle, samples));
        },
        infoFrameLength() {
            return config.infoFrame && !finished ? output(wasm.mp3_info_frame(handle)).length : 0;
        },
        finish() {
            if (finished) {
                throw new Error('Encoder already finished');
            }
            finished = true;
            const tail = output(wasm.mp3_flush(handle));
            const infoLength = config.infoFrame ? wasm.mp3_info_frame(handle) : 0;
            const infoFrame = infoLength > 0 ? output(infoLength) : null;
            wasm.mp3_destroy(handle);
            return { tail, infoFrame };
        },
    };
};
