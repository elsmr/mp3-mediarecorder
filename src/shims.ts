export class ShimBlobEvent extends Event implements BlobEvent {
    readonly data: Blob;
    readonly timecode: number;

    constructor(type: string, init: BlobEventInit) {
        const { data, timecode, ...eventInit } = init;
        super(type, eventInit);
        this.data = data;
        this.timecode = timecode || Date.now();
    }
}

export class ShimMediaRecorderErrorEvent extends Event implements MediaRecorderErrorEvent {
    readonly error: DOMException;

    constructor(type: string, init: MediaRecorderErrorEventInit) {
        const { error, ...eventInit } = init;
        super(type, eventInit);
        this.error = error;
    }
}
