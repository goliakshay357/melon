import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Melon owns its data dir, isolated from the terminal pi CLI (~/.pi/agent).
const MELON_AGENT_DIR = join(homedir(), '.melon', 'agent');

// Spawn the server child on a FREE port (MELON_PORT=0 → OS assigns).
const serverProc = spawn(
    process.execPath,
    [join(__dirname, 'server', 'index.js')],
    {
        env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: '1',
            MELON_PORT: '0',
            MELON_CODING_AGENT_DIR: MELON_AGENT_DIR,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    },
);

let serverPort = null;
let serverLog = '';
const ready = new Promise((resolve) => {
    let outBuf = '';
    const scan = (buf) => {
        // Structured handshake: server prints `MELON_READY {"port":N}` on stdout.
        const m = buf.match(/MELON_READY\s+(\{[^}]+\})/);
        if (m && !serverPort) {
            try {
                serverPort = JSON.parse(m[1]).port;
                resolve();
            } catch {
                /* keep waiting */
            }
        }
    };
    serverProc.stdout.on('data', (d) => {
        outBuf += d;
        scan(outBuf);
    });
    serverProc.stderr.on('data', (d) => {
        serverLog += d;
    });
    serverProc.on('exit', (code) => {
        if (!serverPort) {
            serverLog += `\n[server exited code ${code}]`;
            resolve();
        }
    });
    setTimeout(() => resolve(), 15000);
});

await ready;

if (!serverPort) {
    console.error(`[melon] server failed to start:\n${serverLog}`);
    dialog.showErrorBox('Melon failed to start', serverLog || 'Server did not bind a port.');
    app.quit();
} else {
    console.error(`[melon] server on port ${serverPort}`);
    ipcMain.handle('pick-folder', async () => {
        const r = await dialog.showOpenDialog({ title: 'Choose folder', properties: ['openDirectory'] });
        return r.canceled ? null : r.filePaths[0];
    });

    const createWindow = () => {
        const win = new BrowserWindow({
            width: 1440,
            height: 900,
            backgroundColor: '#282a36',
            webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true },
        });
        // Cmd+Alt+I opens DevTools in the packaged app (for debugging UI).
        win.webContents.on('before-input-event', (event, input) => {
            if (input.type === 'keyDown' && input.key === 'i' && input.meta && input.alt) {
                win.webContents.toggleDevTools();
                event.preventDefault();
            }
        });
        win.loadURL(`http://127.0.0.1:${serverPort}`);
    };
    app.whenReady().then(createWindow);
}

app.on('window-all-closed', () => {
    serverProc.kill();
    app.quit();
});
