const { ipcRenderer } = require('electron');

const mediaListEl = document.getElementById('media-list');
const clearBtn = document.getElementById('clear-btn');
const bulkDlBtn = document.getElementById('bulk-dl-btn');

let detectedMedia = [];
let markedMediaUrls = new Set();

async function init() {
  detectedMedia = await ipcRenderer.invoke('get-detected-media');
  renderList();
}

ipcRenderer.on('video-detected', (event, data) => {
  if (!detectedMedia.find(m => m.url === data.url)) {
     detectedMedia.unshift({
        url: data.url,
        type: data.type,
        size: data.size,
        title: data.title || 'Detected Media',
        timestamp: Date.now()
     });
     renderList();
  }
});

ipcRenderer.on('media-titles-updated', (event, updatedList) => {
   detectedMedia = updatedList;
   renderList();
});

clearBtn.addEventListener('click', () => {
  ipcRenderer.send('clear-detected-media');
  detectedMedia = [];
  markedMediaUrls.clear();
  updateBulkBtn();
  renderList();
});

function updateBulkBtn() {
    if (markedMediaUrls.size > 0) {
        bulkDlBtn.style.display = 'block';
        bulkDlBtn.innerText = `Download Marked (${markedMediaUrls.size})`;
    } else {
        bulkDlBtn.style.display = 'none';
    }
}

bulkDlBtn.addEventListener('click', async () => {
    bulkDlBtn.innerText = 'Starting...';
    bulkDlBtn.disabled = true;
    
    const urlsToRemove = Array.from(markedMediaUrls);
    
    for (const url of urlsToRemove) {
        const media = detectedMedia.find(m => m.url === url);
        if (media) {
            await ipcRenderer.invoke('start-download', {
                url: media.url,
                quality: getBestQualityLabel(media.type),
                referer: media.url,
                title: media.title || 'Detected Video',
                sourcePage: media.sourcePage || ''
            });
        }
    }
    
    // Remove from local and global lists
    ipcRenderer.send('remove-detected-media', urlsToRemove);
    detectedMedia = detectedMedia.filter(m => !urlsToRemove.includes(m.url));
    markedMediaUrls.clear();
    
    updateBulkBtn();
    
    bulkDlBtn.innerText = 'Done!';
    setTimeout(() => {
        bulkDlBtn.disabled = false;
        updateBulkBtn(); // Hide again since count is 0
        renderList();
    }, 1000);
});

function getBestQualityLabel(type) {
    if (type.startsWith('FB Combined') || type.startsWith('FB Quality') || type.startsWith('FB (No Audio)')) {
        return type;
    }
    return type;
}

function renderList() {
  mediaListEl.innerHTML = '';
  if (detectedMedia.length === 0) {
    mediaListEl.innerHTML = '<div class="empty-state">No media detected yet. Play a video on any tab.</div>';
    return;
  }

  detectedMedia.forEach(media => {
    const card = document.createElement('div');
    card.className = 'media-card';
    
    const playerContainer = document.createElement('div');
    playerContainer.className = 'video-player-container';
    
    let isPlayable = true;
    let urlToPlay = media.url;
    
    if (media.url.startsWith('fb-combined://')) {
        try {
            urlToPlay = new URL(media.url).searchParams.get('video');
        } catch(e) {}
    }
    
    if (urlToPlay.includes('.m3u8') || urlToPlay.includes('.mpd')) {
        isPlayable = false;
    }
    
    if (isPlayable) {
        const video = document.createElement('video');
        video.controls = true;
        video.src = urlToPlay;
        video.preload = 'metadata'; // Load metadata, don't auto-download
        playerContainer.appendChild(video);
    } else {
        playerContainer.innerText = '🎥';
        playerContainer.title = 'Cannot preview DASH/HLS streams directly.';
    }
    
    const info = document.createElement('div');
    info.className = 'media-info';
    
    const title = document.createElement('div');
    title.className = 'media-title';
    title.innerText = media.title || 'Detected Video';
    title.title = media.title || 'Detected Video';
    
    const type = document.createElement('div');
    type.className = 'media-type';
    type.innerText = `Type: ${media.type}`;
    
    const size = document.createElement('div');
    size.className = 'media-size';
    size.innerText = `Size: ${media.size}`;

    const urlEl = document.createElement('div');
    urlEl.className = 'media-url';
    urlEl.innerText = media.url;
    urlEl.title = media.url;
    
    const dlBtn = document.createElement('button');
    dlBtn.className = 'download-btn';
    dlBtn.innerText = 'Download';
    dlBtn.addEventListener('click', async () => {
        dlBtn.innerText = 'Starting...';
        dlBtn.style.background = '#888';
        dlBtn.disabled = true;
        
        await ipcRenderer.invoke('start-download', {
            url: media.url,
            quality: getBestQualityLabel(media.type),
            referer: media.url, // Default referer
            title: media.title || 'Detected Video',
            sourcePage: media.sourcePage || ''
        });
        
        // Remove from local and global lists immediately after download starts
        ipcRenderer.send('remove-detected-media', media.url);
        detectedMedia = detectedMedia.filter(m => m.url !== media.url);
        markedMediaUrls.delete(media.url);
        
        updateBulkBtn();
        renderList();
    });
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'mark-checkbox';
    checkbox.checked = markedMediaUrls.has(media.url);
    checkbox.addEventListener('change', (e) => {
        if (e.target.checked) {
            markedMediaUrls.add(media.url);
        } else {
            markedMediaUrls.delete(media.url);
        }
        updateBulkBtn();
    });
    
    info.appendChild(title);
    info.appendChild(type);
    info.appendChild(size);
    info.appendChild(urlEl);
    info.appendChild(dlBtn);
    
    card.appendChild(checkbox);
    card.appendChild(playerContainer);
    card.appendChild(info);
    
    mediaListEl.appendChild(card);
  });
}

init();
