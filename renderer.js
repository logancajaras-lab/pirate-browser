const { ipcRenderer, clipboard } = require('electron');

let tabs = [];
let activeTabIndex = -1;
let tabCounter = 0;
let currentVideoUrl = null;
const closedTabsHistory = [];

const tabsContainer = document.getElementById('tabs');
const newTabBtn = document.getElementById('new-tab');
const contentArea = document.getElementById('content-area');
const urlBar = document.getElementById('url-bar');
const backBtn = document.getElementById('back-btn');
const forwardBtn = document.getElementById('forward-btn');
const refreshBtn = document.getElementById('refresh-btn');
const streamBtnContainer = document.getElementById('stream-btn-container');
const streamBadge = document.getElementById('stream-badge');
const videoListDropdown = document.getElementById('video-list-dropdown');
const overflowBtn = document.getElementById('overflow-btn');
const tabDropdown = document.getElementById('tab-dropdown');
const globalDlContainer = document.getElementById('global-dl-container');
const globalDlBadge = document.getElementById('global-dl-badge');
const fbSourceBtn = document.getElementById('fb-source-btn');
const fbSourcePanel = document.getElementById('fb-source-panel');
const fbSourceInput = document.getElementById('fb-source-input');
const fbSourceResult = document.getElementById('fb-source-result');
const fbSourceStatus = document.getElementById('fb-source-status');
const fbSourceFindBtn = document.getElementById('fb-source-find');
const fbSourceCurrentBtn = document.getElementById('fb-source-current');
const fbSourceCopyBtn = document.getElementById('fb-source-copy');
const fbReelsOpenBtn = document.getElementById('fb-reels-open');
const fbReelsDetectedBtn = document.getElementById('fb-reels-detected');

// Find in Page UI
const findBar = document.getElementById('find-bar');
const findInput = document.getElementById('find-input');
const findCounter = document.getElementById('find-counter');
const findPrev = document.getElementById('find-prev');
const findNext = document.getElementById('find-next');
const findClose = document.getElementById('find-close');

// Extensions UI
const extensionsBtn = document.getElementById('extensions-btn');
const extensionsPopup = document.getElementById('extensions-popup');
const extCloseBtn = document.getElementById('ext-close-btn');

globalDlContainer.addEventListener('click', () => {
  createTab('file://' + require('path').join(__dirname, 'downloads.html'));
});

let sessionReportTimer = null;
function reportSessionState() {
  if (sessionReportTimer) clearTimeout(sessionReportTimer);
  sessionReportTimer = setTimeout(() => {
    const tabsData = tabs.map(t => {
      let url = '';
      try { url = t.webview.getURL() || t.webview.src; } catch(e) { url = t.webview.src; }
      let title = 'New Tab';
      try { title = t.tabEl.querySelector('.title').innerText; } catch(e) {}
      let wcId = null;
      try { wcId = t.webview.getWebContentsId(); } catch(e) {}
      return { id: t.id, title, url, wcId };
    });
    // Don't save if there are no tabs or just one empty google tab
    if (tabsData.length === 0 || (tabsData.length === 1 && tabsData[0].url.includes('google.com'))) return;
    ipcRenderer.invoke('save-session', tabsData);
  }, 1000);
}

function trackHistory(url, title) {
    if (url.startsWith('pirate://') || url.includes('google.com') || url.includes('downloads.html') || url.includes('settings.html') || url.includes('stealth.html') || url.includes('history.html') || url.includes('webtesting.html')) return;
    try {
        const domain = new URL(url).hostname;
        ipcRenderer.invoke('save-history', {
            url,
            title: title || domain,
            domain,
            timestamp: Date.now()
        });
    } catch(e) {}
}

const MAX_VISIBLE_TABS = 16;

function updateTabVisibility() {
  try {
    const visibleStartIndex = Math.max(0, tabs.length - MAX_VISIBLE_TABS);
    
    tabDropdown.innerHTML = '';
    
    tabs.forEach((tab, index) => {
      if (index < visibleStartIndex) {
        tab.tabEl.style.display = 'none';
        
        const dropItem = document.createElement('div');
        dropItem.className = 'dropdown-item';
        try {
          dropItem.innerText = tab.tabEl.querySelector('.title').innerText || 'New Tab';
        } catch(e) {
          dropItem.innerText = 'New Tab';
        }
        dropItem.addEventListener('click', () => {
          const movedTab = tabs.splice(index, 1)[0];
          tabs.push(movedTab);
          setActiveTab(movedTab.id);
          tabDropdown.style.display = 'none';
        });
        tabDropdown.appendChild(dropItem);
      } else {
        tab.tabEl.style.display = 'flex';
        tabsContainer.insertBefore(tab.tabEl, newTabBtn);
      }
    });

    if (visibleStartIndex > 0) {
      overflowBtn.style.display = 'block';
    } else {
      overflowBtn.style.display = 'none';
      tabDropdown.style.display = 'none';
    }
  } catch (e) {
    console.error('Error in updateTabVisibility:', e);
  }
}

overflowBtn.addEventListener('click', () => {
  tabDropdown.style.display = tabDropdown.style.display === 'block' ? 'none' : 'block';
});

function createTab(url = 'file://' + require('path').join(__dirname, 'newtab.html'), background = false) {
  if (url && url.startsWith('pirate://')) {
    const page = url.replace('pirate://', '');
    if (['downloads', 'settings', 'stealth', 'history', 'sniffer', 'webtesting'].includes(page)) {
      url = 'file://' + require('path').join(__dirname, page + '.html');
    }
  }
  const tabId = tabCounter++;
  
  // Create Tab UI
  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.innerHTML = `<span class="title">New Tab</span><span class="close-tab" data-id="${tabId}">x</span>`;
  tabsContainer.insertBefore(tabEl, newTabBtn);

  // Create Webview
  const webview = document.createElement('webview');
  webview.setAttribute('allowpopups', '');
  if (url.includes('downloads.html') || url.includes('settings.html') || url.includes('stealth.html') || url.includes('history.html') || url.includes('sniffer.html') || url.includes('webtesting.html') || url.includes('testrunner.html')) {
    webview.setAttribute('nodeintegration', 'true');
    webview.setAttribute('webpreferences', 'contextIsolation=no');
    webview.setAttribute('disablewebsecurity', '');
  } else {
    const preloadPath = require('path').join(__dirname, 'preload.js');
    webview.setAttribute('preload', 'file://' + preloadPath);
  }
  webview.src = url;
  contentArea.appendChild(webview);

  const tabObj = { id: tabId, tabEl, webview, detectedVideos: [], facebookReelContext: { reelId: null, assetId: null, pendingStreams: [] } };
  tabs.push(tabObj);
  reportSessionState();

  // Setup Event Listeners
  tabEl.addEventListener('click', (e) => {
    if (!e.target.classList.contains('close-tab')) {
      setActiveTab(tabId);
    }
  });

  tabEl.querySelector('.close-tab').addEventListener('click', () => {
    closeTab(tabId);
  });

  tabEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    let currentUrl = '';
    try {
      currentUrl = webview.getURL() || webview.src;
    } catch(err) {
      currentUrl = webview.src;
    }
    if (currentUrl) {
      ipcRenderer.send('tab-context-menu', currentUrl);
    }
  });

  webview.addEventListener('load-commit', (e) => {
    if (e.isMainFrame) {
      tabObj.detectedVideos = [];
      if (activeTabIndex === tabs.findIndex(t => t.id === tabId)) {
        updateVideoBadge();
      }
    }
  });

  webview.addEventListener('page-title-updated', (e) => {
    tabEl.querySelector('.title').innerText = e.title;
    updateTabVisibility();
    reportSessionState();
    try {
      ipcRenderer.send('update-media-title', { wcId: webview.getWebContentsId(), title: e.title });
    } catch(err) {}
  });

  webview.addEventListener('did-start-loading', () => {
    if (activeTabIndex === tabs.findIndex(t => t.id === tabId)) {
      refreshBtn.innerText = '✖';
    }
  });

  webview.addEventListener('did-stop-loading', () => {
    if (activeTabIndex === tabs.findIndex(t => t.id === tabId)) {
      refreshBtn.innerText = '↻';
    }
  });

  webview.addEventListener('did-navigate', (e) => {
    if (activeTabIndex === tabs.findIndex(t => t.id === tabId)) {
      if (e.url.includes('downloads.html')) {
        urlBar.value = 'pirate://downloads';
      } else if (e.url.includes('settings.html')) {
        urlBar.value = 'pirate://settings';
      } else if (e.url.includes('stealth.html')) {
        urlBar.value = 'pirate://stealth';
      } else if (e.url.includes('webtesting.html')) {
        urlBar.value = 'pirate://webtesting';
      } else if (e.url.includes('newtab.html')) {
        urlBar.value = '';
        urlBar.focus();
      } else {
        urlBar.value = e.url;
      }
    }
    trackHistory(e.url, webview.getTitle());
    reportSessionState();
  });

  webview.addEventListener('did-navigate-in-page', (e) => {
    if (activeTabIndex === tabs.findIndex(t => t.id === tabId)) {
      if (e.url.includes('downloads.html')) {
        urlBar.value = 'pirate://downloads';
      } else if (e.url.includes('settings.html')) {
        urlBar.value = 'pirate://settings';
      } else if (e.url.includes('stealth.html')) {
        urlBar.value = 'pirate://stealth';
      } else if (e.url.includes('webtesting.html')) {
        urlBar.value = 'pirate://webtesting';
      } else if (e.url.includes('newtab.html')) {
        urlBar.value = '';
        urlBar.focus();
      } else {
        urlBar.value = e.url;
      }
    }
    trackHistory(e.url, webview.getTitle());
    reportSessionState();
  });

  webview.addEventListener('context-menu', (e) => {
    e.preventDefault();
    if (activeTabIndex === tabs.findIndex(t => t.id === tabId)) {
      ipcRenderer.send('webview-context-menu', {
        linkURL: e.params ? e.params.linkURL : e.linkURL,
        srcURL: e.params ? e.params.srcURL : e.srcURL,
        mediaType: e.params ? e.params.mediaType : e.mediaType,
        tabId: tabId
      });
    }
  });

  webview.addEventListener('found-in-page', (e) => {
    if (activeTabIndex === tabs.findIndex(t => t.id === tabId)) {
      if (e.result.matches !== undefined) {
        findCounter.innerText = `${e.result.activeMatchOrdinal} / ${e.result.matches}`;
      }
    }
  });

  webview.addEventListener('ipc-message', (e) => {
    if (e.channel === 'webview-zoom') {
      handleZoom(webview, e.args[0]);
    }
  });

  if (!background) {
    setActiveTab(tabId);
    if (url.includes('newtab.html')) {
      urlBar.value = '';
      urlBar.focus();
    } else if (url.includes('downloads.html')) {
      urlBar.value = 'pirate://downloads';
    } else if (url.includes('settings.html')) {
      urlBar.value = 'pirate://settings';
    } else if (url.includes('stealth.html')) {
      urlBar.value = 'pirate://stealth';
    } else if (url.includes('webtesting.html')) {
      urlBar.value = 'pirate://webtesting';
    }
  } else {
    updateTabVisibility();
  }
  updateTabVisibility();
}

function setActiveTab(tabId) {
  try {
    tabs.forEach((tab, index) => {
      if (tab.id === tabId) {
        tab.tabEl.classList.add('active');
        tab.webview.classList.add('active');
        try {
          const url = tab.webview.getURL() || tab.webview.src || '';
          if (url.includes('newtab.html')) {
            urlBar.value = '';
            urlBar.focus();
          } else if (url.includes('downloads.html')) {
            urlBar.value = 'pirate://downloads';
          } else if (url.includes('settings.html')) {
            urlBar.value = 'pirate://settings';
          } else if (url.includes('stealth.html')) {
            urlBar.value = 'pirate://stealth';
          } else if (url.includes('webtesting.html')) {
            urlBar.value = 'pirate://webtesting';
          } else {
            urlBar.value = url;
          }
        } catch (e) {
          urlBar.value = tab.webview.src || '';
        }
        activeTabIndex = index;
      } else {
        tab.tabEl.classList.remove('active');
        tab.webview.classList.remove('active');
      }
    });
    
    const wv = tabs[activeTabIndex]?.webview;
    if (wv && typeof wv.isLoading === 'function' && wv.isLoading()) {
      refreshBtn.innerText = '✖';
    } else {
      refreshBtn.innerText = '↻';
    }
    
    updateVideoBadge();
    videoListDropdown.style.display = 'none';
    updateTabVisibility();
  } catch(e) {
    console.error('Error in setActiveTab:', e);
  }
}

function updateVideoBadge() {
  if (activeTabIndex === -1) return;
  const tab = tabs[activeTabIndex];
  const count = (tab.detectedVideos || []).length;
  if (count > 0) {
    streamBtnContainer.style.display = 'flex';
    streamBadge.innerText = count;
  } else {
    streamBtnContainer.style.display = 'none';
    videoListDropdown.style.display = 'none';
    const backdrop = document.getElementById('video-list-backdrop');
    if (backdrop) backdrop.style.display = 'none';
  }
}

function closeTab(tabId) {
  try {
    const index = tabs.findIndex(t => t.id === tabId);
    if (index !== -1) {
      const tab = tabs[index];
      
      if (tab.testingProfileId) {
        ipcRenderer.send('test-aborted', tab.testingProfileId);
      }
      
      try {
        const url = tab.webview.getURL() || tab.webview.src;
        if (url && !url.includes('downloads.html') && !url.includes('settings.html') && !url.includes('stealth.html') && !url.includes('webtesting.html') && url !== 'https://www.google.com/') {
          closedTabsHistory.push(url);
          if (closedTabsHistory.length > 20) closedTabsHistory.shift();
        }
      } catch (e) {}

      try { tab.tabEl.remove(); } catch(e) {}
      try { tab.webview.remove(); } catch(e) {}
      tabs.splice(index, 1);
      
      if (tabs.length === 0) {
        createTab();
      } else if (activeTabIndex === index) {
        setActiveTab(tabs[Math.max(0, index - 1)].id);
      } else if (activeTabIndex > index) {
        activeTabIndex--;
      }
      updateTabVisibility();
      try { reportSessionState(); } catch(e) {}
    }
  } catch (e) {
    console.error('Error in closeTab:', e);
    updateTabVisibility(); // Try to recover UI state
  }
}

function getActiveWebview() {
  if (activeTabIndex >= 0 && activeTabIndex < tabs.length) {
    return tabs[activeTabIndex].webview;
  }
  return null;
}

function getActiveTabUrl() {
  const wv = getActiveWebview();
  if (!wv) return '';
  try {
    return wv.getURL() || wv.src || '';
  } catch (e) {
    return wv.src || '';
  }
}

function getFacebookReelIdFromUrl(rawUrl) {
  if (!rawUrl) return null;

  try {
    const parsed = new URL(rawUrl);
    if (!/facebook\.com$/i.test(parsed.hostname)) return null;

    const parts = parsed.pathname.split('/').filter(Boolean);
    const reelIndex = parts.findIndex(part => part === 'reel' || part === 'reels');
    if (reelIndex !== -1 && parts[reelIndex + 1]) {
      const id = parts[reelIndex + 1].match(/\d+/);
      return id ? id[0] : null;
    }
  } catch (e) {}

  return null;
}

function ensureFacebookReelContext(tab) {
  if (!tab.facebookReelContext) {
    tab.facebookReelContext = { reelId: null, assetId: null, pendingStreams: [] };
  }

  const currentUrl = (() => {
    try { return tab.webview.getURL() || tab.webview.src || ''; } catch (e) { return tab.webview.src || ''; }
  })();
  const reelId = getFacebookReelIdFromUrl(currentUrl);
  if (reelId && tab.facebookReelContext.reelId !== reelId) {
    tab.facebookReelContext = { reelId, assetId: null, pendingStreams: [] };
  } else if (reelId) {
    tab.facebookReelContext.reelId = reelId;
  }

  return tab.facebookReelContext;
}

function normalizeFacebookHost(hostname) {
  return hostname.replace(/^(m|mbasic|mobile|web)\./i, 'www.');
}

function cleanFacebookPageUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hostname = normalizeFacebookHost(parsed.hostname);
    parsed.hash = '';
    parsed.search = '';
    return parsed.toString().replace(/\/$/, '');
  } catch (e) {
    return url;
  }
}

function extractFacebookSourceFromUrl(rawUrl) {
  if (!rawUrl) return null;

  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch (e) {
    try {
      parsed = new URL('https://' + rawUrl.trim());
    } catch (inner) {
      return null;
    }
  }

  const hostname = normalizeFacebookHost(parsed.hostname.toLowerCase());
  if (!/(^|\.)facebook\.com$/.test(hostname) && hostname !== 'fb.watch') {
    return null;
  }

  parsed.hostname = hostname === 'fb.watch' ? 'www.facebook.com' : hostname;
  const parts = parsed.pathname.split('/').filter(Boolean).map(part => {
    try { return decodeURIComponent(part); } catch (e) { return part; }
  });
  const blockedNames = new Set([
    'photo.php', 'story.php', 'permalink.php', 'watch', 'reel', 'share',
    'posts', 'videos', 'photos', 'groups', 'events', 'marketplace'
  ]);

  const idParam = parsed.searchParams.get('id') || parsed.searchParams.get('profile_id');
  if (idParam && (/^(story|permalink|photo)\.php$/i.test(parts[0] || '') || parsed.searchParams.has('story_fbid') || parsed.searchParams.has('fbid'))) {
    return `https://www.facebook.com/profile.php?id=${encodeURIComponent(idParam)}`;
  }

  if (parts[0] === 'groups' && parts[1]) {
    return `https://www.facebook.com/groups/${encodeURIComponent(parts[1])}`;
  }

  const contentMarkerIndex = parts.findIndex(part => ['posts', 'videos', 'photos'].includes(part));
  if (contentMarkerIndex > 0) {
    return cleanFacebookPageUrl(`https://www.facebook.com/${parts.slice(0, contentMarkerIndex).join('/')}`);
  }

  if (parts[0] && !blockedNames.has(parts[0]) && !parts[0].includes('.php')) {
    return cleanFacebookPageUrl(`https://www.facebook.com/${parts[0]}`);
  }

  return null;
}

async function getFacebookMetadataUrls() {
  const wv = getActiveWebview();
  if (!wv) return [];

  try {
    return await wv.executeJavaScript(`
      (() => {
        const urls = new Set();
        const add = value => { if (value && typeof value === 'string') urls.add(value); };
        add(location.href);
        add(document.querySelector('link[rel="canonical"]')?.href);
        add(document.querySelector('meta[property="og:url"]')?.content);
        add(document.querySelector('meta[property="al:web:url"]')?.content);
        document.querySelectorAll('a[href]').forEach(anchor => {
          const label = (anchor.innerText || anchor.getAttribute('aria-label') || '').trim().toLowerCase();
          const href = anchor.href;
          if (href && /facebook\\.com\\//i.test(href) && /(page|profile|author|posted by|see more from)/i.test(label)) {
            add(href);
          }
        });
        return Array.from(urls);
      })()
    `);
  } catch (e) {
    return [];
  }
}

function setFacebookSourceResult(sourceUrl, statusText) {
  fbSourceResult.innerText = sourceUrl || '';
  fbSourceStatus.innerText = statusText || '';
  if (sourceUrl) {
    clipboard.writeText(sourceUrl);
  }
}

function buildFacebookReelsUrl(sourceUrl) {
  if (!sourceUrl) return null;

  try {
    const parsed = new URL(sourceUrl);
    const hostname = normalizeFacebookHost(parsed.hostname.toLowerCase());
    if (!/(^|\.)facebook\.com$/.test(hostname)) return null;

    parsed.hostname = hostname;
    parsed.search = '';
    parsed.hash = '';

    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts[0] === 'groups' && parts[1]) {
      parsed.pathname = `/groups/${parts[1]}/media`;
      return parsed.toString();
    }

    if (parsed.pathname === '/profile.php') {
      return parsed.toString();
    }

    if (parts[0]) {
      parsed.pathname = `/${parts[0]}/reels`;
      return parsed.toString();
    }
  } catch (e) {}

  return null;
}

function getDirectFacebookReelsUrl(rawUrl) {
  if (!rawUrl) return null;

  try {
    const parsed = new URL(rawUrl.trim());
    const hostname = normalizeFacebookHost(parsed.hostname.toLowerCase());
    if (!/(^|\.)facebook\.com$/.test(hostname) && hostname !== 'fb.watch') return null;

    const parts = parsed.pathname.split('/').filter(Boolean);
    if (hostname === 'fb.watch' || parts.includes('reel') || parts.includes('reels') || parts[0] === 'watch') {
      parsed.hostname = hostname === 'fb.watch' ? 'www.facebook.com' : hostname;
      return parsed.toString();
    }
  } catch (e) {}

  return null;
}

function getTabVideoCount(tab) {
  return tab && tab.detectedVideos ? tab.detectedVideos.length : 0;
}

function findBestVideoTabIndex() {
  if (activeTabIndex >= 0 && getTabVideoCount(tabs[activeTabIndex]) > 0) {
    return activeTabIndex;
  }

  for (let i = tabs.length - 1; i >= 0; i--) {
    if (getTabVideoCount(tabs[i]) > 0) {
      return i;
    }
  }

  return -1;
}

function findTabIndexByWebContentsId(wcId) {
  if (!wcId) return -1;

  return tabs.findIndex(tab => {
    try {
      return tab.webview.getWebContentsId() === wcId;
    } catch (e) {
      return false;
    }
  });
}

function decodeBase64Json(value) {
  try {
    let normalized = decodeURIComponent(value).replace(/-/g, '+').replace(/_/g, '/');
    while (normalized.length % 4) normalized += '=';
    return JSON.parse(atob(normalized));
  } catch (e) {
    return null;
  }
}

function parseFacebookMediaUrl(url) {
  const meta = {
    assetId: null,
    videoId: null,
    bitrate: 0,
    duration: '',
    parsedRes: null,
    isFacebook: false,
    isProgressive: false,
    isAudio: false,
    isDashInit: false,
    isLikelyChunk: false,
    labelPrefix: ''
  };

  try {
    const parsed = new URL(url);
    const lowerUrl = url.toLowerCase();
    meta.isFacebook = parsed.hostname.includes('fbcdn.net') || parsed.hostname.includes('facebook.com');
    if (!meta.isFacebook) return meta;

    const efg = parsed.searchParams.get('efg');
    const efgJson = efg ? decodeBase64Json(efg) : null;
    const tag = parsed.searchParams.get('tag') || '';
    const vencodeTag = efgJson && efgJson.vencode_tag ? efgJson.vencode_tag : tag;

    if (efgJson) {
      meta.assetId = efgJson.xpv_asset_id ? String(efgJson.xpv_asset_id) : null;
      meta.videoId = efgJson.video_id ? String(efgJson.video_id) : null;
      meta.bitrate = Number(efgJson.bitrate || parsed.searchParams.get('bitrate') || 0);
      if (efgJson.duration_s) meta.duration = String(Math.round(Number(efgJson.duration_s)));
    } else {
      meta.bitrate = Number(parsed.searchParams.get('bitrate') || 0);
    }

    const resMatch = String(vencodeTag || tag || lowerUrl).match(/(?:_|-)(\d{3,4})p/i) || String(tag).match(/(\d{3,4})p/i);
    if (resMatch) meta.parsedRes = resMatch[1] + 'p';

    meta.isProgressive = /progressive/i.test(vencodeTag) || /progressive/i.test(parsed.searchParams.get('tag') || '');
    meta.isAudio = /audio/i.test(vencodeTag) || /audio/i.test(parsed.pathname);
    meta.isDashInit = /dashinit/i.test(vencodeTag) || /dashinit/i.test(lowerUrl);
    meta.isLikelyChunk = parsed.searchParams.has('bytestart') || parsed.searchParams.has('byteend') || /\.m4s(\?|$)/i.test(lowerUrl);

    if (meta.isProgressive) meta.labelPrefix = 'MP4';
    else if (meta.isDashInit) meta.labelPrefix = meta.isAudio ? 'Audio' : 'DASH';
  } catch (e) {}

  return meta;
}

function parseSizeToBytes(size) {
  if (!size || typeof size !== 'string') return 0;
  const match = size.match(/([\d.]+)\s*(KB|MB|GB|bytes?)/i);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  if (unit.startsWith('gb')) return value * 1024 * 1024 * 1024;
  if (unit.startsWith('mb')) return value * 1024 * 1024;
  if (unit.startsWith('kb')) return value * 1024;
  return value;
}

function getStreamResolution(stream) {
  if (stream.parsedRes) return parseInt(stream.parsedRes, 10) || 0;
  const match = stream.url.match(/(?:_|-)([0-9]{3,4})p/i);
  return match ? parseInt(match[1], 10) : 0;
}

function getStreamScore(stream) {
  const lowerUrl = (stream.url || '').toLowerCase();
  let score = 0;

  if (stream.isAudio) score -= 100000;
  if (stream.isLikelyChunk && !lowerUrl.includes('.m3u8') && !lowerUrl.includes('.mpd')) score -= 50000;
  if (stream.isProgressive) score += 100000;
  if (lowerUrl.includes('.m3u8')) score += 80000;
  if (lowerUrl.includes('.mpd')) score += 75000;
  if (lowerUrl.includes('.mp4')) score += 60000;
  if (lowerUrl.includes('.webm')) score += 50000;
  if (lowerUrl.includes('fbcdn.net')) score += 5000;

  score += getStreamResolution(stream) * 20;
  score += Math.min((stream.bitrate || 0) / 1000, 5000);
  score += Math.min(parseSizeToBytes(stream.size) / (1024 * 1024), 500);

  return score;
}

function getStreamLabel(stream) {
  if (!stream) return 'Download';

  const resolution = getStreamResolution(stream);
  if (stream.isProgressive && resolution) return `Download MP4 ${resolution}p`;
  if (stream.isProgressive) return 'Download MP4';
  if ((stream.url || '').includes('.m3u8')) return resolution ? `Download HLS ${resolution}p` : 'Download HLS';
  if ((stream.url || '').includes('.mpd')) return resolution ? `Download DASH ${resolution}p` : 'Download DASH';
  if (resolution) return `Download ${resolution}p`;
  return 'Download Best';
}

function shouldAcceptFacebookMedia(tab, fbMeta, url, streamInfo = null) {
  if (!fbMeta.isFacebook) return { accept: true, pending: false };

  const context = ensureFacebookReelContext(tab);
  const reelId = context.reelId;

  if (reelId && fbMeta.videoId && fbMeta.videoId !== reelId) {
    return { accept: false, pending: false };
  }

  if (reelId && fbMeta.videoId === reelId && fbMeta.assetId && !context.assetId) {
    context.assetId = fbMeta.assetId;
  }

  if (reelId && context.assetId && fbMeta.assetId && fbMeta.assetId !== context.assetId) {
    return { accept: false, pending: false };
  }

  if (reelId && !context.assetId && fbMeta.isProgressive && fbMeta.assetId && !fbMeta.videoId) {
    if (streamInfo && !context.pendingStreams.some(item => item.url === streamInfo.url)) {
      context.pendingStreams.push(streamInfo);
    }
    return { accept: false, pending: true };
  }

  if (fbMeta.isAudio || fbMeta.isLikelyChunk) {
    return { accept: false, pending: false };
  }

  return { accept: true, pending: false };
}

function promotePendingFacebookStreams(tab) {
  const context = ensureFacebookReelContext(tab);
  if (!context.assetId || !context.pendingStreams.length) return [];

  const promoted = context.pendingStreams.filter(stream => {
    const meta = parseFacebookMediaUrl(stream.url);
    return meta.assetId === context.assetId && !meta.isAudio && !meta.isLikelyChunk;
  });
  context.pendingStreams = context.pendingStreams.filter(stream => !promoted.includes(stream));
  return promoted;
}

async function resolveFacebookSourceUrl() {
  const existingResult = fbSourceResult.innerText.trim();
  if (existingResult) return existingResult;

  const pastedUrl = fbSourceInput.value.trim();
  const candidates = [pastedUrl, getActiveTabUrl()].filter(Boolean);
  for (const candidate of candidates) {
    const sourceUrl = extractFacebookSourceFromUrl(candidate);
    if (sourceUrl) return sourceUrl;
  }

  const metadataUrls = await getFacebookMetadataUrls();
  for (const candidate of metadataUrls) {
    const sourceUrl = extractFacebookSourceFromUrl(candidate);
    if (sourceUrl) return sourceUrl;
  }

  return null;
}

async function scanActivePageForPlayableVideo() {
  const webview = getActiveWebview();
  if (!webview || activeTabIndex === -1) return 0;

  let sources = [];
  try {
    sources = await webview.executeJavaScript(`
      (() => {
        const urls = new Set();
        const add = value => {
          if (!value || typeof value !== 'string') return;
          if (value.startsWith('blob:') || value.startsWith('data:')) return;
          urls.add(value);
        };

        document.querySelectorAll('video').forEach(video => {
          add(video.currentSrc);
          add(video.src);
          video.querySelectorAll('source[src]').forEach(source => add(source.src));
        });

        performance.getEntriesByType('resource').forEach(entry => {
          const name = entry.name || '';
          const type = entry.initiatorType || '';
          if (/video|media/i.test(type) || /fbcdn\\.net|\\.mp4|\\.webm|\\.m3u8|\\.mpd|video/i.test(name)) {
            add(name);
          }
        });

        return Array.from(urls);
      })()
    `);
  } catch (e) {
    return 0;
  }

  const tab = tabs[activeTabIndex];
  if (!tab.detectedVideos) tab.detectedVideos = [];
  let added = 0;

  sources.forEach((url, index) => {
    if (!/^https?:\/\//i.test(url)) return;
    if (tab.detectedVideos.some(video => video.streams && video.streams.some(stream => stream.url === url))) return;

    const isHls = url.includes('.m3u8');
    const isDash = url.includes('.mpd');
    const fbMeta = parseFacebookMediaUrl(url);
    const streamInfo = { url, size: 'Unknown Size', bitrate: fbMeta.bitrate || 0, parsedRes: fbMeta.parsedRes, isProgressive: fbMeta.isProgressive, isLikelyChunk: fbMeta.isLikelyChunk, isAudio: fbMeta.isAudio, labelPrefix: fbMeta.labelPrefix };
    const fbDecision = shouldAcceptFacebookMedia(tab, fbMeta, url, streamInfo);
    if (!fbDecision.accept) return;

    tab.detectedVideos.push({
      dedupKey: fbMeta.assetId ? 'fb_' + fbMeta.assetId : 'page_scan_' + url.split('?')[0],
      title: tab.tabEl.querySelector('.title').innerText || 'Facebook Reel',
      duration: fbMeta.duration || '',
      poster: '',
      type: fbMeta.isProgressive ? 'Facebook MP4' : (isHls ? 'HLS Stream' : (isDash ? 'DASH Stream' : 'Page Video')),
      streams: [
        streamInfo
      ]
    });
    added++;
  });

  if (added > 0) {
    updateVideoBadge();
  }

  return added;
}

async function findFacebookSourcePage() {
  const pastedUrl = fbSourceInput.value.trim();
  const candidates = [pastedUrl, getActiveTabUrl()].filter(Boolean);

  fbSourceStatus.innerText = 'Checking URL...';
  fbSourceResult.innerText = '';

  for (const candidate of candidates) {
    const sourceUrl = extractFacebookSourceFromUrl(candidate);
    if (sourceUrl) {
      setFacebookSourceResult(sourceUrl, 'Copied page link to clipboard.');
      return;
    }
  }

  fbSourceStatus.innerText = 'Checking loaded page metadata...';
  const metadataUrls = await getFacebookMetadataUrls();
  for (const candidate of metadataUrls) {
    const sourceUrl = extractFacebookSourceFromUrl(candidate);
    if (sourceUrl) {
      setFacebookSourceResult(sourceUrl, 'Copied page link to clipboard.');
      return;
    }
  }

  setFacebookSourceResult('', 'Could not identify the source page from this link. Open the post first, then try Use current tab.');
}

function openFacebookSourcePanel() {
  fbSourcePanel.classList.add('open');
  const currentUrl = getActiveTabUrl();
  if (!fbSourceInput.value && /facebook\.com|fb\.watch/i.test(currentUrl)) {
    fbSourceInput.value = currentUrl;
  }
  fbSourceInput.focus();
  fbSourceInput.select();
}

fbSourceBtn.addEventListener('click', () => {
  if (fbSourcePanel.classList.contains('open')) {
    fbSourcePanel.classList.remove('open');
  } else {
    openFacebookSourcePanel();
  }
});

fbSourceFindBtn.addEventListener('click', findFacebookSourcePage);

fbSourceCurrentBtn.addEventListener('click', () => {
  fbSourceInput.value = getActiveTabUrl();
  findFacebookSourcePage();
});

fbSourceCopyBtn.addEventListener('click', () => {
  const result = fbSourceResult.innerText.trim();
  if (!result) {
    fbSourceStatus.innerText = 'No page link to copy yet.';
    return;
  }
  clipboard.writeText(result);
  fbSourceStatus.innerText = 'Copied page link to clipboard.';
});

fbReelsOpenBtn.addEventListener('click', async () => {
  const pastedUrl = fbSourceInput.value.trim();
  const currentUrl = getActiveTabUrl();
  const directReelsUrl = getDirectFacebookReelsUrl(pastedUrl) || getDirectFacebookReelsUrl(currentUrl);

  if (directReelsUrl) {
    setFacebookSourceResult(extractFacebookSourceFromUrl(directReelsUrl) || directReelsUrl, 'Opening the reel link directly. Play it, then use Detected downloads.');
    if (directReelsUrl === currentUrl) {
      fbSourceStatus.innerText = 'This tab is already on a reel. Play it, then use Detected downloads.';
    } else {
      createTab(directReelsUrl);
      fbSourcePanel.classList.remove('open');
    }
    return;
  }

  fbSourceStatus.innerText = 'Finding page link...';
  const sourceUrl = await resolveFacebookSourceUrl();
  if (!sourceUrl) {
    fbSourceStatus.innerText = 'Find a page link first, then open reels.';
    return;
  }

  setFacebookSourceResult(sourceUrl, 'Opening reels. Play a reel, then use Detected downloads.');
  const reelsUrl = buildFacebookReelsUrl(sourceUrl);
  if (!reelsUrl) {
    fbSourceStatus.innerText = 'This page type does not have a direct reels URL.';
    return;
  }

  createTab(reelsUrl);
  fbSourcePanel.classList.remove('open');
});

fbReelsDetectedBtn.addEventListener('click', () => {
  scanActivePageForPlayableVideo().then(() => {
  const videoTabIndex = findBestVideoTabIndex();
  if (videoTabIndex === -1) {
    fbSourceStatus.innerText = 'No direct downloadable stream found. Facebook may be playing this reel through protected segmented media.';
    return;
  }

  setActiveTab(tabs[videoTabIndex].id);
  fbSourcePanel.classList.remove('open');
  if (videoListDropdown.style.display === 'flex') {
    videoListDropdown.style.display = 'none';
  }
  setTimeout(() => document.getElementById('stream-btn').click(), 0);
  });
});

fbSourceInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    findFacebookSourcePage();
  }
});

newTabBtn.addEventListener('click', () => createTab());

urlBar.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    let url = urlBar.value.trim();
    if (url === 'pirate://downloads') {
      const activeId = tabs[activeTabIndex].id;
      createTab('file://' + require('path').join(__dirname, 'downloads.html'));
      // Close the old tab if it was a default google tab
      if (urlBar.value === '') {
         closeTab(activeId);
      }
      return;
    }
    if (url === 'pirate://settings') {
      const activeId = tabs[activeTabIndex].id;
      createTab('file://' + require('path').join(__dirname, 'settings.html'));
      closeTab(activeId);
      return;
    }
    if (url === 'pirate://stealth') {
      const activeId = tabs[activeTabIndex].id;
      createTab('file://' + require('path').join(__dirname, 'stealth.html'));
      closeTab(activeId);
      return;
    }
    if (url === 'pirate://webtesting') {
      const activeId = tabs[activeTabIndex].id;
      createTab('file://' + require('path').join(__dirname, 'webtesting.html'));
      closeTab(activeId);
      return;
    }
    if (url === 'pirate://history') {
      const activeId = tabs[activeTabIndex].id;
      createTab('file://' + require('path').join(__dirname, 'history.html'));
      if (urlBar.value === '') closeTab(activeId);
      return;
    }
    if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('file://')) {
      if (url.includes('.') && !url.includes(' ')) {
        url = 'https://' + url;
      } else {
        url = 'https://www.google.com/search?q=' + encodeURIComponent(url);
      }
    }
    const webview = getActiveWebview();
    if (webview) {
      if (webview.hasAttribute('nodeintegration') && !url.startsWith('file://')) {
        createTab(url);
        return;
      }
      webview.setAttribute('src', url);
    }
  }
});

backBtn.addEventListener('click', () => {
  const wv = getActiveWebview();
  if (wv && wv.canGoBack()) wv.goBack();
});

forwardBtn.addEventListener('click', () => {
  const wv = getActiveWebview();
  if (wv && wv.canGoForward()) wv.goForward();
});

refreshBtn.addEventListener('click', () => {
  const wv = getActiveWebview();
  if (wv) {
    if (refreshBtn.innerText === '✖') {
      wv.stop();
    } else {
      wv.reload();
    }
  }
});

// Video Detection Logic
ipcRenderer.on('video-detected', async (event, data) => {
  const targetTabIndex = findTabIndexByWebContentsId(data && data.wcId);
  const eventTabIndex = targetTabIndex !== -1 ? targetTabIndex : activeTabIndex;
  if (eventTabIndex < 0 || eventTabIndex >= tabs.length) return;

  const tab = tabs[eventTabIndex];
  const webview = tab.webview;
  if (!webview) return;
  
  if (!tab.detectedVideos) tab.detectedVideos = [];
  
  // Deduplicate by base URL or platform asset ids
  let dedupKey = data.url.split('?')[0];
  let bitrate = 0;
  let isVideoTrack = true;
  const fbMeta = parseFacebookMediaUrl(data.url);

  try {
    const urlObj = new URL(data.url);
    const efg = urlObj.searchParams.get('efg');
    if (efg) {
       // Decode Instagram's base64 JSON payload
       let decoded = atob(decodeURIComponent(efg));
       let json = JSON.parse(decoded);
       if (json.xpv_asset_id) {
          dedupKey = 'ig_' + json.xpv_asset_id;
          bitrate = json.bitrate || 0;
          if (json.vencode_tag && json.vencode_tag.includes('audio')) {
             isVideoTrack = false;
          }
       }
    }
  } catch(e) {}

  if (fbMeta.assetId) {
    dedupKey = 'fb_' + fbMeta.assetId;
    bitrate = fbMeta.bitrate || bitrate;
    isVideoTrack = !fbMeta.isAudio;
  }

  const streamInfo = {
    url: data.url,
    size: data.size,
    bitrate: bitrate || fbMeta.bitrate || 0,
    parsedRes: fbMeta.parsedRes || null,
    isProgressive: fbMeta.isProgressive,
    isLikelyChunk: fbMeta.isLikelyChunk,
    isAudio: fbMeta.isAudio,
    labelPrefix: fbMeta.labelPrefix,
    sourcePage: data.sourcePage
  };

  const fbDecision = shouldAcceptFacebookMedia(tab, fbMeta, data.url, streamInfo);
  const acceptedStreams = [];
  if (fbDecision.accept) acceptedStreams.push(streamInfo);
  acceptedStreams.push(...promotePendingFacebookStreams(tab));
  if (acceptedStreams.length === 0) return;

  const primaryStreamInfo = acceptedStreams[0];
  const primaryFbMeta = parseFacebookMediaUrl(primaryStreamInfo.url);
  if (primaryFbMeta.assetId) {
    dedupKey = 'fb_' + primaryFbMeta.assetId;
    bitrate = primaryFbMeta.bitrate || bitrate;
  }

  let existingVideo = tab.detectedVideos.find(v => v.dedupKey === dedupKey);
  
  if (!existingVideo) {
      // Fuzzy Deduplication Fallback
      let urlPath = '';
      try { urlPath = new URL(data.url).pathname; } catch(e) {}
      
      existingVideo = tab.detectedVideos.find(v => {
          let vPath = '';
          try { vPath = new URL(v.streams[0].url).pathname; } catch(e) {}
          
          // 1. If path is identical (ignores CDN host & query params), it's the same video
          if (urlPath && vPath && urlPath === vPath) return true;
          
          // 2. If title matches exactly, and both are HLS, and title is meaningful, merge them
          const title = tab.tabEl.querySelector('.title').innerText;
          if (v.title === title && title !== 'New Tab' && v.type === 'HLS Stream' && data.type === 'HLS Stream') {
             return true;
          }
          return false;
      });
  }
  
  // If we already have this video, append the new stream if it's unique
  if (existingVideo) {
     acceptedStreams.forEach(stream => {
       if (!existingVideo.streams.find(s => s.url === stream.url)) {
         existingVideo.streams.push(stream);
       }
     });
     if (acceptedStreams.some(stream => stream.isProgressive)) {
       existingVideo.type = 'Facebook MP4';
       existingVideo.streams = existingVideo.streams.filter(s => s.isProgressive || s.url.includes('.m3u8') || s.url.includes('.mpd'));
     }
     // Re-trigger async m3u8 parsing on the new URL just in case
     acceptedStreams.filter(stream => stream.url.includes('.m3u8')).forEach(stream => parseM3u8Async(stream.url, existingVideo));
     return;
  }

  // Synchronously insert the object to PREVENT race conditions
  const videoObj = {
    dedupKey: dedupKey,
    title: tab.tabEl.querySelector('.title').innerText || 'Unknown Video',
    duration: primaryFbMeta.duration || fbMeta.duration || '',
    poster: '',
    type: primaryFbMeta.isProgressive ? 'Facebook MP4' : data.type,
    streams: acceptedStreams
  };
  tab.detectedVideos.push(videoObj);
  if (eventTabIndex === activeTabIndex) {
    updateVideoBadge();
  }

  // Async parse HLS master playlists to extract all available qualities!
  if (data.url.includes('.m3u8')) {
      parseM3u8Async(data.url, videoObj);
  }

  function parseM3u8Async(m3u8Url, vObj) {
      (async () => {
          try {
              const resp = await fetch(m3u8Url);
              const text = await resp.text();
              if (text.includes('#EXT-X-STREAM-INF')) {
                  const lines = text.split('\n');
                  let currentRes = null;
                  for (let i = 0; i < lines.length; i++) {
                      const line = lines[i].trim();
                      if (line.startsWith('#EXT-X-STREAM-INF')) {
                          const resMatch = line.match(/RESOLUTION=\d+x(\d+)/);
                          if (resMatch) currentRes = resMatch[1] + 'p';
                          else currentRes = 'Unknown';
                      } else if (line && !line.startsWith('#')) {
                          let streamUrl = line;
                          if (!streamUrl.startsWith('http')) {
                              const parentUrl = new URL(m3u8Url);
                              const resolved = new URL(streamUrl, m3u8Url);
                              resolved.search = parentUrl.search;
                              streamUrl = resolved.toString();
                          }
                          
                          if (!vObj.streams.find(s => s.url === streamUrl)) {
                              vObj.streams.push({ url: streamUrl, size: 'HLS', bitrate: 0, parsedRes: currentRes });
                          }
                      }
                  }
                  // Remove the master playlist from streams since we parsed its children
                  vObj.streams = vObj.streams.filter(s => s.url !== m3u8Url);
                  
                  // Refresh UI if open
                  if (videoListDropdown.style.display === 'flex') {
                     videoListDropdown.style.display = 'none';
                     document.getElementById('stream-btn').click();
                  }
              }
          } catch(e) {}
      })();
  }

  // Extrapolate resolutions from URLs (e.g. xHamster multi= string)
  const multiMatch = data.url.match(/multi=([^/]+)/);
  if (multiMatch) {
      // multi=256x144:144p:,426x240:240p:,854x480:480p:,1280x720:720p:,1920x1080:1080p:
      const resolutions = [...multiMatch[1].matchAll(/:([0-9]+p):/g)].map(m => m[1]);
      if (resolutions.length > 0) {
          // Find the current resolution in the URL tail
          const tailMatch = data.url.match(/\/([0-9]+p)([^/]*)$/);
          if (tailMatch) {
              const currentRes = tailMatch[1];
              const suffix = tailMatch[2];
              
              for (const res of resolutions) {
                  const newUrl = data.url.replace(`/${currentRes}${suffix}`, `/${res}${suffix}`);
                  if (!videoObj.streams.find(s => s.url === newUrl)) {
                      videoObj.streams.push({ url: newUrl, size: 'HLS', bitrate: 0, parsedRes: res });
                  }
              }
          }
      }
  }

  // Try to scrape metadata from page asynchronously
  try {
    const meta = await webview.executeJavaScript(`
      (() => {
        return new Promise((resolve) => {
          let fallbackPoster = '';
          try {
             const ogImg = document.querySelector('meta[property="og:image"]');
             if (ogImg && ogImg.content) fallbackPoster = ogImg.content;
          } catch(e) {}

          const v = document.querySelector('video');
          if (!v) {
            resolve({ poster: fallbackPoster, duration: '' });
            return;
          }
          
          let attempts = 0;
          const maxAttempts = 20; // 5 seconds
          
          const tryCapture = () => {
             attempts++;
             const hasDuration = v.duration && !isNaN(v.duration);
             
             if (hasDuration || attempts >= maxAttempts) {
                let dur = '';
                if (v.duration && !isNaN(v.duration)) {
                   const m = Math.floor(v.duration / 60);
                   const s = Math.floor(v.duration % 60);
                   dur = m + ':' + (s < 10 ? '0' : '') + s;
                }
                
                let finalPoster = fallbackPoster;
                if (v.poster && v.poster.length > 0) {
                   finalPoster = v.poster;
                } else if (!finalPoster) {
                   try {
                      if (v.videoWidth > 0 && v.videoHeight > 0 && v.readyState >= 2) {
                        const canvas = document.createElement('canvas');
                        canvas.width = v.videoWidth;
                        canvas.height = v.videoHeight;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
                        finalPoster = canvas.toDataURL('image/jpeg', 0.7);
                      }
                   } catch(err) {}
                }
                resolve({ poster: finalPoster, duration: dur });
             } else {
                setTimeout(tryCapture, 250);
             }
          };
          
          tryCapture();
        });
      })();
    `);
    
    // Update the existing object with the scraped data
    videoObj.poster = meta.poster;
    videoObj.duration = meta.duration;

    // Unconditionally refresh the dropdown UI if it is currently open
    // so the new thumbnail and duration instantly appear
    if (videoListDropdown.style.display === 'flex') {
       videoListDropdown.style.display = 'none';
       document.getElementById('stream-btn').click();
    }

    // --- ASYNC DEDUPLICATION ---
    // Group any network requests that scraped the exact same video duration.
    if (videoObj.duration && videoObj.duration !== '') {
       const sameVideos = tab.detectedVideos.filter(v => v.duration === videoObj.duration);
       if (sameVideos.length > 1) {
          // Merge all streams into the first video object
          let masterVideo = sameVideos[0];
          for (let i = 1; i < sameVideos.length; i++) {
             let v = sameVideos[i];
             for (let stream of v.streams) {
                 if (!masterVideo.streams.find(s => s.url === stream.url)) {
                     masterVideo.streams.push(stream);
                 }
             }
          }
          
          // Purge the duplicates from the main array
          tab.detectedVideos = tab.detectedVideos.filter(v => v === masterVideo || v.duration !== videoObj.duration);
          updateVideoBadge();
          
          // Refresh dropdown again to show merged stream count
          if (videoListDropdown.style.display === 'flex') {
             videoListDropdown.style.display = 'none';
             document.getElementById('stream-btn').click();
          }
       }
    }
  } catch(e) {}
});

document.getElementById('stream-btn').addEventListener('click', () => {
  createTab('file://' + require('path').join(__dirname, 'sniffer.html'));
  const badge = document.getElementById('stream-badge');
  if (badge) {
    badge.innerText = '0';
    badge.style.display = 'none';
  }
});

// Menu button logic
const menuBtn = document.getElementById('menu-btn');
menuBtn.addEventListener('click', () => {
  ipcRenderer.send('show-context-menu');
});

ipcRenderer.on('open-downloads', () => {
  createTab('file://' + require('path').join(__dirname, 'downloads.html'));
});

ipcRenderer.on('open-sniffer', () => {
  createTab('file://' + require('path').join(__dirname, 'sniffer.html'));
});

ipcRenderer.on('open-settings', () => {
  createTab('file://' + require('path').join(__dirname, 'settings.html'));
});

ipcRenderer.on('open-stealth', () => {
  createTab('file://' + require('path').join(__dirname, 'stealth.html'));
});

ipcRenderer.on('open-history', () => {
  createTab('file://' + require('path').join(__dirname, 'history.html'));
});

ipcRenderer.on('open-new-tab', (event, url, background = false) => {
  createTab(url, background);
});

ipcRenderer.on('create-training-tab-renderer', (event, url, profileId) => {
  const blankUrl = 'file://' + require('path').join(__dirname, 'blank.html');
  createTab(blankUrl + '?webtesting=true&trainingProfile=' + encodeURIComponent(profileId));
  const newTab = tabs[tabs.length - 1];
  newTab.trainingProfileId = profileId;
});

ipcRenderer.on('test-aborted', (event, profileId) => {
  const tab = tabs.find(t => t.testingProfileId === profileId);
  if (tab) {
    closeTab(tab.id);
  }
});

ipcRenderer.on('inspect-tab', (event, tabId) => {
  const tab = tabs.find(t => t.id === tabId);
  if (tab && tab.webview) {
    tab.webview.openDevTools();
  }
});

ipcRenderer.on('inspect-active-tab', () => {
  if (activeTabIndex >= 0 && activeTabIndex < tabs.length) {
    const tab = tabs[activeTabIndex];
    if (tab && tab.webview) {
      tab.webview.openDevTools();
    }
  }
});

ipcRenderer.on('create-testing-tab-renderer', (event, profileId) => {
  const runnerUrl = 'file://' + require('path').join(__dirname, 'testrunner.html');
  createTab(runnerUrl + '?profileId=' + encodeURIComponent(profileId));
  const newTab = tabs[tabs.length - 1];
  newTab.testingProfileId = profileId;
});

ipcRenderer.on('stop-training-renderer', (event, profileId) => {
  const tab = tabs.find(t => t.trainingProfileId === profileId);
  if (tab) {
    try {
      const wc = tab.webview.getWebContents();
      if (wc) wc.debugger.detach();
    } catch(e) {}
    tab.trainingProfileId = null;
  }
});

// Listen for ffmpeg retries
ipcRenderer.on('retry-ffmpeg', async (event, { url, quality, referer, title }) => {
  await ipcRenderer.invoke('start-download', { url, quality, referer, title });
});

ipcRenderer.on('download-started', (event, data) => {
  const anim = document.getElementById('download-animation');
  if (anim) {
    anim.style.display = 'flex';
    anim.style.animation = 'fadeOut 1s forwards 2s'; // Fade out starts at 2s, lasts 1s
    setTimeout(() => {
      anim.style.display = 'none';
      anim.style.animation = '';
    }, 3000);
  }

  if (data && data.downloadId) {
    let activeTabUrl = '';
    const activeTab = tabs.find(t => t.id === activeTabId);
    if (activeTab && activeTab.webview) {
      activeTabUrl = activeTab.webview.getURL();
    }
    ipcRenderer.send('update-download-source', { id: data.downloadId, sourcePage: activeTabUrl });
  }

  if (data && data.wcId) {
    const tabIndex = tabs.find(t => {
      try { return t.webview.getWebContentsId() === data.wcId; } catch(e) { return false; }
    });
    if (tabIndex) {
      const tab = tabIndex;
      try {
        if (!tab.webview.canGoBack()) {
          closeTab(tab.id);
        }
      } catch(e) {}
    }
  }
});

ipcRenderer.on('restore-tabs-batch', (event, tabsArray) => {
  if (!tabsArray || tabsArray.length === 0) return;
  // If we only have the default new tab open, close it
  if (tabs.length === 1 && tabs[0].webview.src.includes('google.com')) {
    closeTab(tabs[0].id);
  }
  tabsArray.forEach(t => {
    if (t.url) createTab(t.url);
  });
});

const activeDownloads = new Map();
ipcRenderer.on('download-progress', (event, item) => {
  if (item.status === 'Downloading' || item.status === 'Starting' || item.status.includes('Downloading')) {
    activeDownloads.set(item.id, item);
  } else {
    activeDownloads.delete(item.id);
  }
  
  if (activeDownloads.size > 0) {
    globalDlBadge.style.display = 'flex';
    globalDlBadge.innerText = activeDownloads.size > 9 ? '9+' : activeDownloads.size;
  } else {
    globalDlBadge.style.display = 'none';
  }
});

ipcRenderer.on('downloads-cleared', () => {
  activeDownloads.clear();
  globalDlBadge.style.display = 'none';
});

// Listen for shortcut keys
ipcRenderer.on('shortcut', (event, action) => {
  switch (action) {
    case 'new-tab':
      createTab();
      break;
    case 'close-tab':
      if (activeTabIndex >= 0 && activeTabIndex < tabs.length) {
        closeTab(tabs[activeTabIndex].id);
      }
      break;
    case 'reopen-tab':
      if (closedTabsHistory.length > 0) {
        createTab(closedTabsHistory.pop());
      }
      break;
    case 'find':
      findBar.style.display = 'flex';
      findInput.focus();
      findInput.select();
      break;
    case 'next-tab':
      if (tabs.length > 1) {
        setActiveTab(tabs[(activeTabIndex + 1) % tabs.length].id);
      }
      break;
    case 'prev-tab':
      if (tabs.length > 1) {
        setActiveTab(tabs[(activeTabIndex - 1 + tabs.length) % tabs.length].id);
      }
      break;
    case 'focus-url':
      urlBar.focus();
      urlBar.select();
      break;
    case 'back':
      backBtn.click();
      break;
    case 'forward':
      forwardBtn.click();
      break;
    case 'reload':
      refreshBtn.click();
      break;
    case 'hard-reload':
      const wv = getActiveWebview();
      if (wv) wv.reloadIgnoringCache();
      break;
    case 'downloads':
      createTab('file://' + require('path').join(__dirname, 'downloads.html'));
      break;
    case 'devtools':
      const dv = getActiveWebview();
      if (dv) {
        if (dv.isDevToolsOpened()) {
          dv.closeDevTools();
        } else {
          dv.openDevTools();
        }
      }
      break;
  }
});

ipcRenderer.on('show-peek-results', (event, urls) => {
    const modal = document.createElement('div');
    modal.style = "position:fixed;top:10%;left:10%;width:80%;height:80%;background:white;padding:20px;border:1px solid #ccc;z-index:9999;box-shadow:0 4px 6px rgba(0,0,0,0.3);display:flex;flex-direction:column;box-sizing:border-box;border-radius:8px;";
    
    const title = document.createElement('h3');
    title.innerText = 'Peeked Video URLs (' + urls.length + ')';
    title.style.marginTop = '0';
    modal.appendChild(title);

    const textarea = document.createElement('textarea');
    textarea.style = "flex-grow:1;margin-bottom:15px;font-family:monospace;padding:10px;resize:none;border:1px solid #dadce0;border-radius:4px;";
    textarea.value = urls.join('\n\n');
    textarea.readOnly = true;
    modal.appendChild(textarea);
    
    const actions = document.createElement('div');
    actions.style = "display:flex;gap:10px;justify-content:flex-end;";
    
    const copyBtn = document.createElement('button');
    copyBtn.innerText = 'Copy All';
    copyBtn.style = "background:#f1f3f4;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;";
    copyBtn.onclick = () => {
        require('electron').clipboard.writeText(urls.join('\n'));
        copyBtn.innerText = 'Copied!';
        setTimeout(() => copyBtn.innerText = 'Copy All', 2000);
    };
    
    const closeBtn = document.createElement('button');
    closeBtn.innerText = 'Close';
    closeBtn.style = "background:#1a73e8;color:white;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;";
    closeBtn.onclick = () => {
        document.body.removeChild(modal);
    };
    
    actions.appendChild(copyBtn);
    actions.appendChild(closeBtn);
    modal.appendChild(actions);
    
    document.body.appendChild(modal);
});

// Find Bar UI Logic
function executeFind(forward = true) {
  const wv = getActiveWebview();
  if (wv && findInput.value) {
    wv.findInPage(findInput.value, { forward, findNext: true });
  }
}

findInput.addEventListener('input', () => {
  if (findInput.value === '') {
    findCounter.innerText = '0/0';
    const wv = getActiveWebview();
    if (wv) wv.stopFindInPage('clearSelection');
  } else {
    executeFind();
  }
});

findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    executeFind(!e.shiftKey);
  } else if (e.key === 'Escape') {
    findClose.click();
  }
});

findNext.addEventListener('click', () => executeFind(true));
findPrev.addEventListener('click', () => executeFind(false));

findClose.addEventListener('click', () => {
  findBar.style.display = 'none';
  const wv = getActiveWebview();
  if (wv) wv.stopFindInPage('clearSelection');
});

// Extensions UI Logic
extensionsBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (extensionsPopup.style.display === 'flex') {
    extensionsPopup.style.display = 'none';
  } else {
    extensionsPopup.style.display = 'flex';
  }
});

extCloseBtn.addEventListener('click', () => {
  extensionsPopup.style.display = 'none';
});

document.addEventListener('click', (e) => {
  if (extensionsPopup.style.display === 'flex' && !extensionsPopup.contains(e.target) && e.target !== extensionsBtn) {
    extensionsPopup.style.display = 'none';
  }
});

// Initialize first tab
createTab();

// Chrome-like Zoom handling
const CHROME_ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 4.0, 5.0];

function handleZoom(webview, action) {
  if (!webview) return;
  const currentFactor = webview.getZoomFactor();
  let newFactor = currentFactor;

  if (action === 'in') {
    const next = CHROME_ZOOM_LEVELS.find(f => f > currentFactor + 0.01);
    if (next) newFactor = next;
  } else if (action === 'out') {
    const next = [...CHROME_ZOOM_LEVELS].reverse().find(f => f < currentFactor - 0.01);
    if (next) newFactor = next;
  } else if (action === 'reset') {
    newFactor = 1.0;
  }

  if (newFactor !== currentFactor) {
    webview.setZoomFactor(newFactor);
  }
}

window.addEventListener('wheel', (e) => {
  if (e.ctrlKey) {
    e.preventDefault();
    const action = e.deltaY > 0 ? 'out' : 'in';
    handleZoom(getActiveWebview(), action);
  }
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey) {
    if (e.key === '=' || e.key === '+') {
      e.preventDefault();
      handleZoom(getActiveWebview(), 'in');
    } else if (e.key === '-') {
      e.preventDefault();
      handleZoom(getActiveWebview(), 'out');
    } else if (e.key === '0') {
      e.preventDefault();
      handleZoom(getActiveWebview(), 'reset');
    }
  }
});
