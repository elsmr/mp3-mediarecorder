import copy from 'rollup-plugin-copy';
import typescript from 'rollup-plugin-typescript2';
import pkg from './package.json';

export default {
    input: `src/index.ts`,
    output: [
        { file: pkg.browser, name: 'Mp3MediaRecorder', format: 'umd' },
        { file: pkg.module, format: 'es' },
        { file: pkg.main, format: 'cjs' }
    ],
    watch: {
        include: 'src/**'
    },
    plugins: [typescript(), copy({ 'node_modules/vmsg/vmsg.wasm': 'dist/vmsg.wasm' })]
};
