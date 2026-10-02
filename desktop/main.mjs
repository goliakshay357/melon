import { app, BrowserWindow, Menu, ipcMain, dialog, shell } from 'electron';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Melon owns its data dir, isolated from the terminal pi CLI (~/.pi/agent).
const MELON_AGENT_DIR = join(homedir(), '.melon', 'agent');
const SETTINGS_FILE = join(MELON_AGENT_DIR, 'melon', 'settings.json');
const COMPILE_CACHE_DIR = join(MELON_AGENT_DIR, 'compile-cache');
mkdirSync(COMPILE_CACHE_DIR, { recursive: true });

function loadDeveloperDebuggerEnabled() {
    try {
        const raw = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
        return raw?.developerDebugger === true;
    } catch {
        return false;
    }
}

/** Gated by Settings → Developer options → Debugger (default off). */
let developerDebuggerEnabled = loadDeveloperDebuggerEnabled();

function closeDevToolsIfDisabled() {
    if (developerDebuggerEnabled) return;
    for (const win of BrowserWindow.getAllWindows()) {
        if (win.webContents.isDevToolsOpened()) win.webContents.closeDevTools();
    }
}

function isInspectShortcut(input) {
    if (input.type !== 'keyDown') return false;
    const key = String(input.key || '').toLowerCase();
    if (key !== 'i') return false;
    if (process.platform === 'darwin') return Boolean(input.meta && input.alt && !input.control && !input.shift);
    return Boolean(input.control && input.shift && !input.alt && !input.meta);
}

// Spawn the server child on a FREE port (MELON_PORT=0 → OS assigns).
const serverProc = spawn(
    process.execPath,
    [join(__dirname, 'server', 'index.js')],
    {
        env: {
            ...process.env,
            // GUI apps often inherit a thin PATH; Claude Code commonly lives in ~/.local/bin.
            PATH: [
                join(homedir(), '.local', 'bin'),
                '/opt/homebrew/bin',
                '/usr/local/bin',
                process.env.PATH || '',
            ].filter(Boolean).join(':'),
            ELECTRON_RUN_AS_NODE: '1',
            MELON_PORT: '0',
            MELON_CODING_AGENT_DIR: MELON_AGENT_DIR,
            // Persistent V8 module compile cache: first launch writes it, later
            // launches skip re-parsing the server's whole module graph.
            NODE_COMPILE_CACHE: COMPILE_CACHE_DIR,
            // Same version electron-builder stamped into package.json / DMG name.
            MELON_VERSION: app.getVersion(),
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
    ipcMain.on('developer-debugger', (_event, enabled) => {
        developerDebuggerEnabled = enabled === true;
        closeDevToolsIfDisabled();
    });

    const createWindow = () => {
        const win = new BrowserWindow({
            width: 1440,
            height: 900,
            backgroundColor: '#282a36',
            // Distinguish the dev shell from the installed app — multiple
            // Melon instances share the same look, and testing the queue in
            // a stale build makes bugs unreproducible.
            title: 'Melon DEV',
            webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true },
        });
        // NEVER open links inside the app. Any window.open / target=_blank link
        // goes to the OS default browser; in-app navigation is blocked too.
        win.webContents.setWindowOpenHandler(({ url }) => {
            if (/^https?:/i.test(url)) shell.openExternal(url);
            return { action: 'deny' };
        });
        win.webContents.on('will-navigate', (event, url) => {
            try {
                const appOrigin = new URL(win.webContents.getURL()).origin;
                if (new URL(url).origin !== appOrigin) {
                    event.preventDefault();
                    shell.openExternal(url);
                }
            } catch {
                /* malformed URL — ignore */
            }
        });
        win.webContents.on('before-input-event', (event, input) => {
            if (isInspectShortcut(input) && !developerDebuggerEnabled) {
                event.preventDefault();
            }
        });
        win.webContents.on('devtools-opened', () => {
            if (!developerDebuggerEnabled) win.webContents.closeDevTools();
        });
        win.loadURL(`http://127.0.0.1:${serverPort}`);
    };
    app.whenReady().then(() => {
        // DevTools (Cmd+Alt+I / Ctrl+Shift+I) only when Settings → Debugger is on.
        Menu.setApplicationMenu(
            Menu.buildFromTemplate([
                { role: 'appMenu' },
                { role: 'editMenu' },
                {
                    label: 'View',
                    submenu: [
                        { role: 'reload' },
                        {
                            label: 'Toggle Developer Tools',
                            accelerator: process.platform === 'darwin' ? 'Alt+Command+I' : 'Ctrl+Shift+I',
                            click: (_item, focusedWindow) => {
                                if (!developerDebuggerEnabled || !focusedWindow) return;
                                focusedWindow.webContents.toggleDevTools();
                            },
                        },
                        { type: 'separator' },
                        { role: 'resetZoom' },
                        { role: 'zoomIn' },
                        { role: 'zoomOut' },
                    ],
                },
                { role: 'windowMenu' },
            ]),
        );
        createWindow();
    });
}

app.on('window-all-closed', () => {
    serverProc.kill();
    app.quit();
});
