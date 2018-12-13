import typescript from 'rollup-plugin-typescript2';
import wasm from 'rollup-plugin-wasm';
import pkg from './package.json';

export default {
    input: `src/recorder.ts`,
    output: [
        { file: pkg.browser, name: 'Mp3MediaRecorder', format: 'umd', sourcemap: true },
        { file: pkg.module, format: 'es', sourcemap: true }
    ],
    watch: {
        include: 'src/**'
    },
    plugins: [typescript(), wasm()]
};
