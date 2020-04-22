Object.defineProperty(window, 'AudioContext', {
    writable: true,
    value: class {
        gainNode: any = { connect: jest.fn(), gain: {} };
        processorNode: any = { connect: jest.fn(), disconnect: jest.fn() };
        sourceNode: any = { connect: jest.fn() };
        _setMockNodes = ({ gainNode, processorNode, sourceNode }: any) => {
            this.gainNode = gainNode;
            this.processorNode = processorNode;
            this.sourceNode = sourceNode;
        };

        resume = jest.fn(() => Promise.resolve());
        close = jest.fn();
        suspend = jest.fn(() => Promise.resolve());
        createMediaStreamSource = jest.fn(() => this.sourceNode);
        createGain = jest.fn(() => this.gainNode);
        createScriptProcessor = jest.fn(() => this.processorNode);
    },
});

window.URL = class extends URL {
    static createObjectURL = jest.fn();
    static revokeObjectURL = jest.fn();
};
