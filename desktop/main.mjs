import { app, BrowserWindow, Menu, ipcMain, dialog, shell } from 'electron';
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, statSync, renameSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Melon owns its data dir, isolated from the terminal pi CLI (~/.pi/agent).
const MELON_AGENT_DIR = join(homedir(), '.melon', 'agent');
const SETTINGS_FILE = join(MELON_AGENT_DIR, 'melon', 'settings.json');
const COMPILE_CACHE_DIR = join(MELON_AGENT_DIR, 'compile-cache');
mkdirSync(COMPILE_CACHE_DIR, { recursive: true });

// Durable logs — Finder/Dock launches have no Terminal; stdout/stderr go nowhere.
// Always write here so crashes are inspectable after the fact.
const LOG_DIR = join(homedir(), 'Library', 'Logs', 'Melon');
const LOG_FILE = join(LOG_DIR, 'melon.log');
const LOG_MAX_BYTES = 5 * 1024 * 1024;
mkdirSync(LOG_DIR, { recursive: true });

function rotateLogIfNeeded() {
	try {
		if (!existsSync(LOG_FILE)) return;
		if (statSync(LOG_FILE).size < LOG_MAX_BYTES) return;
		renameSync(LOG_FILE, `${LOG_FILE}.1`);
	} catch {
		/* best-effort */
	}
}

function stamp() {
	return new Date().toISOString();
}

/** Write a line to melon.log and (when possible) the process streams. */
function logLine(level, msg) {
	const line = `[${stamp()}] [${level}] ${msg.endsWith('\n') ? msg : `${msg}\n`}`;
	try {
		rotateLogIfNeeded();
		appendFileSync(LOG_FILE, line);
	} catch {
		/* disk full / permissions — still try console */
	}
	// Finder launches have no TTY; Terminal launches do. Always attempt write.
	try {
		if (level === 'error' || level === 'warn') process.stderr.write(line);
		else process.stdout.write(line);
	} catch {
		/* streams closed */
	}
}

const log = {
	info: (m) => logLine('info', m),
	warn: (m) => logLine('warn', m),
	error: (m) => logLine('error', m),
};

// Session header so each launch is obvious in the log file.
log.info(`======== Melon ${app.getVersion()} starting pid=${process.pid} packaged=${app.isPackaged} ========`);
log.info(`log file: ${LOG_FILE}`);
log.info(`agent dir: ${MELON_AGENT_DIR}`);

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

function serverEnv() {
	return {
		...process.env,
		// GUI apps often inherit a thin PATH; Claude Code commonly lives in ~/.local/bin.
		PATH: [
			join(homedir(), '.local', 'bin'),
			'/opt/homebrew/bin',
			'/usr/local/bin',
			process.env.PATH || '',
		]
			.filter(Boolean)
			.join(':'),
		ELECTRON_RUN_AS_NODE: '1',
		MELON_PORT: '0',
		MELON_CODING_AGENT_DIR: MELON_AGENT_DIR,
		// Persistent V8 module compile cache: first launch writes it, later
		// launches skip re-parsing the server's whole module graph.
		NODE_COMPILE_CACHE: COMPILE_CACHE_DIR,
		// Same version electron-builder stamped into package.json / DMG name.
		MELON_VERSION: app.getVersion(),
	};
}

/**
 * Keep a rolling tail of server output so exit handlers can dump the real
 * crash reason even when the user wasn't watching Terminal.
 */
function makeRing(maxChars = 64 * 1024) {
	let buf = '';
	return {
		push(chunk) {
			buf += chunk;
			if (buf.length > maxChars) buf = buf.slice(buf.length - maxChars);
		},
		text() {
			return buf;
		},
	};
}

/**
 * Spawn melon-server as ELECTRON_RUN_AS_NODE child. Resolves with { proc, port }
 * once MELON_READY is printed, or rejects if the child exits / times out.
 */
function spawnServer() {
	const serverPath = join(__dirname, 'server', 'index.js');
	log.info(`spawning server: ${process.execPath} ${serverPath}`);
	const proc = spawn(process.execPath, [serverPath], {
		env: serverEnv(),
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	log.info(`server child pid=${proc.pid}`);

	let settled = false;
	let port = null;
	const outRing = makeRing();
	const errRing = makeRing();

	const result = new Promise((resolve, reject) => {
		const finishOk = () => {
			if (settled) return;
			settled = true;
			resolve({ proc, port, errBuf: errRing.text() });
		};
		const finishErr = (msg) => {
			if (settled) return;
			settled = true;
			reject(new Error(msg));
		};

		proc.stdout.on('data', (d) => {
			const chunk = String(d);
			outRing.push(chunk);
			// Prefix so server lines are greppable in melon.log
			for (const line of chunk.split(/\r?\n/)) {
				if (line.length) log.info(`[server:out] ${line}`);
			}
			const m = outRing.text().match(/MELON_READY\s+(\{[^}]+\})/);
			if (m && !port) {
				try {
					port = JSON.parse(m[1]).port;
					log.info(`server ready on port ${port}`);
					finishOk();
				} catch (e) {
					log.warn(`MELON_READY parse failed: ${e instanceof Error ? e.message : String(e)}`);
				}
			}
		});
		proc.stderr.on('data', (d) => {
			const chunk = String(d);
			errRing.push(chunk);
			for (const line of chunk.split(/\r?\n/)) {
				if (line.length) log.error(`[server:err] ${line}`);
			}
		});
		proc.on('error', (err) => {
			log.error(`server spawn error: ${err.message}`);
			finishErr(`server spawn failed: ${err.message}`);
		});
		proc.on('exit', (code, signal) => {
			const detail =
				errRing.text().trim() ||
				outRing.text().trim() ||
				'(no server stdout/stderr — process exited silently)';
			const summary = `server exited code=${code} signal=${signal} pid=${proc.pid} port=${port ?? 'never-ready'}`;
			log.error(summary);
			log.error(`--- last server output ---\n${detail}\n--- end ---`);
			// Persist a dedicated crash snapshot next to the rolling log.
			try {
				const crashPath = join(LOG_DIR, `server-crash-${Date.now()}.log`);
				writeFileSync(
					crashPath,
					[
						`time: ${stamp()}`,
						`version: ${app.getVersion()}`,
						summary,
						'',
						'--- stderr+stdout tail ---',
						detail,
						'',
					].join('\n'),
				);
				log.error(`crash snapshot: ${crashPath}`);
			} catch (e) {
				log.warn(`could not write crash snapshot: ${e instanceof Error ? e.message : String(e)}`);
			}
			if (!port) {
				finishErr(`${summary}\n${detail}`);
				return;
			}
			// After ready: parent must notice — otherwise the UI keeps hitting a dead port.
			onServerDied(code, signal, detail);
		});
		setTimeout(() => {
			if (!port) {
				finishErr(
					`server did not become ready within 15s\n${errRing.text() || outRing.text() || '(no output)'}`,
				);
			}
		}, 15000);
	});

	return { proc, ready: result };
}

let serverProc = null;
let serverPort = null;
let restarting = false;
let quitting = false;

function reloadAllWindows(port) {
	for (const win of BrowserWindow.getAllWindows()) {
		win.loadURL(`http://127.0.0.1:${port}`);
	}
}

async function onServerDied(code, signal, detail) {
	if (quitting || restarting) return;
	restarting = true;
	log.error(`attempting server restart after code=${code} signal=${signal}…`);
	try {
		const next = spawnServer();
		serverProc = next.proc;
		const { port } = await next.ready;
		serverPort = port;
		log.info(`server restarted on port ${serverPort}`);
		reloadAllWindows(serverPort);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		log.error(`server restart failed:\n${msg}`);
		dialog.showErrorBox(
			'Melon server crashed',
			`The backend exited (code=${code}, signal=${signal}) and could not be restarted.\n\nLog: ${LOG_FILE}\n\n${msg.slice(0, 1500)}`,
		);
		quitting = true;
		app.quit();
	} finally {
		restarting = false;
	}
}

const first = spawnServer();
serverProc = first.proc;

try {
	const { port } = await first.ready;
	serverPort = port;
} catch (e) {
	const msg = e instanceof Error ? e.message : String(e);
	log.error(`server failed to start:\n${msg}`);
	dialog.showErrorBox('Melon failed to start', `Log: ${LOG_FILE}\n\n${msg.slice(0, 1500)}`);
	app.quit();
}

if (serverPort) {
	log.info(`UI loading http://127.0.0.1:${serverPort}`);
	ipcMain.handle('pick-folder', async () => {
		const r = await dialog.showOpenDialog({ title: 'Choose folder', properties: ['openDirectory'] });
		return r.canceled ? null : r.filePaths[0];
	});
	ipcMain.handle('get-log-path', () => LOG_FILE);
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
			// Melon instances share the same look, and testing the void in
			// a stale build makes bugs unreproducible.
			title: app.isPackaged ? 'Melon' : 'Melon DEV',
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
		win.webContents.on('render-process-gone', (_event, details) => {
			log.error(`renderer gone: reason=${details.reason} exitCode=${details.exitCode}`);
		});
		win.webContents.on('unresponsive', () => {
			log.warn('renderer unresponsive');
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
						{
							label: 'Open Melon Log',
							click: () => {
								shell.openPath(LOG_FILE).catch(() => shell.showItemInFolder(LOG_FILE));
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
	quitting = true;
	log.info('window-all-closed — quitting');
	try {
		serverProc?.kill();
	} catch {
		/* already dead */
	}
	app.quit();
});

process.on('uncaughtException', (err) => {
	log.error(`uncaughtException: ${err?.stack || err}`);
});
process.on('unhandledRejection', (reason) => {
	log.error(`unhandledRejection: ${reason instanceof Error ? reason.stack : String(reason)}`);
});
