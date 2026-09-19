export const WORKLET_PROCESSOR_NAME = 'mp3-mediarecorder-capture';

// Runs on the audio rendering thread. Kept as a string so it can be loaded from a Blob URL
// without users having to serve a separate file. Batches the 128-frame render quanta into
// 4096-frame chunks to keep message volume low. On a 'flush' message it posts the partial
// chunk followed by `null` as an end marker, then stops processing.
export const workletSource = `
const CHUNK_SIZE = 4096;
class CaptureProcessor extends AudioWorkletProcessor {
    chunk = new Float32Array(CHUNK_SIZE);
    offset = 0;
    active = true;
    constructor() {
        super();
        this.port.onmessage = () => {
            this.active = false;
            this.port.postMessage(this.chunk.subarray(0, this.offset));
            this.port.postMessage(null);
        };
    }
    process(inputs) {
        if (!this.active) return false;
        const input = inputs[0][0];
        if (!input) return true;
        let read = 0;
        while (read < input.length) {
            const count = Math.min(input.length - read, CHUNK_SIZE - this.offset);
            this.chunk.set(input.subarray(read, read + count), this.offset);
            this.offset += count;
            read += count;
            if (this.offset === CHUNK_SIZE) {
                this.port.postMessage(this.chunk, [this.chunk.buffer]);
                this.chunk = new Float32Array(CHUNK_SIZE);
                this.offset = 0;
            }
        }
        return true;
    }
}
registerProcessor(${JSON.stringify(WORKLET_PROCESSOR_NAME)}, CaptureProcessor);
`;
