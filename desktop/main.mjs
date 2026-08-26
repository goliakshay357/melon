import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const serverProc = spawn(process.execPath, [join(__dirname, 'server', 'index.js')], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
});

let serverPort = null;
const ready = new Promise((resolve) => {
    let buf = '';
    serverProc.stdout.on('data', (d) => {
        buf += d;
        const m = buf.match(/127\.0\.0\.1:(\d+)/);
        if (m && !serverPort) { serverPort = +m[1]; resolve(); }
    });
    setTimeout(() => resolve(), 20000);
});

await ready;
console.error(`[melon] server on port ${serverPort}`);

ipcMain.handle('pick-folder', async () => {
    const r = await dialog.showOpenDialog({ title: 'Choose folder', properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
});

function createWindow() {
    const win = new BrowserWindow({
        width: 1440, height: 900,
        backgroundColor: '#282a36',
        webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true },
    });
    win.loadURL(`http://127.0.0.1:${serverPort}`);
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { serverProc.kill(); app.quit(); });
