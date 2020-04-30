import babel from '@rollup/plugin-babel';
import resolve from '@rollup/plugin-node-resolve';
import typescript from 'rollup-plugin-typescript2';

const pkg = require('./package.json');
const basePlugins = [typescript({ useTsconfigDeclarationDir: true, clean: true }), resolve()];
const pluginsWithTranspile = [...basePlugins, babel()];
const baseOutputOptions = {
    compact: true,
    interop: false,
    sourcemap: true,
};

export default [
    {
        input: 'src/index.ts',
        output: [
            {
                ...baseOutputOptions,
                file: pkg.es2015,
                format: 'es',
                sourcemap: true,
            },
        ],
        plugins: basePlugins,
    },
    {
        input: 'src/index.ts',
        output: [
            {
                ...baseOutputOptions,
                file: pkg.module,
                format: 'es',
            },
            {
                ...baseOutputOptions,
                file: pkg.main,
                format: 'cjs',
            },
            {
                ...baseOutputOptions,
                file: pkg.browser,
                format: 'umd',
                name: 'mp3MediaRecorder',
            },
        ],
        plugins: pluginsWithTranspile,
    },
    {
        input: 'src/worker/index.ts',
        output: [
            {
                ...baseOutputOptions,
                file: 'dist/worker/index.es.js',
                format: 'es',
            },
        ],
        plugins: basePlugins,
    },
    {
        input: 'src/worker/index.ts',
        output: [
            {
                ...baseOutputOptions,
                file: 'dist/worker/index.es5.js',
                format: 'es',
            },
            {
                ...baseOutputOptions,
                file: 'dist/worker/index.js',
                format: 'cjs',
            },
            {
                ...baseOutputOptions,
                file: 'dist/worker/index.umd.js',
                format: 'umd',
                name: 'mp3EncoderWorker',
            },
        ],
        plugins: pluginsWithTranspile,
    },
];
