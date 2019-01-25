interface VmsgWasm {
    vmsg_init: (sampleRate: number) => number;
    vmsg_encode: (ref: number, length: number) => number;
    vmsg_free: (ref: number) => void;
    vmsg_flush: (ref: number) => number;
}
