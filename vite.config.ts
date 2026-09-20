import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// Lets the examples import `mp3-mediarecorder` while resolving to the local source.
export const mp3MediaRecorderAlias = [
    { find: /^mp3-mediarecorder$/, replacement: local('./src/index.ts') },
    { find: /^mp3-mediarecorder\/worker$/, replacement: local('./src/worker.ts') },
];

export default defineConfig({ resolve: { alias: mp3MediaRecorderAlias } });
