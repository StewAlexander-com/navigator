import {defineConfig} from 'vite';
export default defineConfig({base: '/navigator/', build: {target: 'es2022'}, worker: {format: 'es'}});
