import { WorkerConfig } from './worker-config.type';

export enum PostMessageType {
    INIT_WORKER = '[Main -> Worker] Init',
    DATA_AVAILABLE = '[Main -> Worker] Data available',
    START_RECORDING = '[Main <-> Worker] Start recording',
    STOP_RECORDING = '[Main <-> Worker] Stop recording',
    ERROR = '[Main <- Worker] Error',
    BLOB_READY = '[Main <- Worker] Blob ready'
}

export class InitMessage {
    readonly type = PostMessageType.INIT_WORKER;
    constructor(public payload: { wasmURL: string }) {}
}

export class ErrorMessage {
    readonly type = PostMessageType.ERROR;
    constructor(public payload: { error: string }) {}
}

export class StartRecordingMessage {
    readonly type = PostMessageType.START_RECORDING;
    constructor(public payload: { config: WorkerConfig }) {}
}

export class DataAvailableMessage {
    readonly type = PostMessageType.DATA_AVAILABLE;
    constructor(public payload: { data: Uint8Array }) {}
}

export class BlobReadyMessage {
    readonly type = PostMessageType.BLOB_READY;
    constructor(public payload: { blob: Blob }) {}
}

export class StopRecordingMessage {
    readonly type = PostMessageType.STOP_RECORDING;
}

export type WorkerPostMessage =
    | InitMessage
    | StartRecordingMessage
    | StopRecordingMessage
    | DataAvailableMessage
    | BlobReadyMessage
    | ErrorMessage;
