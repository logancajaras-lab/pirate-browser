const { ipcRenderer } = require('electron');

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
    if (url.startsWith('pirate://') || url.includes('google.com') || url.includes('downloads.html') || url.includes('settings.html') || url.includes('history.html')) return;
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

const MAX_VISIBLE_TABS = 6;

function updateTabVisibility() {
  const visibleStartIndex = Math.max(0, tabs.length - MAX_VISIBLE_TABS);
  
  tabDropdown.innerHTML = '';
  
  tabs.forEach((tab, index) => {
    if (index < visibleStartIndex) {
      tab.tabEl.style.display = 'none';
      
      const dropItem = document.createElement('div');
      dropItem.className = 'dropdown-item';
      dropItem.innerText = tab.tabEl.querySelector('.title').innerText || 'New Tab';
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
}

overflowBtn.addEventListener('click', () => {
  tabDropdown.style.display = tabDropdown.style.display === 'block' ? 'none' : 'block';
});

function createTab(url = 'https://www.google.com') {
  const tabId = tabCounter++;
  
  // Create Tab UI
  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.innerHTML = `<span class="title">New Tab</span><span class="close-tab" data-id="${tabId}">x</span>`;
  tabsContainer.insertBefore(tabEl, newTabBtn);

  // Create Webview
  const webview = document.createElement('webview');
  webview.setAttribute('allowpopups', '');
  if (url.includes('downloads.html') || url.includes('settings.html') || url.includes('history.html')) {
    webview.setAttribute('nodeintegration', 'true');
    webview.setAttribute('webpreferences', 'contextIsolation=no');
  } else {
    const preloadPath = require('path').join(__dirname, 'preload.js');
    webview.setAttribute('preload', 'file://' + preloadPath);
  }
  webview.src = url;
  contentArea.appendChild(webview);

  const tabObj = { id: tabId, tabEl, webview, detectedVideos: [] };
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
  });

  webview.addEventListener('did-navigate', (e) => {
    if (activeTabIndex === tabs.findIndex(t => t.id === tabId)) {
      if (e.url.includes('downloads.html')) {
        urlBar.value = 'pirate://downloads';
      } else if (e.url.includes('settings.html')) {
        urlBar.value = 'pirate://settings';
      } else if (e.url === 'https://www.google.com/' && urlBar.value === '') {
        // Do not prefill URL bar for new empty tabs
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
      } else if (e.url === 'https://www.google.com/' && urlBar.value === '') {
        // Do not prefill URL bar for new empty tabs
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
        mediaType: e.params ? e.params.mediaType : e.mediaType
      });
    }
  });

  setActiveTab(tabId);
  if (url === 'https://www.google.com') {
    urlBar.value = '';
    urlBar.focus();
  } else if (url.includes('downloads.html')) {
    urlBar.value = 'pirate://downloads';
  } else if (url.includes('settings.html')) {
    urlBar.value = 'pirate://settings';
  }
  updateTabVisibility();
}

function setActiveTab(tabId) {
  tabs.forEach((tab, index) => {
    if (tab.id === tabId) {
      tab.tabEl.classList.add('active');
      tab.webview.classList.add('active');
      try {
        urlBar.value = tab.webview.getURL() || tab.webview.src || '';
      } catch (e) {
        urlBar.value = tab.webview.src || '';
      }
      activeTabIndex = index;
    } else {
      tab.tabEl.classList.remove('active');
      tab.webview.classList.remove('active');
    }
  });
  // Hide download button when switching tabs
  updateVideoBadge();
  videoListDropdown.style.display = 'none';
  updateTabVisibility();
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
  const index = tabs.findIndex(t => t.id === tabId);
  if (index !== -1) {
    const tab = tabs[index];
    try {
      const url = tab.webview.getURL() || tab.webview.src;
      if (url && !url.includes('downloads.html') && !url.includes('settings.html') && url !== 'https://www.google.com/') {
        closedTabsHistory.push(url);
        // keep history limited to last 20 tabs to avoid memory leak
        if (closedTabsHistory.length > 20) closedTabsHistory.shift();
      }
    } catch (e) {}

    tab.tabEl.remove();
    tab.webview.remove();
    tabs.splice(index, 1);
    
    if (tabs.length === 0) {
      createTab();
    } else if (activeTabIndex === index) {
      setActiveTab(tabs[Math.max(0, index - 1)].id);
    } else if (activeTabIndex > index) {
      activeTabIndex--;
    }
    updateTabVisibility();
    reportSessionState();
  }
}

function getActiveWebview() {
  if (activeTabIndex >= 0 && activeTabIndex < tabs.length) {
    return tabs[activeTabIndex].webview;
  }
  return null;
}

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
      if (urlBar.value === '') closeTab(activeId);
      return;
    }
    if (url === 'pirate://history') {
      const activeId = tabs[activeTabIndex].id;
      createTab('file://' + require('path').join(__dirname, 'history.html'));
      if (urlBar.value === '') closeTab(activeId);
      return;
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      if (url.includes('.') && !url.includes(' ')) {
        url = 'https://' + url;
      } else {
        url = 'https://www.google.com/search?q=' + encodeURIComponent(url);
      }
    }
    const webview = getActiveWebview();
    if (webview) {
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
  if (wv) wv.reload();
});

// Video Detection Logic
ipcRenderer.on('video-detected', async (event, data) => {
  const webview = getActiveWebview();
  if (!webview) return;
  const tab = tabs[activeTabIndex];
  
  if (!tab.detectedVideos) tab.detectedVideos = [];
  
  // Deduplicate by base URL or Instagram's hidden xpv_asset_id
  let dedupKey = data.url.split('?')[0];
  let bitrate = 0;
  let isVideoTrack = true;

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
     if (!existingVideo.streams.find(s => s.url === data.url)) {
         existingVideo.streams.push({ url: data.url, size: data.size, bitrate: bitrate });
     }
     // Re-trigger async m3u8 parsing on the new URL just in case
     if (data.url.includes('.m3u8')) {
         parseM3u8Async(data.url, existingVideo);
     }
     return;
  }

  // Synchronously insert the object to PREVENT race conditions
  const videoObj = {
    dedupKey: dedupKey,
    title: tab.tabEl.querySelector('.title').innerText || 'Unknown Video',
    duration: '',
    poster: '',
    type: data.type,
    streams: [
       { url: data.url, size: data.size, bitrate: bitrate, parsedRes: null }
    ]
  };
  tab.detectedVideos.push(videoObj);
  updateVideoBadge();

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
                          if (!streamUrl.startsWith('http')) streamUrl = new URL(streamUrl, m3u8Url).toString();
                          
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
  if (videoListDropdown.style.display === 'flex') {
    videoListDropdown.style.display = 'none';
    const backdrop = document.getElementById('video-list-backdrop');
    if (backdrop) backdrop.style.display = 'none';
    return;
  }
  const tab = tabs[activeTabIndex];
  const videos = tab.detectedVideos || [];
  if (videos.length === 0) return;

  videoListDropdown.innerHTML = '';
  
  videos.forEach(v => {
    const itemContainer = document.createElement('div');
    itemContainer.style.display = 'flex';
    itemContainer.style.flexDirection = 'row';
    itemContainer.style.borderBottom = '1px solid #f1f3f4';
    itemContainer.style.padding = '12px 16px';
    itemContainer.style.boxSizing = 'border-box';
    itemContainer.style.width = '100%';
    
    // Left column (Image - 30%)
    const thumb = document.createElement('div');
    thumb.className = 'video-thumb';
    thumb.style.flexShrink = '0'; 
    thumb.style.width = '30%';
    thumb.style.maxWidth = '160px'; // Prevent it from getting too huge on ultra-wide
    thumb.style.marginRight = '16px';
    
    if (v.poster) {
       const img = document.createElement('img');
       img.src = v.poster;
       img.style.width = '100%';
       img.style.height = 'auto'; // Maintain aspect ratio
       img.style.objectFit = 'cover';
       img.style.borderRadius = '6px';
       img.style.aspectRatio = '16/9'; // Force 16:9 look
       thumb.appendChild(img);
    } else {
       thumb.innerText = '🎥';
       thumb.style.display = 'flex';
       thumb.style.alignItems = 'center';
       thumb.style.justifyContent = 'center';
       thumb.style.background = '#000';
       thumb.style.color = '#fff';
       thumb.style.aspectRatio = '16/9';
       thumb.style.borderRadius = '6px';
    }
    
    // Right column (Text + Buttons - 70%)
    const info = document.createElement('div');
    info.className = 'video-info';
    info.style.flex = '1 1 0%';
    info.style.minWidth = '0';
    info.style.display = 'flex';
    info.style.flexDirection = 'column';
    
    // Calculate total streams to show in UI
    const totalStreams = v.streams.length;
    
    const textContainer = document.createElement('div');
    textContainer.innerHTML = `
      <div class="video-title" title="${v.title}" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 15px; font-weight: bold; margin-bottom: 4px;">${v.title}</div>
      <div class="video-meta" style="font-size: 13px; color: #5f6368; margin-bottom: 10px;">${v.duration ? v.duration + ' • ' : ''}${v.type} (${totalStreams} format${totalStreams !== 1 ? 's' : ''})</div>
    `;
    info.appendChild(textContainer);

    // Sort streams by resolution (descending)
    v.streams.sort((a, b) => {
        let aRes = 0; let bRes = 0;
        if (a.parsedRes) aRes = parseInt(a.parsedRes);
        else { let am = a.url.match(/([0-9]+)p/i); if (am) aRes = parseInt(am[1]); }
        
        if (b.parsedRes) bRes = parseInt(b.parsedRes);
        else { let bm = b.url.match(/([0-9]+)p/i); if (bm) bRes = parseInt(bm[1]); }
        
        return bRes - aRes;
    });

    const formatsDiv = document.createElement('div');
    formatsDiv.style.display = 'flex';
    formatsDiv.style.flexWrap = 'wrap';
    formatsDiv.style.gap = '6px';
    
    const seenLabels = new Set();
    
    v.streams.forEach((stream, idx) => {
        let label = '';
        if (stream.parsedRes && stream.parsedRes !== 'Unknown') {
            label = stream.parsedRes;
            if (/^\d+$/.test(label)) label += 'p';
        } else {
            const match = stream.url.match(/([0-9]+)p/i);
            if (match) label = match[1] + 'p';
            else if (stream.size && stream.size !== '0 bytes' && stream.size !== 'Unknown Size') label = stream.size;
            else label = 'Stream ' + (idx + 1);
        }
        
        if (!seenLabels.has(label)) {
            seenLabels.add(label);
            
            const dlBtn = document.createElement('button');
            dlBtn.innerText = label;
            dlBtn.style.background = '#4CAF50';
            dlBtn.style.color = 'white';
            dlBtn.style.border = 'none';
            dlBtn.style.borderRadius = '6px';
            dlBtn.style.padding = '8px 24px';
            dlBtn.style.minWidth = '75px';
            dlBtn.style.textAlign = 'center';
            dlBtn.style.flexShrink = '0';
            dlBtn.style.fontSize = '12px';
            dlBtn.style.fontWeight = 'bold';
            dlBtn.style.cursor = 'pointer';
            dlBtn.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
            
            dlBtn.onmouseover = () => { dlBtn.style.background = '#45a049'; };
            dlBtn.onmouseout = () => { dlBtn.style.background = '#4CAF50'; };
            
            dlBtn.addEventListener('click', async (e) => {
              e.stopPropagation();
              dlBtn.style.background = '#888';
              dlBtn.style.cursor = 'wait';
              dlBtn.innerText = '...';
              
              // Close the popup and backdrop immediately when download starts
              videoListDropdown.style.display = 'none';
              const backdrop = document.getElementById('video-list-backdrop');
              if (backdrop) backdrop.style.display = 'none';
              
              await ipcRenderer.invoke('start-download', { 
                  url: stream.url, 
                  quality: label,
                  referer: tab.webview.getURL(),
                  title: v.title
              });
              dlBtn.style.background = '#4CAF50';
              dlBtn.style.cursor = 'pointer';
              dlBtn.innerText = label;
            });
            
            formatsDiv.appendChild(dlBtn);
        }
    });

    // Update total formats string now that we stripped duplicates
    const uniqueFormatCount = seenLabels.size;
    textContainer.innerHTML = `
      <div class="video-title" title="${v.title}" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 15px; font-weight: bold; margin-bottom: 4px;">${v.title}</div>
      <div class="video-meta" style="font-size: 13px; color: #5f6368; margin-bottom: 10px;">${v.duration ? v.duration + ' • ' : ''}${v.type} (${uniqueFormatCount} format${uniqueFormatCount !== 1 ? 's' : ''})</div>
    `;
    
    info.appendChild(formatsDiv);
    
    itemContainer.appendChild(thumb);
    itemContainer.appendChild(info);
    
    videoListDropdown.appendChild(itemContainer);
  });

  videoListDropdown.style.display = 'flex';

  let backdrop = document.getElementById('video-list-backdrop');
  if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'video-list-backdrop';
      backdrop.style.position = 'fixed';
      backdrop.style.top = '0';
      backdrop.style.left = '0';
      backdrop.style.width = '100vw';
      backdrop.style.height = '100vh';
      backdrop.style.zIndex = '1500'; // Under dropdown (2000), over everything else
      backdrop.style.background = 'transparent';
      backdrop.addEventListener('click', (e) => {
          e.stopPropagation();
          videoListDropdown.style.display = 'none';
          backdrop.style.display = 'none';
      });
      document.body.appendChild(backdrop);
  }
  backdrop.style.display = 'block';
});

// Dismiss popup when clicking outside
document.addEventListener('click', (e) => {
    const btn = document.getElementById('stream-btn');
    if (videoListDropdown && videoListDropdown.style.display === 'flex') {
        if (!videoListDropdown.contains(e.target) && !btn.contains(e.target)) {
            videoListDropdown.style.display = 'none';
        }
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

ipcRenderer.on('open-settings', () => {
  createTab('file://' + require('path').join(__dirname, 'settings.html'));
});

ipcRenderer.on('open-history', () => {
  createTab('file://' + require('path').join(__dirname, 'history.html'));
});

ipcRenderer.on('open-new-tab', (event, url) => {
  createTab(url);
});

// Listen for ffmpeg retries
ipcRenderer.on('retry-ffmpeg', async (event, { url, quality, referer }) => {
  await ipcRenderer.invoke('start-download', { url, quality, referer });
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

  if (data && data.wcId) {
    const tabIndex = tabs.findIndex(t => {
      try { return t.webview.getWebContentsId() === data.wcId; } catch(e) { return false; }
    });
    if (tabIndex !== -1) {
      const tab = tabs[tabIndex];
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
  if (item.status === 'Downloading' || item.status === 'Starting') {
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
  }
});

// Initialize first tab
createTab();
