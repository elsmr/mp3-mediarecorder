import babel from '@rollup/plugin-babel';
import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';

const pkg = require('./package.json');
const basePlugins = [resolve(), typescript({ declaration: true, declarationDir: 'dist' })];
const pluginsWithTranspile = [...basePlugins, babel()];
const workerPlugins = [resolve(), typescript({ declaration: true, declarationDir: './' })];
const workerPluginsWithTranspile = [...workerPlugins, babel()];
const baseOutputOptions = {
    compact: true,
    interop: false,
};

export default [
    {
        input: 'src/index.ts',
        output: [
            {
                ...baseOutputOptions,
                entryFileNames: pkg.es2015,
                dir: './',
                format: 'es',
            },
        ],
        plugins: basePlugins,
    },
    {
        input: 'src/index.ts',
        output: [
            {
                ...baseOutputOptions,
                entryFileNames: pkg.module,
                dir: './',
                format: 'es',
            },
            {
                ...baseOutputOptions,
                entryFileNames: pkg.main,
                dir: './',
                format: 'cjs',
            },
            {
                ...baseOutputOptions,
                entryFileNames: pkg.browser,
                dir: './',
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
                entryFileNames: 'dist/worker/index.es.js',
                dir: './',
                format: 'es',
            },
        ],
        plugins: workerPlugins,
    },
    {
        input: 'src/worker/index.ts',
        output: [
            {
                ...baseOutputOptions,
                entryFileNames: 'dist/worker/index.es5.js',
                dir: './',
                format: 'es',
            },
            {
                ...baseOutputOptions,
                entryFileNames: 'dist/worker/index.js',
                dir: './',
                format: 'cjs',
            },
            {
                ...baseOutputOptions,
                entryFileNames: 'dist/worker/index.umd.js',
                dir: './',
                format: 'umd',
                name: 'mp3EncoderWorker',
            },
        ],
        plugins: workerPluginsWithTranspile,
    },
];
