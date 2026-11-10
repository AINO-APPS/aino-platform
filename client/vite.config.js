import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { getWebBuildVersion } from './scripts/build-version.mjs';

const webBuildVersion = getWebBuildVersion();

export default defineConfig({
    plugins: [react(), {
        name: 'bundled-web-version',
        generateBundle() {
            this.emitFile({ type: 'asset', fileName: 'client-version.json', source: JSON.stringify({ version: webBuildVersion }) });
        },
    }],
    define: { 'import.meta.env.VITE_WEB_BUILD_VERSION': JSON.stringify(webBuildVersion) },
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: './src/test-setup.ts',
    },
    build: {
        modulePreload: { polyfill: false },
        crossOriginLoading: false,
    },
    server: {
        port: 3000,
        proxy: {
            '/api': 'http://localhost:5000',
            '/uploads': 'http://localhost:5000',
            '/ws': {
                target: 'ws://localhost:5000',
                ws: true
            },
            '/collab': {
                target: 'ws://localhost:5000',
                ws: true
            }
        },
    }
});
