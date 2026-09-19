import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { mp3MediaRecorderAlias } from '../../vite.config';

export default defineConfig({ plugins: [react()], resolve: { alias: mp3MediaRecorderAlias } });
