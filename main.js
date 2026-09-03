const { app, BrowserWindow, ipcMain, session, Menu, webContents, shell, clipboard, net, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
let ffmpegStatic = require('ffmpeg-static');
const m3u8Parser = require('m3u8-parser');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');
let youtubedl = require('youtube-dl-exec');

if (ffmpegStatic.includes('app.asar')) {
  ffmpegStatic = ffmpegStatic.replace('app.asar', 'app.asar.unpacked');
}
ffmpeg.setFfmpegPath(ffmpegStatic);

let ytdlPath = youtubedl.constants.YOUTUBE_DL_PATH;
if (ytdlPath.includes('app.asar')) {
  ytdlPath = ytdlPath.replace('app.asar', 'app.asar.unpacked');
  youtubedl = youtubedl.create(ytdlPath);
}

// Enable experimental Chromium network flags to improve video buffering speeds
app.commandLine.appendSwitch('enable-quic');
app.commandLine.appendSwitch('enable-features', 'ParallelDownloading');

const origUserData = app.getPath('userData');
if (!origUserData.endsWith(app.getVersion()) && !origUserData.endsWith(`v${app.getVersion()}`)) {
  app.setPath('userData', path.join(origUserData, `v${app.getVersion()}`));
}

const appDataPath = app.getPath('userData');
const CREDENTIALS_FILE = path.join(appDataPath, 'credentials.json');
const SETTINGS_FILE = path.join(appDataPath, 'settings.json');
const SESSIONS_FILE = path.join(app.getPath('userData'), 'pirate_sessions.json');
const HISTORY_FILE = path.join(app.getPath('userData'), 'pirate_history.json');
const WEBTESTING_FILE = path.join(app.getPath('userData'), 'pirate_webtesting.json');
const ENCRYPTION_KEY = crypto.scryptSync(app.getPath('userData'), 'salt', 32);

app.userAgentFallback = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

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

let cachedSettings = null;

function loadAppSettings() {
  if (cachedSettings) return cachedSettings;
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      cachedSettings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      return cachedSettings;
    }
  } catch(e) {}
  cachedSettings = { multiThreadEnabled: false, maxConnections: 4, developerMode: false, useYtDlp: false };
  return cachedSettings;
}

function saveAppSettings(settings) {
  cachedSettings = settings;
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings), 'utf8');
}

let mainWindow;
const downloadsList = [];
const activeProcesses = new Map();
let currentAdblocker = null;

let isPeeking = false;
let peekedUrls = [];

const fbStreams = new Map(); // FB Video ID -> { audioUrl, videoUrl, emitted: boolean }
let detectedMediaList = []; // Global list of detected media

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

let webtestingProfiles = [];

function loadWebtestingProfiles() {
  try {
    if (fs.existsSync(WEBTESTING_FILE)) {
      webtestingProfiles = JSON.parse(fs.readFileSync(WEBTESTING_FILE, 'utf8'));
    }
  } catch(e) {}
}

function saveWebtestingProfiles() {
  try {
    fs.writeFileSync(WEBTESTING_FILE, JSON.stringify(webtestingProfiles), 'utf8');
  } catch(e) {}
}

loadWebtestingProfiles();


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

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      mainWindow.webContents.send('inspect-active-tab');
      event.preventDefault();
    }
  });

  // Initialize Adblocker based on settings
  const settings = loadAppSettings();
  configureAdblocker(settings.adblockStrictness || 'strict');

  // PROTECT onBeforeSendHeaders from Adblocker overwrites
  const origOnBeforeSendHeaders = session.defaultSession.webRequest.onBeforeSendHeaders.bind(session.defaultSession.webRequest);
  let ghosterySendHeadersCb = null;

  let activeAuthSession = false;
  let authHeadersCaptured = {};

  ipcMain.handle('start-auth-session', () => {
    activeAuthSession = true;
    authHeadersCaptured = {};
  });

  ipcMain.handle('finish-auth-session', () => {
    activeAuthSession = false;
    return authHeadersCaptured;
  });

  ipcMain.handle('get-profile', (event, profileId) => {
    return webtestingProfiles.find(p => p.id === profileId);
  });
  
  origOnBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
    const headerNames = Object.keys(details.requestHeaders);
    
    for (const name of headerNames) {
      const lowerName = name.toLowerCase();
      if (['user-agent', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'accept-language'].includes(lowerName)) {
        delete details.requestHeaders[name];
      }
    }

    details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
    details.requestHeaders['sec-ch-ua'] = '"Chromium";v="152", "Not?A_Brand";v="24", "Google Chrome";v="152"';
    details.requestHeaders['sec-ch-ua-mobile'] = '?0';
    details.requestHeaders['sec-ch-ua-platform'] = '"Windows"';
    details.requestHeaders['Accept-Language'] = 'en-IN,en-GB;q=0.9,en-US;q=0.8,en;q=0.7,ml;q=0.6';

    const settings = loadAppSettings();
    if (settings && settings.stealthEnabled && settings.stealthConfig) {
      if (settings.stealthConfig.ipAddress) {
        details.requestHeaders['X-Forwarded-For'] = settings.stealthConfig.ipAddress;
        details.requestHeaders['X-Real-IP'] = settings.stealthConfig.ipAddress;
        details.requestHeaders['Client-IP'] = settings.stealthConfig.ipAddress;
      }
      if (settings.stealthConfig.httpHost) {
        details.requestHeaders['Host'] = settings.stealthConfig.httpHost;
      }
    }
    
    // Restore X-Pirate headers to bypass renderer fetch restrictions
    const headerNames2 = Object.keys(details.requestHeaders);
    for (const name of headerNames2) {
      const lowerName = name.toLowerCase();
      if (lowerName.startsWith('x-pirate-')) {
        const realName = name.substring(9);
        details.requestHeaders[realName] = details.requestHeaders[name];
        delete details.requestHeaders[name];
      }
    }
    
    if (activeAuthSession && details.url) {
      try {
        const urlObj = new URL(details.url);
        const domain = urlObj.hostname;
        const headersToCapture = ['cookie', 'authorization', 'x-csrf-token', 'x-xsrf-token'];
        
        if (!authHeadersCaptured[domain]) authHeadersCaptured[domain] = {};
        
        for (const [key, value] of Object.entries(details.requestHeaders)) {
          if (headersToCapture.includes(key.toLowerCase())) {
            authHeadersCaptured[domain][key.toLowerCase()] = value;
          }
        }
      } catch (e) {}
    }

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

  const recentMediaRequests = new Map();

  function emitDetectedVideoRaw(details, url, type = 'Video', size = 'Unknown Size') {
    if (!mainWindow || mainWindow.isDestroyed() || !url) return;

    // Filter out video segments to reduce spam
    try {
      const lowerUrl = url.toLowerCase();
      const urlObj = new URL(url);
      const pathname = urlObj.pathname.toLowerCase();
      if (pathname.endsWith('.ts') || pathname.endsWith('.m4s') || lowerUrl.includes('.ts?') || lowerUrl.includes('.m4s?')) {
          return;
      }
    } catch(e) {}

    const now = Date.now();
    const wcId = details && details.webContentsId ? details.webContentsId : null;
    const key = `${wcId || 'unknown'}:${url}`;
    const lastTime = recentMediaRequests.get(key) || 0;
    if (now - lastTime <= 5000) return;

    recentMediaRequests.set(key, now);
    if (recentMediaRequests.size > 1000) recentMediaRequests.clear();
    
    let title = 'Detected Media';
    let sourcePage = '';
    if (wcId) {
       const wc = webContents.fromId(wcId);
       if (wc) {
           title = wc.getTitle();
           sourcePage = wc.getURL();
       }
    }

    // Deduplicate Master vs Variant
    const isMaster = type.includes('Master/Auto');
    if (sourcePage) {
        if (isMaster) {
            // Remove any non-master HLS variants for the same source page
            detectedMediaList = detectedMediaList.filter(m => !(m.sourcePage === sourcePage && m.type.includes('HLS Stream') && !m.type.includes('Master/Auto')));
        } else if (type.includes('HLS Stream')) {
            // If a master already exists for this source page, ignore this variant
            const hasMaster = detectedMediaList.some(m => m.sourcePage === sourcePage && m.type.includes('Master/Auto'));
            if (hasMaster) return;
        }
    }
    
    // Add to global list if not already present
    if (!detectedMediaList.find(m => m.url === url)) {
        detectedMediaList.unshift({
           url, type, size, wcId, title, timestamp: now, sourcePage
        });
        if (detectedMediaList.length > 200) {
           detectedMediaList = detectedMediaList.slice(0, 200);
        }
    }

    mainWindow.webContents.send('video-detected', { url, type, size, wcId, title, sourcePage });
  }

  function emitDetectedVideo(details, url, type = 'Video', size = 'Unknown Size') {
    if (url.toLowerCase().includes('.m3u8') || type.includes('HLS') || type.includes('DASH')) {
        if (!type.includes('HLS Stream') && !type.includes('DASH Stream')) {
            type = url.toLowerCase().includes('.m3u8') ? 'HLS Stream' : 'DASH Stream';
        }
        fetchAndParseM3u8(details, url, type, size);
    } else {
        emitDetectedVideoRaw(details, url, type, size);
    }
  }

  ipcMain.handle('get-detected-media', () => detectedMediaList);
  
  ipcMain.on('update-media-title', (event, data) => {
    let updated = false;
    detectedMediaList.forEach(m => {
       if (m.wcId === data.wcId && (!m.title || m.title === 'Detected Media' || m.title === 'New Tab')) {
           m.title = data.title;
           updated = true;
       }
    });
    if (updated) {
       mainWindow.webContents.send('media-titles-updated', detectedMediaList);
    }
  });

  ipcMain.on('clear-detected-media', () => {
    detectedMediaList = [];
  });
  ipcMain.on('remove-detected-media', (event, urlsToRemove) => {
    if (Array.isArray(urlsToRemove)) {
      detectedMediaList = detectedMediaList.filter(m => !urlsToRemove.includes(m.url));
    } else {
      detectedMediaList = detectedMediaList.filter(m => m.url !== urlsToRemove);
    }
  });

  ipcMain.on('page-media-detected', (event, payload = {}) => {
    const url = payload.url || '';
    const type = payload.type || 'Page Media';
    if (!url || url.startsWith('blob:') || url.startsWith('data:')) return;
    emitDetectedVideo({ webContentsId: event.sender.id }, url, type, payload.size || 'Unknown Size');
  });

  const origOnBeforeRequest = session.defaultSession.webRequest.onBeforeRequest.bind(session.defaultSession.webRequest);
  let ghosteryBeforeRequestCb = null;

  const sniffingUrls = new Set();
  const globalHlsMap = new Map();

  function fetchAndParseM3u8(details, cleanUrl, videoType, sizeStr) {
      if (!videoType.includes('HLS Stream')) {
          const resMatch = cleanUrl.toLowerCase().match(/(1080p?|720p?|480p?|360p?|240p?|144p?|1920x1080|1280x720|854x480|640x360|426x240)/);
          if (resMatch) {
              let res = resMatch[1].replace('1920x1080', '1080p').replace('1280x720', '720p').replace('854x480', '480p').replace('640x360', '360p').replace('426x240', '240p');
              if (!res.endsWith('p') && res.match(/^\d+$/)) res += 'p';
              videoType += ` (${res})`;
          }
          if (mainWindow && !mainWindow.isDestroyed()) emitDetectedVideoRaw(details, cleanUrl, videoType, sizeStr);
          return;
      }

      const cleanVariant = cleanUrl.split('?')[0];
      let fallbackType = videoType;
      
      // Try URL-based matching first as a fallback
      const resMatch = cleanUrl.toLowerCase().match(/(1080p?|720p?|480p?|360p?|240p?|144p?|1920x1080|1280x720|854x480|640x360|426x240)/);
      if (resMatch) {
          let res = resMatch[1].replace('1920x1080', '1080p').replace('1280x720', '720p').replace('854x480', '480p').replace('640x360', '360p').replace('426x240', '240p');
          if (!res.endsWith('p') && res.match(/^\d+$/)) res += 'p';
          fallbackType += ` (${res})`;
      } else if (cleanUrl.toLowerCase().includes('master') || cleanUrl.toLowerCase().includes('index')) {
          fallbackType += ' (Master/Auto)';
      }

      if (globalHlsMap.has(cleanVariant)) {
          if (mainWindow && !mainWindow.isDestroyed()) emitDetectedVideoRaw(details, cleanUrl, videoType + ` (${globalHlsMap.get(cleanVariant)})`, sizeStr);
          return;
      }

      if (sniffingUrls.has(cleanUrl)) {
          return;
      }

      sniffingUrls.add(cleanUrl);
      setTimeout(() => sniffingUrls.delete(cleanUrl), 15000);

      try {
          const req = net.request({ url: cleanUrl, session: session.defaultSession, useSessionCookies: true });
          if (details.requestHeaders && details.requestHeaders['Referer']) {
              req.setHeader('Referer', details.requestHeaders['Referer']);
          }
          req.on('response', (response) => {
              let body = '';
              response.on('data', (chunk) => body += chunk);
              response.on('end', () => {
                  let isMaster = false;
                  let availableRes = [];
                  const lines = body.split('\n');
                  let nextRes = null;
                  
                  for (let i = 0; i < lines.length; i++) {
                      const line = lines[i].trim();
                      if (line.startsWith('#EXT-X-STREAM-INF:')) {
                          isMaster = true;
                          const resMatch = line.match(/RESOLUTION=(\d+x\d+)/i);
                          if (resMatch) {
                              nextRes = resMatch[1].toLowerCase().replace('1920x1080', '1080p').replace('1280x720', '720p').replace('854x480', '480p').replace('640x360', '360p').replace('426x240', '240p');
                              if (!availableRes.includes(nextRes)) availableRes.push(nextRes);
                          } else {
                              const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
                              if (bwMatch) {
                                  const bw = parseInt(bwMatch[1]);
                                  if (bw > 3000000) nextRes = '1080p';
                                  else if (bw > 1500000) nextRes = '720p';
                                  else if (bw > 800000) nextRes = '480p';
                                  else nextRes = '360p';
                                  if (!availableRes.includes(nextRes)) availableRes.push(nextRes);
                              }
                          }
                      } else if (line && !line.startsWith('#') && nextRes) {
                          try {
                              let variantUrl = new URL(line, cleanUrl).toString();
                              globalHlsMap.set(variantUrl.split('?')[0], nextRes);
                              nextRes = null;
                          } catch (e) {}
                      }
                  }
                  
                  if (isMaster) {
                      let typeStr = videoType + ' (Master/Auto)';
                      if (availableRes.length > 0) typeStr += ' [' + availableRes.join(', ') + ']';
                      if (mainWindow && !mainWindow.isDestroyed()) emitDetectedVideoRaw(details, cleanUrl, typeStr, sizeStr);
                  } else {
                      if (globalHlsMap.has(cleanVariant)) {
                          if (mainWindow && !mainWindow.isDestroyed()) emitDetectedVideoRaw(details, cleanUrl, videoType + ` (${globalHlsMap.get(cleanVariant)})`, sizeStr);
                      } else {
                          if (mainWindow && !mainWindow.isDestroyed()) emitDetectedVideoRaw(details, cleanUrl, fallbackType, sizeStr);
                      }
                  }
              });
          });
          req.on('error', () => {
              if (mainWindow && !mainWindow.isDestroyed()) emitDetectedVideoRaw(details, cleanUrl, fallbackType, sizeStr);
          });
          req.end();
      } catch (e) {
          if (mainWindow && !mainWindow.isDestroyed()) emitDetectedVideoRaw(details, cleanUrl, fallbackType, sizeStr);
      }
  }

  origOnBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    if (details.resourceType === 'media' && !details.url.startsWith('blob:') && !details.url.startsWith('data:')) {
      emitDetectedVideo(details, details.url, 'Media Stream', 'Unknown Size');
    }

    if (ghosteryBeforeRequestCb) {
      ghosteryBeforeRequestCb(details, callback);
    } else {
      callback({ cancel: false });
    }
  });

  session.defaultSession.webRequest.onBeforeRequest = (filter, cb) => {
    if (typeof filter === 'function') ghosteryBeforeRequestCb = filter;
    else if (cb) ghosteryBeforeRequestCb = cb;
    else ghosteryBeforeRequestCb = null;
  };

  // PROTECT onHeadersReceived from Adblocker overwrites
  const origOnHeadersReceived = session.defaultSession.webRequest.onHeadersReceived.bind(session.defaultSession.webRequest);
  let ghosteryHeadersReceivedCb = null;
  
  origOnHeadersReceived({ urls: ['<all_urls>'] }, (details, callback) => {
    let lowerUrl = details.url.toLowerCase();
    let isVideo = false;
    let videoType = 'Video';
    let cleanUrl = details.url;
    
    let handledAsFb = false;
    // Strip chunking parameters to prevent segment spam
    try {
      const urlObj = new URL(details.url);
      if (urlObj.searchParams.has('bytestart')) urlObj.searchParams.delete('bytestart');
      if (urlObj.searchParams.has('byteend')) urlObj.searchParams.delete('byteend');
      cleanUrl = urlObj.toString();
      lowerUrl = cleanUrl.toLowerCase();

      // Facebook Video Stream Extraction
      const efg = urlObj.searchParams.get('efg');
      if (efg) {
        try {
          let base64str = efg.replace(/-/g, '+').replace(/_/g, '/');
          while (base64str.length % 4) { base64str += '='; }
          const decoded = Buffer.from(base64str, 'base64').toString('utf-8');
          const parsed = JSON.parse(decoded);
          if (parsed.video_id && parsed.vencode_tag) {
             handledAsFb = true;
             const vId = parsed.video_id;
             const vencode = parsed.vencode_tag;
             const isAudio = vencode.includes('audio');
             let group = fbStreams.get(vId) || { audios: [], videos: [] };
             
             if (isAudio) {
                 if (!group.audios.find(a => a.url === cleanUrl)) group.audios.push({ vencode, url: cleanUrl });
             } else {
                 if (!group.videos.find(v => v.url === cleanUrl)) group.videos.push({ vencode, url: cleanUrl, emittedNoAudio: false, emittedWithAudio: false });
             }
             fbStreams.set(vId, group);

             const hasAudio = group.audios.length > 0;
             const bestAudio = hasAudio ? group.audios[0].url : '';

             for (let vid of group.videos) {
                 let shouldEmit = false;
                 let typeLabel = '';
                 
                 if (hasAudio && !vid.emittedWithAudio) {
                     vid.emittedWithAudio = true;
                     shouldEmit = true;
                     typeLabel = 'FB Combined';
                 } else if (!hasAudio && !vid.emittedNoAudio) {
                     vid.emittedNoAudio = true;
                     shouldEmit = true;
                     typeLabel = 'FB (No Audio)';
                 }

                 if (shouldEmit) {
                     const combinedUrl = `fb-combined://${vId}?video=${encodeURIComponent(vid.url)}` + (hasAudio ? `&audio=${encodeURIComponent(bestAudio)}` : '');
                     if (mainWindow && !mainWindow.isDestroyed()) {
                         if (fbStreams.size > 100) fbStreams.clear();
                         
                         let qualityName = vid.vencode;
                         const qMatch = qualityName.match(/_q(\d+)/);
                         if (qMatch) {
                             qualityName = typeLabel + ' ' + qMatch[1];
                         } else {
                             const parts = qualityName.split('_');
                             qualityName = typeLabel + ' ' + parts[parts.length - 1];
                         }
                         
                         emitDetectedVideo(details, combinedUrl, qualityName, 'Unknown Size');
                     }
                 }
             }
          }
        } catch(e) {}
      }
    } catch (e) {}

    let isRawVideo = false;
    let rawLower = details.url.toLowerCase();
    if (rawLower.includes('.mp4') || rawLower.includes('.webm') || rawLower.includes('.m3u8') || rawLower.includes('.mpd') || rawLower.includes('.m4s') || rawLower.includes('.ts') || rawLower.includes('/init-') || rawLower.includes('init.mp4') || rawLower.includes('/seg-')) {
       isRawVideo = true;
    } else if (details.responseHeaders) {
       const contentType = details.responseHeaders['content-type'] || details.responseHeaders['Content-Type'];
       if (contentType && contentType[0] && contentType[0].toLowerCase().includes('video/')) {
          isRawVideo = true;
       }
    }
    if (isPeeking && isRawVideo && !peekedUrls.includes(cleanUrl)) {
       peekedUrls.push(cleanUrl);
    }

    // IGNORE DASH/HLS segments. We only want the master manifest (.m3u8 / .mpd) or full videos.
    if (handledAsFb) {
       isVideo = false;
    } else if (lowerUrl.includes('.m4s') || lowerUrl.includes('.ts') || lowerUrl.includes('/init-') || lowerUrl.includes('init.mp4') || lowerUrl.includes('/seg-')) {
       isVideo = false;
    } else {
       if (lowerUrl.includes('.m3u8') || lowerUrl.includes('.mpd') || lowerUrl.includes('.mp4') || lowerUrl.includes('.webm')) {
         isVideo = true;
         videoType = lowerUrl.includes('.m3u8') ? 'HLS Stream' : (lowerUrl.includes('.mpd') ? 'DASH Stream' : 'Video');
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
        emitDetectedVideo(details, cleanUrl, videoType, sizeStr);
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
    const downloadId = Date.now() + Math.floor(Math.random() * 1000);
    const urlChain = item.getURLChain();
    const sourcePage = urlChain.length > 0 ? urlChain[0] : item.getURL();

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('download-started', { wcId: wc.id, url: item.getURL(), downloadId });
    }

    const win = BrowserWindow.fromWebContents(wc);
    if (win && win !== mainWindow) {
      event.preventDefault(); // Cancel download for this window
      const url = item.getURL();
      const filename = item.getFilename();
      win.close(); // Close the blank popup window
      
      const settings = loadAppSettings();
      if (settings.multiThreadEnabled) {
        startCustomMultiThreadDownload(url, filename, settings.maxConnections, sourcePage, downloadId);
      } else {
        mainWindow.webContents.downloadURL(url);
      }
      return;
    }

    const settings = loadAppSettings();
    if (settings.multiThreadEnabled) {
      event.preventDefault(); // Intercept and cancel single-threaded native download
      startCustomMultiThreadDownload(item.getURL(), item.getFilename(), settings.maxConnections, sourcePage, downloadId);
      return;
    }

    const downloadEntry = {
      id: downloadId,
      url: item.getURL(),
      quality: 'Native File',
      filename: item.getFilename(),
      savePath: path.join(app.getPath('downloads'), item.getFilename()),
      sourcePage: sourcePage,
      progress: 0,
      status: 'Downloading',
      received: 0,
      total: 0,
      speed: 0,
      lastTime: Date.now(),
      startTime: Date.now(),
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
        { label: 'New Window', click: () => createWindow() },
        { label: 'New Tab (Ctrl+N)', accelerator: 'CommandOrControl+N', click: () => { const win = BrowserWindow.getFocusedWindow(); if (win) win.webContents.send('shortcut', 'new-tab'); } },
        { label: 'New Tab', accelerator: 'CommandOrControl+T', click: () => { const win = BrowserWindow.getFocusedWindow(); if (win) win.webContents.send('shortcut', 'new-tab'); } },
        { label: 'Close Tab', accelerator: 'CommandOrControl+W', click: () => { const win = BrowserWindow.getFocusedWindow(); if (win) win.webContents.send('shortcut', 'close-tab'); } },
        { label: 'Reopen Closed Tab', accelerator: 'CommandOrControl+Shift+T', click: () => { const win = BrowserWindow.getFocusedWindow(); if (win) win.webContents.send('shortcut', 'reopen-tab'); } },
        { label: 'Next Tab', accelerator: 'CommandOrControl+Tab', click: () => { const win = BrowserWindow.getFocusedWindow(); if (win) win.webContents.send('shortcut', 'next-tab'); } },
        { label: 'Previous Tab', accelerator: 'CommandOrControl+Shift+Tab', click: () => { const win = BrowserWindow.getFocusedWindow(); if (win) win.webContents.send('shortcut', 'prev-tab'); } },
        { label: 'Focus URL', accelerator: 'CommandOrControl+L', click: () => { const win = BrowserWindow.getFocusedWindow(); if (win) win.webContents.send('shortcut', 'focus-url'); } },
        { label: 'Find', accelerator: 'CommandOrControl+F', click: () => { const win = BrowserWindow.getFocusedWindow(); if (win) win.webContents.send('shortcut', 'find'); } },
        { label: 'Go Back', accelerator: 'Alt+Left', click: () => { const win = BrowserWindow.getFocusedWindow(); if (win) win.webContents.send('shortcut', 'back'); } },
        { label: 'Go Forward', accelerator: 'Alt+Right', click: () => { const win = BrowserWindow.getFocusedWindow(); if (win) win.webContents.send('shortcut', 'forward'); } },
        { label: 'Reload', accelerator: 'CommandOrControl+R', click: () => { const win = BrowserWindow.getFocusedWindow(); if (win) win.webContents.send('shortcut', 'reload'); } },
        { label: 'Reload (F5)', accelerator: 'F5', click: () => { const win = BrowserWindow.getFocusedWindow(); if (win) win.webContents.send('shortcut', 'reload'); } },
        { label: 'Hard Reload', accelerator: 'CommandOrControl+Shift+R', click: () => { const win = BrowserWindow.getFocusedWindow(); if (win) win.webContents.send('shortcut', 'hard-reload'); } },
        { label: 'Downloads', accelerator: 'CommandOrControl+J', click: () => { const win = BrowserWindow.getFocusedWindow(); if (win) win.webContents.send('shortcut', 'downloads'); } },
        { label: 'DevTools', accelerator: 'CommandOrControl+Shift+I', click: () => { const s = loadAppSettings(); const win = BrowserWindow.getFocusedWindow(); if (win && s.developerMode) { win.webContents.send('shortcut', 'devtools'); } } },
        { label: 'DevTools (F12)', accelerator: 'F12', click: () => { const s = loadAppSettings(); const win = BrowserWindow.getFocusedWindow(); if (win && s.developerMode) { win.webContents.send('shortcut', 'devtools'); } } }
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
  if (!item.endTime && (item.status === 'Completed' || item.status.startsWith('Failed') || item.status.includes('Error'))) {
    item.endTime = Date.now();
  }
  webContents.getAllWebContents().forEach(wc => {
    try {
      if (!wc.isDestroyed()) {
        wc.send('download-progress', item);
      }
    } catch (e) {}
  });
}

// IPC Handler for downloading video
ipcMain.handle('start-download', async (event, { url, quality, referer, title, sourcePage }) => {
  let isFbCombined = url.startsWith('fb-combined://');
  let fbVideoUrl = '';
  let fbAudioUrl = '';

  if (isFbCombined) {
     const urlObj = new URL(url);
     fbVideoUrl = urlObj.searchParams.get('video');
     fbAudioUrl = urlObj.searchParams.get('audio');
     url = fbVideoUrl;
  }

  // Clean URL to prevent fetching raw byte-chunks (fixes Instagram/FB videos)
  try {
    const urlObj = new URL(url);
    if (urlObj.searchParams.has('bytestart')) urlObj.searchParams.delete('bytestart');
    if (urlObj.searchParams.has('byteend')) urlObj.searchParams.delete('byteend');
    url = urlObj.toString();
  } catch (e) {}

  console.log(`Starting download for ${url} at ${quality} quality`);
  
  const settings = loadAppSettings();
  const downloadsFolder = settings.downloadFolder || app.getPath('downloads');
  const timestamp = Date.now();
  
  // Clean the title to be filesystem safe
  let safeTitle = (title || 'pirate_video').replace(/[^a-zA-Z0-9]/gi, '_').toLowerCase();
  if (safeTitle.length > 60) safeTitle = safeTitle.substring(0, 60);
  if (safeTitle.endsWith('_')) safeTitle = safeTitle.replace(/_+$/, '');
  
  const filename = `${safeTitle}_${timestamp}.mp4`;
  const outputPath = path.join(downloadsFolder, filename);

  const downloadItem = { id: timestamp, url, quality, filename, title: title || 'pirate_video', savePath: outputPath, sourcePage: sourcePage || '', progress: 0, status: 'Starting', received: 0, total: 0, speed: 0, startTime: Date.now() };
  downloadsList.push(downloadItem);

  return new Promise(async (resolve) => {
    
    let cookieStr = '';
    try {
        const cookies = await session.defaultSession.cookies.get({ url: referer || url });
        if (cookies && cookies.length > 0) {
            cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        }
    } catch (e) { console.error('Failed to get cookies for download:', e); }

    if (settings.useYtDlp) {
      resolve({ success: true, message: `Downloading with yt-dlp to ${outputPath}` });
      downloadItem.status = 'Downloading (yt-dlp)';
      
      const ytdlOpts = {
         output: outputPath,
         newline: true,
         noWarnings: true,
         ffmpegLocation: ffmpegStatic,
         userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
         concurrentFragments: settings.maxConnections || 4
      };
      if (referer) {
         ytdlOpts.referer = referer;
      }
      if (cookieStr) ytdlOpts.addHeader = [`Cookie: ${cookieStr}`];
      
      const subprocess = youtubedl.exec(url, ytdlOpts);
      subprocess.catch(err => { 
        console.log('yt-dlp exit:', err.message); 
        fs.writeFileSync(path.join(app.getPath('downloads'), 'ytdl-error-log.txt'), 
          `PATH: ${youtubedl.constants ? youtubedl.constants.YOUTUBE_DL_PATH : 'unknown'}
URL: ${url}
FFMPEG: ${ffmpegStatic}
ERROR: ${err.message}
STDERR: ${err.stderr}
STDOUT: ${err.stdout}`);
      });
      
      activeProcesses.set(timestamp, {
         cancel: () => subprocess.kill('SIGKILL')
      });
      
      let lastYtdlProgress = 0;
      subprocess.stdout.on('data', (data) => {
         const text = data.toString();
         const progressMatch = text.match(/\[download\]\s+([\d.]+)%/);
         if (progressMatch) {
            downloadItem.progress = parseFloat(progressMatch[1]);
         }
         const speedMatch = text.match(/at\s+([\d.]+)([KMGT]iB\/s)/);
         if (speedMatch) {
            let speed = parseFloat(speedMatch[1]);
            let unit = speedMatch[2];
            if (unit === 'KiB/s') speed *= 1024;
            else if (unit === 'MiB/s') speed *= 1024 * 1024;
            else if (unit === 'GiB/s') speed *= 1024 * 1024 * 1024;
            downloadItem.speed = speed;
         }
         const sizeMatch = text.match(/of\s+~?\s*([\d.]+)([KMGT]iB)/);
         if (sizeMatch) {
            let size = parseFloat(sizeMatch[1]);
            let unit = sizeMatch[2];
            if (unit === 'KiB') size *= 1024;
            else if (unit === 'MiB') size *= 1024 * 1024;
            else if (unit === 'GiB') size *= 1024 * 1024 * 1024;
            else if (unit === 'TiB') size *= 1024 * 1024 * 1024 * 1024;
            downloadItem.total = size;
            if (downloadItem.progress > 0) {
                downloadItem.received = size * (downloadItem.progress / 100);
            }
         }
         const now = Date.now();
         if (now - lastYtdlProgress > 500) {
            broadcastDownloadProgress(downloadItem);
            lastYtdlProgress = now;
         }
      });
      
      subprocess.on('close', (code, signal) => {
         activeProcesses.delete(timestamp);
         if (code === 0) {
            handlePendingRename(downloadItem);
            downloadItem.status = 'Completed';
            downloadItem.progress = 100;
         } else if (signal === 'SIGKILL' || code === null) {
            downloadItem.status = 'Canceled';
         } else {
            downloadItem.status = 'Error (yt-dlp failed)';
         }
         broadcastDownloadProgress(downloadItem);
      });
      return;
    }

    const lowerDownloadUrl = url.toLowerCase();
    const isHls = lowerDownloadUrl.includes('.m3u8') || lowerDownloadUrl.includes('.ts');
    const isDash = lowerDownloadUrl.includes('.mpd');
    const useFfmpeg = isHls || isDash || isFbCombined;
    let headersObj = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };
    if (referer) headersObj['Referer'] = referer;

    if (!useFfmpeg) {
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

    // FFMPEG Fallback for segmented HLS/DASH streams
    let headers = 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36\r\n';
    if (referer) headers += `Referer: ${referer}\r\n`;
    if (cookieStr) headers += `Cookie: ${cookieStr}\r\n`;

    let cmd = ffmpeg(url)
      // Custom headers to bypass protections
      .addInputOption('-headers', headers)
      .addInputOption('-protocol_whitelist', 'file,http,https,tcp,tls,crypto')
      .addInputOption('-reconnect', '1')
      .addInputOption('-reconnect_streamed', '1')
      .addInputOption('-reconnect_delay_max', '5');

    if (isFbCombined && fbAudioUrl) {
       cmd = cmd.addInput(fbAudioUrl)
         .addInputOption('-headers', headers)
         .addInputOption('-reconnect', '1')
         .addInputOption('-reconnect_streamed', '1')
         .addInputOption('-reconnect_delay_max', '5');
    }

    cmd = cmd.outputOptions('-c copy') // Copy streams directly (very fast, no re-encoding)
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
      mainWindow.webContents.send('retry-ffmpeg', { url, quality, referer: item.referer || '', title: item.title });
    }
  }
});

ipcMain.on('update-download-source', (event, { id, sourcePage }) => {
  const item = downloadsList.find(d => d.id === id);
  if (item && sourcePage) {
    item.sourcePage = sourcePage;
  }
});

// IPC Handlers for Settings
ipcMain.handle('get-app-settings', () => {
  return loadAppSettings();
});

ipcMain.on('get-stealth-settings-sync', (event) => {
  const settings = loadAppSettings();
  event.returnValue = { enabled: settings.stealthEnabled, config: settings.stealthConfig };
});

ipcMain.on('save-app-settings', (event, settings) => {
  const oldSettings = loadAppSettings();
  saveAppSettings(settings);
  if (oldSettings.adblockStrictness !== settings.adblockStrictness) {
    configureAdblocker(settings.adblockStrictness);
  }
});

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
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
    { label: isPeeking ? 'Stop Peek' : 'Peek', click: () => {
        if (!isPeeking) {
            isPeeking = true;
            peekedUrls = [];
        } else {
            isPeeking = false;
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('show-peek-results', peekedUrls);
            }
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
    },
    {
      label: 'Web Testing',
      click: () => {
        if (event.sender) event.sender.send('open-webtesting');
      }
    },
    {
      label: 'Stealth Mode',
      click: () => {
        if (event.sender) event.sender.send('open-stealth');
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
          mainWindow.webContents.send('open-new-tab', linkURL, true);
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

  if (params.tabId !== undefined) {
    template.push({
      label: 'Inspect',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('inspect-tab', params.tabId);
        }
      }
    });
  }

  if (template.length > 0) {
    const menu = Menu.buildFromTemplate(template);
    menu.popup(BrowserWindow.fromWebContents(event.sender));
  }
});

ipcMain.on('reset-browser', async () => {
  if (session.defaultSession) {
    await session.defaultSession.clearStorageData();
  }
  
  const filesToDelete = [
    CREDENTIALS_FILE,
    SETTINGS_FILE,
    SESSIONS_FILE,
    HISTORY_FILE,
    WEBTESTING_FILE
  ];

  filesToDelete.forEach(file => {
    if (fs.existsSync(file)) {
      try {
        fs.unlinkSync(file);
      } catch (err) {
        console.error('Failed to delete file:', file, err);
      }
    }
  });

  app.relaunch();
  app.quit();
});

function broadcastProgress(entry) {
  if (!entry.endTime && (entry.status === 'Completed' || entry.status.startsWith('Failed') || entry.status.includes('Error'))) {
    entry.endTime = Date.now();
  }
  webContents.getAllWebContents().forEach(wc => wc.send('download-progress', entry));
}

function startCustomMultiThreadDownload(url, originalFilename, maxConnections, sourcePage = '', downloadId = null) {
  if (!downloadId) {
    downloadId = Date.now() + Math.floor(Math.random() * 1000);
  }
  const downloadEntry = {
    id: downloadId,
    url: url,
    quality: 'Multi-Threaded',
    filename: originalFilename,
    savePath: path.join(app.getPath('downloads'), originalFilename),
    sourcePage: sourcePage,
    progress: 0,
    status: 'Starting',
    received: 0,
    total: 0,
    speed: 0,
    lastTime: Date.now(),
    startTime: Date.now(),
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
    const originalStart = i * chunkSize;
    const end = Math.min((i + 1) * chunkSize - 1, totalBytes - 1);
    const chunkPath = finalPath + `.part${i}`;
    chunkPaths.push(chunkPath);
    
    let existingSize = 0;
    if (fs.existsSync(chunkPath)) {
      existingSize = fs.statSync(chunkPath).size;
    }
    
    const expectedSize = end - originalStart + 1;
    if (existingSize >= expectedSize) {
      downloadEntry.received += expectedSize;
      chunksCompleted++;
      if (chunksCompleted === numChunks && !hasError) {
        mergeChunks(chunkPaths, finalPath, downloadEntry);
      }
      continue;
    }
    
    if (existingSize > 0) {
      downloadEntry.received += existingSize;
    }
    
    const start = originalStart + existingSize;
    
    const req = net.request({ method: 'GET', url: url });
    const processObj = activeProcesses.get(downloadEntry.id);
    if (processObj) processObj.reqs.push(req);
    
    req.setHeader('Range', `bytes=${start}-${end}`);
    req.on('response', (res) => {
      if (res.statusCode !== 206 && res.statusCode !== 200) {
        hasError = true;
        downloadEntry.status = 'Error';
        return;
      }
      const stream = fs.createWriteStream(chunkPath, { flags: existingSize > 0 ? 'a' : 'w' });
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

  ipcMain.handle('get-webtesting-profiles', () => {
    return webtestingProfiles;
  });
  
  ipcMain.handle('get-testing-data', (event, profileId) => {
    const profile = webtestingProfiles.find(p => p.id === profileId);
    return profile ? profile.trainingData : [];
  });
  
  ipcMain.on('save-webtesting-profiles', (event, profiles) => {
    webtestingProfiles = profiles;
    saveWebtestingProfiles();
  });
  
  const trainingSessions = {};
  
  ipcMain.on('start-testing', (event, profileId) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('create-testing-tab-renderer', profileId);
    }
  });

  ipcMain.on('test-completed', (event, profileId, result) => {
    webContents.getAllWebContents().forEach(wc => {
      try { wc.send('test-completed', profileId, result); } catch(e) {}
    });
  });

  ipcMain.on('test-aborted', (event, profileId) => {
    webContents.getAllWebContents().forEach(wc => {
      try { wc.send('test-aborted', profileId); } catch(e) {}
    });
  });
  
  ipcMain.handle('execute-test-request', async (event, reqOptions, profileId) => {
    return new Promise((resolve) => {
      try {
        const { net } = require('electron');
        const request = net.request({
          method: reqOptions.method,
          url: reqOptions.url,
          partition: profileId ? `persist:profile_${profileId}` : undefined,
          useSessionCookies: true
        });
        
        if (reqOptions.headers) {
          for (const [k, v] of Object.entries(reqOptions.headers)) {
            // Electron's net.request allows forbidden headers like Origin/Referer/Cookie
            try { request.setHeader(k, v); } catch(e) {}
          }
        }
        
        if (reqOptions.postData) {
          request.write(reqOptions.postData);
        }
        
        let body = '';
        const responseHeaders = {};
        
        request.on('response', (response) => {
          for (const [k, v] of Object.entries(response.headers)) {
            responseHeaders[k] = Array.isArray(v) ? v.join(', ') : v;
          }
          
          response.on('data', (chunk) => {
            body += chunk.toString('utf8');
          });
          
          response.on('end', () => {
            resolve({
              status: response.statusCode,
              headers: responseHeaders,
              body: body
            });
          });
        });
        
        request.on('error', (err) => {
          resolve({ status: 'Failed', body: String(err) });
        });
        
        request.end();
      } catch (err) {
        resolve({ status: 'Failed', body: String(err) });
      }
    });
  });
  
  ipcMain.on('start-training', (event, profileId, url) => {
  trainingSessions[profileId] = { requests: [] };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('create-training-tab-renderer', url, profileId);
    
    let attempts = 0;
    const findAndAttach = () => {
      attempts++;
      if (attempts > 100) return; // Stop after 10 seconds to avoid infinite loops
      
      const allWc = webContents.getAllWebContents();
      const targetWc = allWc.find(w => w.getURL().includes('trainingProfile=' + encodeURIComponent(profileId)));
      
      if (targetWc) {
        try {
          targetWc.debugger.attach('1.3');
          targetWc.debugger.sendCommand('Network.enable');
          trainingSessions[profileId].wc = targetWc;

          targetWc.debugger.on('message', (e, method, params) => {
            if (!trainingSessions[profileId]) return;
            
            if (method === 'Network.requestWillBeSent') {
              if (params.request.url.startsWith('data:') || params.request.url.startsWith('file:')) return;
              const reqInfo = {
                id: params.requestId,
                url: params.request.url,
                method: params.request.method,
                headers: params.request.headers,
                postData: params.request.postData || null,
                type: params.type,
                documentURL: params.documentURL,
                timestamp: Date.now()
              };
              trainingSessions[profileId].requests.push(reqInfo);
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('training-action', { url: reqInfo.url, method: reqInfo.method });
              }
            } else if (method === 'Network.responseReceived') {
              const req = trainingSessions[profileId].requests.find(r => r.id === params.requestId);
              if (req) {
                req.status = params.response.status;
                req.responseHeaders = params.response.headers;
                req.mimeType = params.response.mimeType;
              }
            } else if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') {
              const req = trainingSessions[profileId].requests.find(r => r.id === params.requestId);
              if (req && req.timestamp) {
                req.timeTaken = Date.now() - req.timestamp;
                if (method === 'Network.loadingFailed') {
                  req.errorText = params.errorText;
                } else if (method === 'Network.loadingFinished' && (req.type === 'XHR' || req.type === 'Fetch' || (req.mimeType && req.mimeType.toLowerCase().includes('json')))) {
                  // Try to get response body for JSON requests
                  targetWc.debugger.sendCommand('Network.getResponseBody', { requestId: params.requestId })
                    .then((res) => {
                       console.log('SUCCESS fetching body for', req.url, 'len:', res.body ? res.body.length : 0);
                       req.responseBody = res.base64Encoded ? Buffer.from(res.body, 'base64').toString('utf8') : res.body;
                    }).catch((err) => {
                       console.error('FAILED fetching body for', req.url, 'error:', err.message);
                       // Ignore error, probably resource unsupported or too large
                    });
                }
              }
            }
          });

          if (url) {
             targetWc.loadURL(url);
          }
        } catch (err) {
          console.error('Debugger attach failed:', err);
        }
      } else {
        setTimeout(findAndAttach, 100);
      }
    };
    findAndAttach();
  }
});

ipcMain.on('stop-training', (event, profileId) => {
  const session = trainingSessions[profileId];
  if (session) {
    // Notify renderer to detach debugger if needed
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('stop-training-renderer', profileId);
    }
    
    event.sender.send('training-complete', session.requests);
    delete trainingSessions[profileId];
  } else {
    event.sender.send('training-complete', []);
  }
});
