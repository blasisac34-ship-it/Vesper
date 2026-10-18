const { app, BrowserWindow, dialog, shell, ipcMain } = require('electron');
const { DiscordPresence } = require('./discord.cjs');
const { autoUpdater } = require('electron-updater');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');

let serverProcess = null;
let mainWindow = null;
let serverUrl = null;
let updatePromptOpen = false;
const discord = new DiscordPresence();

// Discord application ID: env var, or a discord-client-id.txt file in the app's data folder.
function readDiscordClientId() {
  if (process.env.VESPER_DISCORD_CLIENT_ID) return process.env.VESPER_DISCORD_CLIENT_ID;
  for (const file of [path.join(app.getPath('userData'), 'discord-client-id.txt'), path.join(app.getAppPath(), 'discord-client-id.txt')]) {
    try { const v = fs.readFileSync(file, 'utf8').trim(); if (v) return v; } catch {}
  }
  return null;
}
ipcMain.on('discord:set', (_e, a) => { if (a && typeof a === 'object') discord.set({ title: a.title, artist: a.artist, album: a.album, artwork: a.artwork, start: Number(a.start) || 0, end: Number(a.end) || 0 }); });
ipcMain.on('discord:clear', () => discord.clear());
ipcMain.handle('discord:enable', (_e, on) => { discord.configure(readDiscordClientId()); return discord.setEnabled(on); });
ipcMain.handle('discord:status', () => { discord.configure(readDiscordClientId()); return { ...discord.status(), idFile: path.join(app.getPath('userData'), 'discord-client-id.txt') }; });

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowPrerelease = false;
autoUpdater.logger = console;


function readChangelog() {
  try {
    const file = path.join(app.getAppPath(), 'desktop', 'changelog.json');
    const entries = JSON.parse(fs.readFileSync(file, 'utf8'));
    const current = app.getVersion();
    const entry = entries.find((item) => item.version === current);
    if (!entry) return `Vesper ${current} is ready to use.`;
    return `${entry.title || `Vesper ${current}`}\n\n${(entry.changes || []).map((item) => `• ${item}`).join('\n')}`;
  } catch {
    return `Vesper ${app.getVersion()} is ready to use.`;
  }
}

async function showWhatsNewOnce() {
  const marker = path.join(app.getPath('userData'), 'last-seen-version.txt');
  let lastSeen = '';
  try { lastSeen = fs.readFileSync(marker, 'utf8').trim(); } catch {}
  const current = app.getVersion();
  if (lastSeen === current) return;
  try {
    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: `What's New in Vesper ${current}`,
      message: `Vesper ${current}`,
      detail: readChangelog(),
      buttons: ['Let’s go'],
      defaultId: 0,
      noLink: true,
    });
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, current, 'utf8');
  } catch (err) { console.warn('Could not show Vesper release notes:', err); }
}

async function checkForAppUpdates() {
  if (!app.isPackaged || updatePromptOpen) return;
  try { await autoUpdater.checkForUpdates(); }
  catch (err) { console.warn('Vesper update check failed:', err.message); }
}

autoUpdater.on('update-available', async (info) => {
  if (updatePromptOpen || !mainWindow) return;
  updatePromptOpen = true;
  try {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Vesper update available',
      message: `Vesper ${info.version} is available.`,
      detail: 'Download the update now? Your saved Vesper data will be kept.',
      buttons: ['Download update', 'Later'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (result.response === 0) await autoUpdater.downloadUpdate();
  } catch (err) { console.warn('Could not offer Vesper update:', err.message); }
  finally { updatePromptOpen = false; }
});

autoUpdater.on('update-not-available', () => console.info('Vesper is up to date.'));
autoUpdater.on('error', (err) => console.warn('Vesper updater:', err.message));
autoUpdater.on('update-downloaded', async (info) => {
  if (!mainWindow) return;
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Vesper update ready',
    message: `Vesper ${info.version} has downloaded.`,
    detail: 'Restart Vesper to finish installing the update. Your saved data will be kept.',
    buttons: ['Restart and install', 'Later'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (result.response === 0) autoUpdater.quitAndInstall();
});

function readSharedUrl() {
  const candidates = [
    path.join(app.getPath('userData'), 'server-url.txt'),
    path.join(process.resourcesPath, 'server-url.txt'),
    path.join(app.getAppPath(), 'server-url.txt'),
  ];
  for (const file of candidates) {
    try {
      const value = fs.readFileSync(file, 'utf8').trim();
      if (/^https:\/\//i.test(value)) return value.replace(/\/$/, '');
    } catch {}
  }
  const env = process.env.VESPER_SERVER_URL?.trim();
  return env && /^https:\/\//i.test(env) ? env.replace(/\/$/, '') : null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

function waitForHttp(url, timeoutMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => { res.resume(); resolve(); });
      req.setTimeout(1200, () => req.destroy());
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) reject(new Error('Vesper server did not start in time.'));
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

async function startLocalServer() {
  const port = await freePort();
  const appRoot = app.getAppPath();
  const serverFile = path.join(appRoot, 'server', 'server.mjs');
  const dataDir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  serverProcess = spawn(process.execPath, [serverFile], {
    cwd: appRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', HOST: '127.0.0.1', PORT: String(port), VESPER_DATA_DIR: dataDir },
    stdio: 'ignore',
    windowsHide: true,
  });
  serverProcess.on('error', (err) => console.error('Vesper backend failed:', err));
  serverUrl = `http://127.0.0.1:${port}`;
  await waitForHttp(serverUrl);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320, height: 860, minWidth: 900, minHeight: 620,
    title: 'Vesper', backgroundColor: '#1A1B20',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  });
  mainWindow.loadURL(serverUrl + '/#/home');
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

// First launch: ask whether to connect to a Vesper server or run one on this computer.
const choiceFile = () => path.join(app.getPath('userData'), 'server-url.txt');
function askForServer() {
  return new Promise((resolve) => {
    const win = new BrowserWindow({ width: 560, height: 520, resizable: false, title: 'Set up Vesper', backgroundColor: '#1A1B20', autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.cjs') } });
    ipcMain.handle('setup:server', async (_e, raw) => {
      let url = String(raw || '').trim().replace(/\/+$/, '');
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
      if (!/^https:\/\//i.test(url)) return { ok: false, error: 'Use the https:// address of your server.' };
      try { const r = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(8000) }); const j = await r.json(); if (!j.ok) throw new Error(); }
      catch { return { ok: false, error: 'Couldn’t reach Vesper at that address. Check it and your internet connection.' }; }
      fs.mkdirSync(app.getPath('userData'), { recursive: true }); fs.writeFileSync(choiceFile(), url, 'utf8');
      resolve(url); win.close(); return { ok: true };
    });
    ipcMain.handle('setup:local', () => { fs.mkdirSync(app.getPath('userData'), { recursive: true }); fs.writeFileSync(choiceFile(), 'local', 'utf8'); resolve(null); win.close(); return { ok: true }; });
    win.loadFile(path.join(__dirname, 'setup.html'));
    win.on('closed', () => resolve(undefined));
  });
}

app.whenReady().then(async () => {
  try {
    serverUrl = readSharedUrl();
    let chosen = null; try { chosen = fs.readFileSync(choiceFile(), 'utf8').trim(); } catch {}
    if (!serverUrl && chosen !== 'local' && !process.env.VESPER_LOCAL) {
      const pick = await askForServer();
      if (pick === undefined) { app.quit(); return; }
      serverUrl = pick;
    }
    if (!serverUrl) await startLocalServer();
    await waitForHttp(serverUrl);
    createWindow();
    setTimeout(async () => { await showWhatsNewOnce(); await checkForAppUpdates(); }, 1200);
    setInterval(() => { void checkForAppUpdates(); }, 6 * 60 * 60 * 1000);
  } catch (err) {
    dialog.showErrorBox('Vesper could not start', `${err.message}\n\nIf you are connecting to a shared Vesper server, check the HTTPS address in server-url.txt.`);
    app.quit();
  }
});

app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0 && serverUrl) createWindow(); });
app.on('before-quit', () => { discord.disconnect(); if (serverProcess && !serverProcess.killed) serverProcess.kill(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
