// Melon desktop — Electron main process.
// 1. spawns the melon-server (compiled) via embedded Node
// 2. serves the built web UI
// 3. opens the window + native folder dialog IPC
import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { fork } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 8788;

// ── 1. spawn melon-server with Electron's embedded Node ──
const serverProc = fork(join(__dirname, 'server', 'index.js'), {
    env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        MELON_PORT: String(PORT),
    },
    stdio: 'inherit',
});
serverProc.on('exit', (code) => console.error('[melon] server exited', code));

// ── 2. static server for the built web UI ──
const WEB_DIST = join(__dirname, 'web-dist');
const MIME = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.json': 'application/json',
    '.woff2': 'font/woff2',
};

const web = createServer(async (req, res) => {
    try {
        let path = decodeURIComponent((req.url ?? '/').split('?')[0]);
        if (path === '/') path = '/index.html';
        const file = await stat(join(WEB_DIST, path))
            .then(() => join(WEB_DIST, path))
            .catch(() => join(WEB_DIST, 'index.html')); // SPA fallback
        res.writeHead(200, {
            'content-type': MIME[extname(file)] ?? 'application/octet-stream',
            'access-control-allow-origin': '*',
        });
        res.end(await readFile(file));
    } catch {
        res.writeHead(500);
        res.end();
    }
});
await new Promise((r) => web.listen(PORT + 1, '127.0.0.1', r));
console.error(`[melon] ui on http://127.0.0.1:${PORT + 1}`);

// ── 3. native folder picker IPC ──
ipcMain.handle('pick-folder', async () => {
    const res = await dialog.showOpenDialog({
        title: 'Choose a folder for your melon canvas',
        properties: ['openDirectory'],
    });
    return res.canceled ? null : res.filePaths[0];
});

// ── 4. window ──
function createWindow() {
    const win = new BrowserWindow({
        width: 1440,
        height: 900,
        backgroundColor: '#282a36',
        webPreferences: {
            preload: join(__dirname, 'preload.cjs'),
            contextIsolation: true,
        },
    });
    win.loadURL(`http://127.0.0.1:${PORT + 1}`);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
    serverProc.kill();
    web.close();
    app.quit();
});
