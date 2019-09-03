import buble from 'rollup-plugin-buble';
import resolve from 'rollup-plugin-node-resolve';
import sourceMaps from 'rollup-plugin-sourcemaps';
import typescript from 'rollup-plugin-typescript2';
import pkg from './package.json';

export default {
    input: 'src/recorder.ts',
    output: [{ file: pkg.module, format: 'es', sourcemap: true, interop: false }],
    watch: {
        include: 'src/**'
    },
    plugins: [typescript({ useTsconfigDeclarationDir: true, clean: true }), resolve(), sourceMaps(), buble()]
};
