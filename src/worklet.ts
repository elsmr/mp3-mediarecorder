export const WORKLET_PROCESSOR_NAME = 'mp3-mediarecorder-capture';

// Runs on the audio rendering thread. Kept as a string so it can be loaded from a Blob URL
// without users having to serve a separate file. Batches the 128-frame render quanta into
// 4096-frame chunks per channel to keep message volume low. Input is dropped while paused.
// On 'flush' it posts the partial chunk followed by `null` as an end marker, then stops.
export const workletSource = `
const CHUNK_SIZE = 4096;
class CaptureProcessor extends AudioWorkletProcessor {
    chunk = [];
    offset = 0;
    active = true;
    paused = false;
    constructor(options) {
        super();
        this.channels = options.processorOptions.channels;
        this.reset();
        this.port.onmessage = ({ data }) => {
            if (data === 'pause') this.paused = true;
            if (data === 'resume') this.paused = false;
            if (data === 'flush') {
                this.active = false;
                this.post(this.chunk.map((channel) => channel.subarray(0, this.offset)));
                this.port.postMessage(null);
            }
        };
    }
    reset() {
        this.chunk = Array.from({ length: this.channels }, () => new Float32Array(CHUNK_SIZE));
        this.offset = 0;
    }
    post(channels) {
        this.port.postMessage(channels, channels.map((channel) => channel.buffer));
    }
    process(inputs) {
        if (!this.active) return false;
        const input = inputs[0];
        if (this.paused || !input[0]) return true;
        let read = 0;
        while (read < input[0].length) {
            const count = Math.min(input[0].length - read, CHUNK_SIZE - this.offset);
            for (let c = 0; c < this.channels; c++) {
                this.chunk[c].set((input[c] ?? input[0]).subarray(read, read + count), this.offset);
            }
            this.offset += count;
            read += count;
            if (this.offset === CHUNK_SIZE) {
                this.post(this.chunk);
                this.reset();
            }
        }
        return true;
    }
}
registerProcessor(${JSON.stringify(WORKLET_PROCESSOR_NAME)}, CaptureProcessor);
`;
