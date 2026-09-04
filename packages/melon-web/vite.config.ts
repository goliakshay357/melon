import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
    test: {
        include: ['test/**/*.test.ts'],
        // Runs under `node --test`, not vitest — vitest finds no suite in it.
        exclude: ['test/melon-code-fence.test.ts'],
        setupFiles: ['./test/setup-globals.ts'],
    },
    server: {
        proxy: {
            "/sessions": "http://127.0.0.1:8788",
            "/auth": "http://127.0.0.1:8788",
            "/models": "http://127.0.0.1:8788",
            "/projects": "http://127.0.0.1:8788",
            "/canvases": "http://127.0.0.1:8788",
            "/tree": "http://127.0.0.1:8788",
            "/transcript": "http://127.0.0.1:8788",
            "/browse": "http://127.0.0.1:8788",
            "/settings": "http://127.0.0.1:8788",
            "/healthz": "http://127.0.0.1:8788",
            "/pick-folder": "http://127.0.0.1:8788",
            "/folders": "http://127.0.0.1:8788",
            "/skills": "http://127.0.0.1:8788",
            "/viz": "http://127.0.0.1:8788",
        },
    },
    base: './',
    plugins: [react()],
    optimizeDeps: {
        // New deps mid-session otherwise 504 "Outdated Optimize Dep" until restart.
        include: ['streamdown'],
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
});
