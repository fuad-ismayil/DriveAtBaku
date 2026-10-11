import { defineConfig } from 'vite';

// A source edit in the other preview must not interrupt a benchmark run.
export default defineConfig({ server: { host: '127.0.0.1', hmr: false } });
