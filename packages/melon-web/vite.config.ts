import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
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
        },
    },
    base: './',
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
});
