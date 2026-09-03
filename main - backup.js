const { app, BrowserWindow, ipcMain, session, Menu, webContents, shell, clipboard, net } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const m3u8Parser = require('m3u8-parser');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');

ffmpeg.setFfmpegPath(ffmpegStatic);

// Enable experimental Chromium network flags to improve video buffering speeds
app.commandLine.appendSwitch('enable-quic');
app.commandLine.appendSwitch('enable-features', 'ParallelDownloading');

const CREDENTIALS_FILE = path.join(app.getPath('userData'), 'pirate_creds.json');
const SETTINGS_FILE = path.join(app.getPath('userData'), 'pirate_settings.json');
const SESSIONS_FILE = path.join(app.getPath('userData'), 'pirate_sessions.json');
const HISTORY_FILE = path.join(app.getPath('userData'), 'pirate_history.json');
const ENCRYPTION_KEY = crypto.scryptSync(app.getPath('userData'), 'salt', 32);

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text) {
  try {
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    return null;
  }
}

function loadCredentials() {
  if (fs.existsSync(CREDENTIALS_FILE)) {
    try {
      const data = fs.readFileSync(CREDENTIALS_FILE, 'utf8');
      const decrypted = decrypt(data);
      return JSON.parse(decrypted);
    } catch (e) {
      return {};
    }
  }
  return {};
}

function saveCredentialsStore(store) {
  const encrypted = encrypt(JSON.stringify(store));
  fs.writeFileSync(CREDENTIALS_FILE, encrypted, 'utf8');
}

function loadAppSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    }
  } catch(e) {}
  return { multiThreadEnabled: false, maxConnections: 4 };
}

function saveAppSettings(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings), 'utf8');
}

let mainWindow;
const downloadsList = [];
const activeProcesses = new Map();
let currentAdblocker = null;

let currentSessionId = Date.now();
let currentSessionStartTime = Date.now();
let sessionsList = [];
const restoredSessions = new Set();

function loadSessions() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      sessionsList = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    }
  } catch(e) {}
}

function saveSessions() {
  try {
    // Keep only the 20 most recent sessions
    if (sessionsList.length > 20) {
      sessionsList = sessionsList.slice(0, 20);
    }
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessionsList), 'utf8');
  } catch(e) {}
}

loadSessions();

let historyLedger = [];

function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      historyLedger = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    }
  } catch(e) {}
}

function saveHistory() {
  try {
    // Keep only the 2000 most recent items
    if (historyLedger.length > 2000) {
      historyLedger = historyLedger.slice(0, 2000);
    }
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(historyLedger), 'utf8');
  } catch(e) {}
}

loadHistory();

async function configureAdblocker(strictness) {
  if (currentAdblocker) {
    currentAdblocker.disableBlockingInSession(session.defaultSession);
    currentAdblocker = null;
  }
  
  if (strictness === 'disabled') {
    return;
  }
  
  try {
    if (strictness === 'standard') {
      currentAdblocker = await ElectronBlocker.fromLists(fetch, [
        'https://easylist.to/easylist/easylist.txt'
      ]);
    } else {
      // strict (recommended)
      currentAdblocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch);
    }
    
    // Polyfill for older Electron versions to prevent crash
    if (!session.defaultSession.registerPreloadScript) {
      session.defaultSession.registerPreloadScript = () => {};
      session.defaultSession.unregisterPreloadScript = () => {};
    }

    currentAdblocker.enableBlockingInSession(session.defaultSession);
    console.log(`Adblocker enabled: ${strictness}`);
  } catch (err) {
    console.error('Failed to configure adblocker:', err);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, 'icon.ico'),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#dee1e6',
      symbolColor: '#5f6368',
      height: 38
    },
    webPreferences: {
      webviewTag: true,
      nodeIntegration: true,
      contextIsolation: false, // For simplicity in our custom UI
      webSecurity: false // Bypass CORS
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.setMenuBarVisibility(false); // Hide the native menu bar but keep accelerators active

  // Initialize Adblocker based on settings
  const settings = loadAppSettings();
  configureAdblocker(settings.adblockStrictness || 'strict');

  // PROTECT onBeforeSendHeaders from Adblocker overwrites
  const origOnBeforeSendHeaders = session.defaultSession.webRequest.onBeforeSendHeaders.bind(session.defaultSession.webRequest);
  let ghosterySendHeadersCb = null;
  
  origOnBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
    details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    
    if (ghosterySendHeadersCb) {
      ghosterySendHeadersCb(details, callback);
    } else {
      callback({ cancel: false, requestHeaders: details.requestHeaders });
    }
  });
  
  session.defaultSession.webRequest.onBeforeSendHeaders = (filter, cb) => {
    if (typeof filter === 'function') ghosterySendHeadersCb = filter;
    else if (cb) ghosterySendHeadersCb = cb;
    else ghosterySendHeadersCb = null;
  };

  // PROTECT onHeadersReceived from Adblocker overwrites
  const origOnHeadersReceived = session.defaultSession.webRequest.onHeadersReceived.bind(session.defaultSession.webRequest);
  let ghosteryHeadersReceivedCb = null;
  const recentVideos = new Map();
  
  origOnHeadersReceived({ urls: ['<all_urls>'] }, (details, callback) => {
    let lowerUrl = details.url.toLowerCase();
    let isVideo = false;
    let videoType = 'Video';
    let cleanUrl = details.url;
    
    // Strip chunking parameters to prevent segment spam
    try {
      const urlObj = new URL(details.url);
      if (urlObj.searchParams.has('bytestart')) urlObj.searchParams.delete('bytestart');
      if (urlObj.searchParams.has('byteend')) urlObj.searchParams.delete('byteend');
      cleanUrl = urlObj.toString();
      lowerUrl = cleanUrl.toLowerCase();
    } catch (e) {}

    // IGNORE DASH/HLS segments. We only want the master manifest (.m3u8 / .mpd) or full videos.
    if (lowerUrl.includes('.m4s') || lowerUrl.includes('.ts') || lowerUrl.includes('/init-') || lowerUrl.includes('init.mp4') || lowerUrl.includes('/seg-')) {
       isVideo = false;
    } else {
       if (lowerUrl.includes('.m3u8') || lowerUrl.includes('.mp4') || lowerUrl.includes('.webm')) {
         isVideo = true;
         videoType = lowerUrl.includes('.m3u8') ? 'HLS Stream' : 'Video';
       }

       if (!isVideo && details.responseHeaders) {
         const contentType = details.responseHeaders['content-type'] || details.responseHeaders['Content-Type'];
         if (contentType && contentType[0]) {
           const ct = contentType[0].toLowerCase();
           if (ct.includes('video/') || ct.includes('mpegurl') || ct.includes('dash+xml')) {
             isVideo = true;
             videoType = (ct.includes('mpegurl') || lowerUrl.includes('.m3u8')) ? 'HLS Stream' : (ct.includes('dash+xml') ? 'DASH Stream' : 'Stream');
           }
         }
       }
    }

    if (isVideo) {
      let sizeStr = 'Unknown Size';
      let sizeBytes = 0;
      
      if (details.responseHeaders) {
        // Try Content-Range first for total size
        const cr = details.responseHeaders['content-range'] || details.responseHeaders['Content-Range'];
        if (cr && cr[0]) {
          const match = cr[0].match(/\/(\d+)$/);
          if (match && match[1]) {
            sizeBytes = parseInt(match[1], 10);
          }
        }
        
        // Fallback to Content-Length
        if (sizeBytes === 0) {
          const cl = details.responseHeaders['content-length'] || details.responseHeaders['Content-Length'];
          if (cl && cl[0]) {
             sizeBytes = parseInt(cl[0], 10);
          }
        }
      }

      if (sizeBytes > 0) {
         if (sizeBytes > 1024*1024) sizeStr = (sizeBytes / (1024*1024)).toFixed(1) + ' MB';
         else sizeStr = (sizeBytes / 1024).toFixed(1) + ' KB';
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        const now = Date.now();
        const lastTime = recentVideos.get(cleanUrl) || 0;
        
        // Hard throttle identical video requests to 1 every 5 seconds per URL
        if (now - lastTime > 5000) {
           recentVideos.set(cleanUrl, now);
           mainWindow.webContents.send('video-detected', { url: cleanUrl, type: videoType, size: sizeStr });
        }
        
        // Prevent memory leak by clearing old cache
        if (recentVideos.size > 1000) recentVideos.clear();
      }
    }

    if (ghosteryHeadersReceivedCb) {
      ghosteryHeadersReceivedCb(details, callback);
    } else {
      callback({ cancel: false, responseHeaders: details.responseHeaders });
    }
  });

  session.defaultSession.webRequest.onHeadersReceived = (filter, cb) => {
    if (typeof filter === 'function') ghosteryHeadersReceivedCb = filter;
    else if (cb) ghosteryHeadersReceivedCb = cb;
    else ghosteryHeadersReceivedCb = null;
  };

  // Track native downloads (e.g. clicking a download link or the Save As dialog)
  session.defaultSession.on('will-download', (event, item, wc) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('download-started', { wcId: wc.id, url: item.getURL() });
    }

    const win = BrowserWindow.fromWebContents(wc);
    if (win && win !== mainWindow) {
      event.preventDefault(); // Cancel download for this window
      const url = item.getURL();
      const filename = item.getFilename();
      win.close(); // Close the blank popup window
      
      const settings = loadAppSettings();
      if (settings.multiThreadEnabled) {
        startCustomMultiThreadDownload(url, filename, settings.maxConnections);
      } else {
        mainWindow.webContents.downloadURL(url);
      }
      return;
    }

    const settings = loadAppSettings();
    if (settings.multiThreadEnabled) {
      event.preventDefault(); // Intercept and cancel single-threaded native download
      startCustomMultiThreadDownload(item.getURL(), item.getFilename(), settings.maxConnections);
      return;
    }

    const downloadId = Date.now() + Math.floor(Math.random() * 1000);
    const downloadEntry = {
      id: downloadId,
      url: item.getURL(),
      quality: 'Native File',
      filename: item.getFilename(),
      savePath: path.join(app.getPath('downloads'), item.getFilename()),
      progress: 0,
      status: 'Downloading',
      received: 0,
      total: 0,
      speed: 0,
      lastTime: Date.now(),
      lastBytes: 0
    };
    downloadsList.push(downloadEntry);
    
    activeProcesses.set(downloadId, {
      cancel: () => item.cancel()
    });

    item.on('updated', (event, state) => {
      if (state === 'interrupted') {
        downloadEntry.status = 'Interrupted';
      } else if (state === 'progressing') {
        if (item.isPaused()) {
          downloadEntry.status = 'Paused';
        } else {
          const received = item.getReceivedBytes();
          const total = item.getTotalBytes();
          const now = Date.now();
          const timeDiff = (now - downloadEntry.lastTime) / 1000;
          if (timeDiff >= 1) {
            downloadEntry.speed = (received - downloadEntry.lastBytes) / timeDiff;
            downloadEntry.lastTime = now;
            downloadEntry.lastBytes = received;
          }
          downloadEntry.received = received;
          downloadEntry.total = total;
          if (total > 0) {
            downloadEntry.progress = (received / total) * 100;
          }
          downloadEntry.status = 'Downloading';
        }
      }
      webContents.getAllWebContents().forEach(wc => wc.send('download-progress', downloadEntry));
    });

    item.once('done', (event, state) => {
      activeProcesses.delete(downloadId);
      if (state === 'completed') {
        handlePendingRename(downloadEntry);
        downloadEntry.status = 'Completed';
        downloadEntry.progress = 100;
      } else {
        downloadEntry.status = `Failed`;
      }
      webContents.getAllWebContents().forEach(wc => wc.send('download-progress', downloadEntry));
    });
  });
}

app.whenReady().then(() => {
  const template = [
    {
      label: 'App',
      submenu: [
        { label: 'New Window', accelerator: 'CommandOrControl+N', click: () => createWindow() },
        { label: 'New Tab', accelerator: 'CommandOrControl+T', click: () => { const win = BrowserWindow.getFocusedWindow(); if (win) win.webContents.send('shortcut', 'new-tab'); } },
        { label: 'Close Tab', accelerator: 'CommandOrControl+W', click: () => { const win = BrowserWindow.getFocusedWindow(); if (win) win.webContents.send('shortcut', 'close-tab'); } },
        { label: 'Reopen Closed Tab', accelerator: 'CommandOrControl+Shift+T', click: () => { const win = BrowserWindow.getFocusedWindow(); if (win) win.webContents.send('shortcut', 'reopen-tab'); } },
        { label: 'Next Tab', accelerator: 'CommandOrControl+Tab', click: () => { const win = BrowserWindow.getFocusedWindow(); if (win) win.webContents.send('shortcut', 'next-tab'); } },
        { label: 'Previous Tab', accelerator: 'CommandOrControl+Shift+Tab', click: () => { const win = BrowserWindow.getFocusedWindow(); if (win) win.webContents.send('shortcut', 'prev-tab'); } },
        { label: 'Focus URL', accelerator: 'CommandOrControl+L', click: () => { const win = BrowserWindow.getFocusedWindow(); if (win) win.webContents.send('shortcut', 'focus-url'); } },
        { label: 'Go Back', accelerator: 'Alt+Left', click: () => { const win = BrowserWindow.getFocusedWindow(); if (win) win.webContents.send('shortcut', 'back'); } },
        { label: 'Go Forward', accelerator: 'Alt+Right', click: () => { const win = BrowserWindow.getFocusedWindow(); if (win) win.webContents.send('shortcut', 'forward'); } },
        { label: 'Reload', accelerator: 'CommandOrControl+R', click: () => { const win = BrowserWindow.getFocusedWindow(); if (win) win.webContents.send('shortcut', 'reload'); } },
        { label: 'Reload (F5)', accelerator: 'F5', click: () => { const win = BrowserWindow.getFocusedWindow(); if (win) win.webContents.send('shortcut', 'reload'); } },
        { label: 'Hard Reload', accelerator: 'CommandOrControl+Shift+R', click: () => { const win = BrowserWindow.getFocusedWindow(); if (win) win.webContents.send('shortcut', 'hard-reload'); } },
        { label: 'Downloads', accelerator: 'CommandOrControl+J', click: () => { const win = BrowserWindow.getFocusedWindow(); if (win) win.webContents.send('shortcut', 'downloads'); } },
        { label: 'DevTools', accelerator: 'CommandOrControl+Shift+I', click: () => { const win = BrowserWindow.getFocusedWindow(); if (win) { win.webContents.toggleDevTools(); } } },
        { label: 'DevTools (F12)', accelerator: 'F12', click: () => { const win = BrowserWindow.getFocusedWindow(); if (win) { win.webContents.toggleDevTools(); } } }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  createWindow();

  app.on('web-contents-created', (event, contents) => {
    if (contents.getType() === 'webview') {
      contents.setWindowOpenHandler(({ url }) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('open-new-tab', url);
        }
        return { action: 'deny' }; // 100% physically prevents the native popup window
      });
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Safe IPC broadcater to prevent crashes if a tab is closed while downloading
function broadcastDownloadProgress(item) {
  webContents.getAllWebContents().forEach(wc => {
    try {
      if (!wc.isDestroyed()) {
        wc.send('download-progress', item);
      }
    } catch (e) {}
  });
}

// IPC Handler for downloading video
ipcMain.handle('start-download', async (event, { url, quality, referer, title }) => {
  // Clean URL to prevent fetching raw byte-chunks (fixes Instagram/FB videos)
  try {
    const urlObj = new URL(url);
    if (urlObj.searchParams.has('bytestart')) urlObj.searchParams.delete('bytestart');
    if (urlObj.searchParams.has('byteend')) urlObj.searchParams.delete('byteend');
    url = urlObj.toString();
  } catch (e) {}

  console.log(`Starting download for ${url} at ${quality} quality`);
  
  const downloadsFolder = app.getPath('downloads');
  const timestamp = Date.now();
  
  // Clean the title to be filesystem safe
  let safeTitle = (title || 'pirate_video').replace(/[^a-zA-Z0-9]/gi, '_').toLowerCase();
  if (safeTitle.length > 60) safeTitle = safeTitle.substring(0, 60);
  if (safeTitle.endsWith('_')) safeTitle = safeTitle.replace(/_+$/, '');
  
  const filename = `${safeTitle}_${timestamp}.mp4`;
  const outputPath = path.join(downloadsFolder, filename);

  const downloadItem = { id: timestamp, url, quality, filename, savePath: outputPath, progress: 0, status: 'Starting', received: 0, total: 0, speed: 0 };
  downloadsList.push(downloadItem);

  return new Promise((resolve) => {
    const isHls = url.includes('.m3u8') || url.includes('.ts');
    let headersObj = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };
    if (referer) headersObj['Referer'] = referer;

    if (!isHls) {
      // Use native Fetch for standard files (MP4, WEBM, etc) instead of ffmpeg
      resolve({ success: true, message: `Downloading to ${outputPath}` });
      downloadItem.status = 'Downloading';
      
      (async () => {
        try {
          const response = await fetch(url, { headers: headersObj });
          if (!response.ok) throw new Error(`HTTP error ${response.status}`);
          
          const totalSize = parseInt(response.headers.get('content-length'), 10) || 0;
          downloadItem.total = totalSize;
          
          const fs = require('fs');
          const fileStream = fs.createWriteStream(outputPath);
          const { Readable } = require('stream');
          const nodeStream = Readable.fromWeb(response.body);
          
          let received = 0;
          let lastTime = Date.now();
          let lastReceived = 0;
          
          activeProcesses.set(timestamp, {
            cancel: () => { nodeStream.destroy(); fileStream.close(); }
          });
          
          nodeStream.on('data', (chunk) => {
            received += chunk.length;
            downloadItem.received = received;
            if (totalSize) downloadItem.progress = (received / totalSize) * 100;
            
            const now = Date.now();
            if (now - lastTime > 1000) {
               downloadItem.speed = (received - lastReceived) / ((now - lastTime) / 1000);
               lastTime = now;
               lastReceived = received;
               broadcastDownloadProgress(downloadItem);
            }
          });
          
          nodeStream.pipe(fileStream);
          
          nodeStream.on('end', () => {
             fileStream.close();
             activeProcesses.delete(timestamp);
             handlePendingRename(downloadItem);
             downloadItem.status = 'Completed';
             downloadItem.progress = 100;
             broadcastDownloadProgress(downloadItem);
          });
          
          nodeStream.on('error', (err) => {
             fileStream.close();
             activeProcesses.delete(timestamp);
             downloadItem.status = 'Error: ' + err.message;
             broadcastDownloadProgress(downloadItem);
          });
        } catch (err) {
          activeProcesses.delete(timestamp);
          downloadItem.status = 'Error: ' + err.message;
          broadcastDownloadProgress(downloadItem);
        }
      })();
      return;
    }

    // FFMPEG Fallback for HLS/m3u8 Streams
    let headers = 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36\r\n';
    if (referer) headers += `Referer: ${referer}\r\n`;

    const cmd = ffmpeg(url)
      // Custom headers to bypass protections
      .addInputOption('-headers', headers)
      .outputOptions('-c copy') // Copy streams directly (very fast, no re-encoding)
      .outputOptions('-movflags +faststart'); // Ensure fast start by moving moov atom
      
    if (isHls) {
      cmd.outputOptions('-bsf:a aac_adtstoasc'); // Required for some HLS audio
    }

    activeProcesses.set(timestamp, {
      cancel: () => cmd.kill('SIGKILL')
    });

    cmd.on('start', (commandLine) => {
        downloadItem.status = 'Downloading';
        console.log('Spawned Ffmpeg with command: ' + commandLine);
        resolve({ success: true, message: `Downloading to ${outputPath}` });
      })
      .on('progress', (progress) => {
        downloadItem.progress = progress.percent || 0;
        downloadItem.received = (progress.targetSize || 0) * 1024; // KB to Bytes
        if (progress.percent && progress.percent > 0) {
          downloadItem.total = downloadItem.received / (progress.percent / 100);
        }
        downloadItem.speed = (progress.currentKbps || 0) * 1024 / 8; // Kbps to Bytes/s
        
        broadcastDownloadProgress(downloadItem);
      })
      .on('error', (err, stdout, stderr) => {
        activeProcesses.delete(timestamp);
        downloadItem.status = 'Error: ' + err.message;
        console.error('An error occurred: ' + err.message);
        broadcastDownloadProgress(downloadItem);
      })
      .on('end', () => {
        activeProcesses.delete(timestamp);
        handlePendingRename(downloadItem);
        downloadItem.status = 'Completed';
        downloadItem.progress = 100;
        console.log('Processing finished!');
        broadcastDownloadProgress(downloadItem);
      })
      .save(outputPath);
  });
});

ipcMain.handle('get-downloads', () => {
  return downloadsList;
});

ipcMain.handle('remove-download', (event, id) => {
  const idx = downloadsList.findIndex(d => d.id === id);
  if (idx !== -1) {
    const removedItem = downloadsList[idx];
    downloadsList.splice(idx, 1);
    removedItem.status = 'Removed';
    broadcastDownloadProgress(removedItem);
  }
  
  if (activeProcesses.has(id)) {
    const processObj = activeProcesses.get(id);
    if (processObj && typeof processObj.cancel === 'function') {
      try { processObj.cancel(); } catch(e) {}
    }
    activeProcesses.delete(id);
  }
  return true;
});

let liveTabs = [];

ipcMain.handle('save-session', (event, tabsData) => {
  liveTabs = tabsData || [];
  if (!tabsData || tabsData.length === 0) return;
  
  // Find if current session already exists
  let sessionIndex = sessionsList.findIndex(s => s.id === currentSessionId);
  
  const sessionObj = {
    id: currentSessionId,
    startTime: currentSessionStartTime,
    lastUpdated: Date.now(),
    tabs: tabsData
  };
  
  if (sessionIndex !== -1) {
    sessionsList[sessionIndex] = sessionObj;
  } else {
    sessionsList.unshift(sessionObj); // Add to beginning
  }
  
  saveSessions();
});

ipcMain.handle('get-sessions', () => {
  return sessionsList.map(s => ({
    ...s,
    restored: restoredSessions.has(s.id)
  }));
});

ipcMain.handle('restore-session', (event, sessionId) => {
  if (restoredSessions.has(sessionId)) return;
  restoredSessions.add(sessionId);
  const sessionToRestore = sessionsList.find(s => s.id === sessionId);
  if (sessionToRestore && sessionToRestore.tabs) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('restore-tabs-batch', sessionToRestore.tabs);
    }
  }
});

ipcMain.handle('get-live-tabs', () => liveTabs);

ipcMain.handle('get-tab-os-metrics', (event, wcId) => {
  const metrics = app.getAppMetrics();
  let osPid = null;
  try {
    const wc = webContents.fromId(wcId);
    if (wc) osPid = wc.getOSProcessId();
  } catch(e) {}
  if (!osPid) return null;
  return metrics.find(m => m.pid === osPid) || null;
});

ipcMain.handle('get-tab-browser-metrics', async (event, wcId) => {
  try {
    const wc = webContents.fromId(wcId);
    if (!wc) return null;
    const result = await wc.executeJavaScript(`
      (() => {
        const resources = performance.getEntriesByType('resource');
        let scripts = 0, css = 0, images = 0;
        resources.forEach(r => {
          if (r.initiatorType === 'script') scripts += r.transferSize || 0;
          if (r.initiatorType === 'link' || r.initiatorType === 'css') css += r.transferSize || 0;
          if (r.initiatorType === 'img') images += r.transferSize || 0;
        });
        const nav = performance.getEntriesByType('navigation')[0];
        const loadTime = nav ? nav.loadEventEnd - nav.startTime : 0;
        return { requests: resources.length, scripts, css, images, loadTime };
      })();
    `);
    return result;
  } catch(e) { return null; }
});

ipcMain.handle('save-history', (event, historyItem) => {
  if (!historyItem || !historyItem.url) return;
  // Prepend to list
  historyLedger.unshift(historyItem);
  saveHistory();
});

ipcMain.handle('get-history', () => {
  return historyLedger;
});

ipcMain.handle('clear-history', (event, urlToDelete = null) => {
  if (urlToDelete) {
    historyLedger = historyLedger.filter(h => h.url !== urlToDelete);
  } else {
    historyLedger = []; // Clear all
  }
  saveHistory();
  return true;
});

ipcMain.handle('rename-download', (event, id, newFilename) => {
  const item = downloadsList.find(d => d.id === id);
  if (!item) return { success: false, error: 'Download not found.' };

  const newPath = path.join(app.getPath('downloads'), newFilename);
  if (fs.existsSync(newPath)) {
    return { success: false, error: 'A file with this name already exists in the Downloads folder.' };
  }

  try {
    if (item.status === 'Completed') {
      if (fs.existsSync(item.savePath)) {
        fs.renameSync(item.savePath, newPath);
      }
      item.savePath = newPath;
      item.filename = newFilename;
    } else {
      item.pendingRenamePath = newPath;
      item.filename = newFilename;
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: 'Failed to rename file: ' + err.message };
  }
});

ipcMain.handle('clear-downloads', () => {
  downloadsList.length = 0;
  for (const [id, processObj] of activeProcesses.entries()) {
    if (processObj && typeof processObj.cancel === 'function') {
      try { processObj.cancel(); } catch(e) {}
    }
  }
  activeProcesses.clear();
  webContents.getAllWebContents().forEach(wc => {
    try { if (!wc.isDestroyed()) wc.send('downloads-cleared'); } catch(e) {}
  });
  return true;
});

ipcMain.handle('open-folder', (event, id) => {
  const item = downloadsList.find(d => d.id === id);
  if (item && item.filename) {
    const filePath = path.join(app.getPath('downloads'), item.filename);
    shell.showItemInFolder(filePath);
  }
});

ipcMain.handle('retry-download', (event, id) => {
  const item = downloadsList.find(d => d.id === id);
  if (!item) return;

  const url = item.url;
  const quality = item.quality;
  
  // Remove the failed item so it isn't duplicated
  const idx = downloadsList.findIndex(d => d.id === id);
  if (idx !== -1) downloadsList.splice(idx, 1);
  
  if (quality === 'Native File' || quality.includes('Multi-Thread')) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.downloadURL(url);
    }
  } else {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('retry-ffmpeg', { url, quality, referer: item.referer || '' });
    }
  }
});

// IPC Handlers for Settings
ipcMain.handle('get-app-settings', () => {
  return loadAppSettings();
});

ipcMain.on('save-app-settings', (event, settings) => {
  const oldSettings = loadAppSettings();
  saveAppSettings(settings);
  if (oldSettings.adblockStrictness !== settings.adblockStrictness) {
    configureAdblocker(settings.adblockStrictness);
  }
});

// IPC Handlers for Credentials
ipcMain.handle('get-credentials', (event, hostname) => {
  const store = loadCredentials();
  return store[hostname] || null;
});

ipcMain.on('save-credentials', (event, { hostname, username, password }) => {
  const store = loadCredentials();
  store[hostname] = { username, password };
  saveCredentialsStore(store);
  console.log(`Saved credentials for ${hostname}`);
});

ipcMain.on('open-new-tab', (event, url) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('open-new-tab', url);
  }
});

// IPC Handler for 3-dots menu
ipcMain.on('show-context-menu', (event) => {
  const template = [
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { type: 'separator' },
    { label: 'History', click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('open-history');
        }
    }},
    { label: 'Downloads', click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('open-downloads');
        }
    }},
    { label: 'Settings', click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('open-settings');
        }
    }},
    { type: 'separator' },
    { role: 'windowMenu' },
    { role: 'help' }
  ];
  const menu = Menu.buildFromTemplate(template);
  menu.popup(BrowserWindow.fromWebContents(event.sender));
});

ipcMain.on('tab-context-menu', (event, tabUrl) => {
  const template = [
    {
      label: 'Duplicate',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('open-new-tab', tabUrl);
        }
      }
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  menu.popup(BrowserWindow.fromWebContents(event.sender));
});

ipcMain.on('webview-context-menu', (event, params) => {
  const { linkURL, srcURL, mediaType } = params;
  const template = [];

  if (linkURL) {
    template.push({
      label: 'Open link in new tab',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('open-new-tab', linkURL);
        }
      }
    });
    template.push({
      label: 'Copy link address',
      click: () => {
        clipboard.writeText(linkURL);
      }
    });
    template.push({ type: 'separator' });
  }

  if (mediaType === 'image' && srcURL) {
    template.push({
      label: 'Copy image address',
      click: () => {
        clipboard.writeText(srcURL);
      }
    });
    template.push({ type: 'separator' });
  }

  if (template.length > 0) {
    const menu = Menu.buildFromTemplate(template);
    menu.popup(BrowserWindow.fromWebContents(event.sender));
  }
});

function broadcastProgress(entry) {
  webContents.getAllWebContents().forEach(wc => wc.send('download-progress', entry));
}

function startCustomMultiThreadDownload(url, originalFilename, maxConnections) {
  const downloadId = Date.now() + Math.floor(Math.random() * 1000);
  const downloadEntry = {
    id: downloadId,
    url: url,
    quality: 'Multi-Threaded',
    filename: originalFilename,
    savePath: path.join(app.getPath('downloads'), originalFilename),
    progress: 0,
    status: 'Starting',
    received: 0,
    total: 0,
    speed: 0,
    lastTime: Date.now(),
    lastBytes: 0
  };
  downloadsList.push(downloadEntry);
  
  activeProcesses.set(downloadId, {
    reqs: [],
    cancel: function() {
      this.reqs.forEach(req => { try { req.abort(); } catch(e){} });
    }
  });
  
  const req = net.request({ method: 'HEAD', url: url });
  activeProcesses.get(downloadId).reqs.push(req);
  
  req.on('response', (res) => {
    const contentLen = res.headers['content-length'] || res.headers['Content-Length'];
    let totalBytes = 0;
    if (contentLen) {
      totalBytes = parseInt(Array.isArray(contentLen) ? contentLen[0] : contentLen, 10);
    }
    
    const acceptRng = res.headers['accept-ranges'] || res.headers['Accept-Ranges'];
    const acceptRangesStr = Array.isArray(acceptRng) ? acceptRng[0] : acceptRng;
    const acceptRanges = acceptRangesStr && acceptRangesStr.includes('bytes');
    
    if (totalBytes > 0 && acceptRanges && maxConnections > 1) {
      downloadEntry.total = totalBytes;
      downloadChunks(url, totalBytes, maxConnections, downloadEntry, originalFilename);
    } else {
      downloadEntry.total = totalBytes || 0;
      downloadSingle(url, downloadEntry, originalFilename);
    }
  });
  req.on('error', () => {
    activeProcesses.delete(downloadId);
    downloadEntry.status = 'Error';
    broadcastProgress(downloadEntry);
  });
  req.end();
}

function downloadChunks(url, totalBytes, numChunks, downloadEntry, filename) {
  const chunkSize = Math.ceil(totalBytes / numChunks);
  const downloadsFolder = app.getPath('downloads');
  const finalPath = path.join(downloadsFolder, filename);
  
  let chunksCompleted = 0;
  let hasError = false;
  const chunkPaths = [];
  
  downloadEntry.status = 'Downloading';
  broadcastProgress(downloadEntry);

  for (let i = 0; i < numChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min((i + 1) * chunkSize - 1, totalBytes - 1);
    const chunkPath = finalPath + `.part${i}`;
    chunkPaths.push(chunkPath);
    
    const req = net.request({ method: 'GET', url: url });
    const processObj = activeProcesses.get(downloadEntry.id);
    if (processObj) processObj.reqs.push(req);
    
    req.setHeader('Range', `bytes=${start}-${end}`);
    req.on('response', (res) => {
      if (res.statusCode !== 206) {
        hasError = true;
        downloadEntry.status = 'Error';
        return;
      }
      const stream = fs.createWriteStream(chunkPath);
      res.on('data', (chunk) => {
        stream.write(chunk);
        downloadEntry.received += chunk.length;
        updateSpeed(downloadEntry);
      });
      res.on('end', () => {
        stream.end();
        chunksCompleted++;
        if (chunksCompleted === numChunks && !hasError) {
          mergeChunks(chunkPaths, finalPath, downloadEntry);
        }
      });
    });
    req.on('error', () => {
      hasError = true;
      activeProcesses.delete(downloadEntry.id);
      downloadEntry.status = 'Error';
      broadcastProgress(downloadEntry);
    });
    req.end();
  }
}

function updateSpeed(entry) {
  const now = Date.now();
  const timeDiff = (now - entry.lastTime) / 1000;
  if (timeDiff >= 1) {
    entry.speed = (entry.received - entry.lastBytes) / timeDiff;
    entry.lastTime = now;
    entry.lastBytes = entry.received;
    if (entry.total > 0) entry.progress = (entry.received / entry.total) * 100;
    broadcastProgress(entry);
  }
}

function mergeChunks(chunkPaths, finalPath, entry) {
  entry.status = 'Merging...';
  broadcastProgress(entry);
  
  const writeStream = fs.createWriteStream(finalPath);
  let currentChunk = 0;
  
  function pipeNext() {
    if (currentChunk >= chunkPaths.length) {
      writeStream.end();
      chunkPaths.forEach(p => { if (fs.existsSync(p)) fs.unlinkSync(p) });
      handlePendingRename(entry);
      entry.status = 'Completed';
      entry.progress = 100;
      activeProcesses.delete(entry.id);
      broadcastProgress(entry);
      return;
    }
    const readStream = fs.createReadStream(chunkPaths[currentChunk]);
    readStream.pipe(writeStream, { end: false });
    readStream.on('end', () => {
      currentChunk++;
      pipeNext();
    });
  }
  pipeNext();
}

function downloadSingle(url, entry, filename) {
  const downloadsFolder = app.getPath('downloads');
  const finalPath = path.join(downloadsFolder, filename);
  
  entry.status = 'Downloading';
  broadcastProgress(entry);

  const req = net.request(url);
  const processObj = activeProcesses.get(entry.id);
  if (processObj) processObj.reqs.push(req);
  
  req.on('response', (res) => {
    if (res.statusCode >= 400) {
      entry.status = 'Error';
      return;
    }
    if (!entry.total) {
      const contentLen = res.headers['content-length'] || res.headers['Content-Length'];
      entry.total = contentLen ? parseInt(Array.isArray(contentLen) ? contentLen[0] : contentLen, 10) : 0;
    }
    
    const stream = fs.createWriteStream(finalPath);
    res.on('data', (chunk) => {
      stream.write(chunk);
      entry.received += chunk.length;
      updateSpeed(entry);
    });
    res.on('end', () => {
      stream.end();
      handlePendingRename(entry);
      entry.status = 'Completed';
      entry.progress = 100;
      activeProcesses.delete(entry.id);
      broadcastProgress(entry);
    });
  });
  req.on('error', () => {
    activeProcesses.delete(entry.id);
    entry.status = 'Error';
    broadcastProgress(entry);
  });
  req.end();
}

function handlePendingRename(item) {
  if (item.pendingRenamePath) {
    try {
      if (!fs.existsSync(item.pendingRenamePath) && fs.existsSync(item.savePath)) {
        fs.renameSync(item.savePath, item.pendingRenamePath);
        item.savePath = item.pendingRenamePath;
      }
    } catch (e) {
      console.error('Pending rename failed:', e);
    }
  }
}
