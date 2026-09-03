const { ipcRenderer } = require('electron');

const listContainer = document.getElementById('download-list');
const clearHistoryBtn = document.getElementById('clear-history-btn');
const searchInput = document.getElementById('search-input');
const downloadCards = {};

clearHistoryBtn.addEventListener('click', async () => {
  await ipcRenderer.invoke('clear-downloads');
  listContainer.innerHTML = '<div style="color: #5f6368; padding: 20px;">No downloads yet.</div>';
  for (let key in downloadCards) delete downloadCards[key];
});

searchInput.addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase();
  let visibleCount = 0;
  for (let id in downloadCards) {
    const card = downloadCards[id];
    const textToSearch = card.innerText.toLowerCase();
    if (textToSearch.includes(query)) {
      card.style.display = 'flex';
      visibleCount++;
    } else {
      card.style.display = 'none';
    }
  }
  
  let msg = document.getElementById('no-search-results');
  if (visibleCount === 0 && Object.keys(downloadCards).length > 0 && query !== '') {
    if (!msg) {
      msg = document.createElement('div');
      msg.id = 'no-search-results';
      msg.style.color = '#5f6368';
      msg.style.padding = '20px';
      msg.innerText = 'No matches found.';
      listContainer.appendChild(msg);
    }
  } else if (msg) {
    msg.remove();
  }
});

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.innerText = message;
  toast.className = 'show';
  setTimeout(() => { toast.className = toast.className.replace('show', ''); }, 3000);
}

function formatBytes(bytes, decimals = 1) {
  if (bytes === 0 || !bytes) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function formatTime(seconds) {
  if (!seconds || seconds === Infinity || seconds < 0) return '';
  if (seconds < 60) return `${Math.round(seconds)} secs left`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} mins left`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours} hrs ${remMins} mins left`;
}

function formatDuration(seconds) {
  if (!seconds || seconds === Infinity || seconds < 0) return '';
  if (seconds < 60) return `${Math.round(seconds)} secs`;
  const mins = Math.floor(seconds / 60);
  const remSecs = Math.round(seconds % 60);
  if (mins < 60) return `${mins}m ${remSecs}s`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m ${remSecs}s`;
}

function createCard(item) {
  const card = document.createElement('div');
  card.className = 'download-card';
  card.id = `dl-${item.id}`;

  const header = document.createElement('div');
  header.className = 'card-header';
  
  const filename = document.createElement('div');
  filename.className = 'filename';
  filename.innerText = item.filename;
  
  const status = document.createElement('div');
  status.className = 'status';
  status.id = `status-${item.id}`;
  status.innerText = item.status;

  const actionIcons = document.createElement('div');
  actionIcons.className = 'action-icons';

  const primaryIcon = document.createElement('button');
  primaryIcon.className = 'icon-btn';
  primaryIcon.id = `primary-icon-${item.id}`;
  if (item.status.includes('Failed') || item.status.includes('Error') || item.status.includes('Interrupted')) {
    primaryIcon.innerHTML = '↻';
    primaryIcon.title = 'Retry download';
    primaryIcon.onclick = () => {
      ipcRenderer.invoke('retry-download', item.id);
      card.remove();
      delete downloadCards[item.id];
    };
  } else {
    primaryIcon.innerHTML = '📁';
    primaryIcon.title = 'Open folder';
    primaryIcon.onclick = () => ipcRenderer.invoke('open-folder', item.id);
  }

  const renameIcon = document.createElement('button');
  renameIcon.className = 'icon-btn';
  renameIcon.innerHTML = '✏️';
  renameIcon.title = 'Rename file';
  renameIcon.onclick = async () => {
    if (filename.querySelector('input')) return; // already editing
    
    const input = document.createElement('input');
    input.type = 'text';
    input.value = item.filename;
    input.style.width = '100%';
    input.style.boxSizing = 'border-box';
    input.style.fontSize = '16px';
    input.style.padding = '4px';
    input.style.borderRadius = '4px';
    input.style.border = '1px solid #1a73e8';
    
    filename.innerHTML = '';
    filename.appendChild(input);
    input.focus();
    
    let isSaving = false;
    
    const finishEdit = async () => {
      if (isSaving) return;
      isSaving = true;
      const newName = input.value.trim();
      if (newName && newName !== item.filename) {
        const result = await ipcRenderer.invoke('rename-download', item.id, newName);
        if (result.success) {
          item.filename = newName;
        } else {
          // Electron alert might work, but let's be safe
          console.error(result.error || 'Failed to rename file.');
        }
      }
      filename.innerHTML = '';
      filename.innerText = item.filename;
    };
    
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finishEdit();
      if (e.key === 'Escape') {
        isSaving = true; // prevent blur from saving
        filename.innerHTML = '';
        filename.innerText = item.filename;
      }
    });
    
    input.addEventListener('blur', finishEdit);
  };

  const removeIcon = document.createElement('button');
  removeIcon.className = 'icon-btn';
  removeIcon.innerHTML = '✖';
  removeIcon.title = 'Remove from history';
  removeIcon.onclick = () => {
    ipcRenderer.invoke('remove-download', item.id);
    card.remove();
    delete downloadCards[item.id];
    if (Object.keys(downloadCards).length === 0) {
      listContainer.innerHTML = '<div style="color: #5f6368; padding: 20px;">No downloads yet.</div>';
    }
  };

  actionIcons.appendChild(primaryIcon);
  actionIcons.appendChild(renameIcon);
  actionIcons.appendChild(removeIcon);

  header.appendChild(filename);
  header.appendChild(actionIcons);

  const urlContainer = document.createElement('div');
  urlContainer.className = 'url-container';

  const linkIcon = document.createElement('button');
  linkIcon.className = 'icon-btn';
  linkIcon.innerHTML = '🔗';
  linkIcon.title = 'Copy link address';
  linkIcon.onclick = () => {
    navigator.clipboard.writeText(item.url);
    showToast('Link address copied to clipboard');
  };

  const sourceIcon = document.createElement('button');
  sourceIcon.className = 'icon-btn';
  sourceIcon.id = `source-icon-${item.id}`;
  sourceIcon.innerHTML = '📄';
  sourceIcon.title = 'Copy source page';
  if (item.sourcePage && item.sourcePage !== item.url) {
    sourceIcon.onclick = () => {
      navigator.clipboard.writeText(item.sourcePage);
      showToast('Source page copied to clipboard');
    };
  } else {
    sourceIcon.style.opacity = '0.5';
    sourceIcon.title = 'Source page same as link or unknown';
    sourceIcon.onclick = () => {
      navigator.clipboard.writeText(item.sourcePage || item.url);
      showToast('Source page copied to clipboard');
    };
  }

  const url = document.createElement('a');
  url.className = 'url';
  url.href = item.url;
  url.innerText = item.url;
  url.target = '_blank';

  urlContainer.appendChild(linkIcon);
  urlContainer.appendChild(sourceIcon);
  urlContainer.appendChild(url);

  const statsText = document.createElement('div');
  statsText.className = 'stats-text';
  statsText.id = `stats-${item.id}`;
  
  if (item.status === 'Completed' || item.status.startsWith('Failed') || item.status.includes('Error')) {
    let durStr = '';
    if (item.startTime && item.endTime) {
      durStr = ` (took ${formatDuration((item.endTime - item.startTime) / 1000)})`;
    }
    if (item.status === 'Completed') {
      statsText.innerText = formatBytes(item.total || item.received || 0) + durStr;
    } else {
      statsText.innerText = `Failed${durStr}`;
    }
  } else {
    statsText.innerText = 'Starting...';
  }

  const progressContainer = document.createElement('div');
  progressContainer.className = 'progress-bar-container';
  progressContainer.id = `progress-container-${item.id}`;

  const progressBar = document.createElement('div');
  progressBar.className = 'progress-bar';
  progressBar.id = `progress-${item.id}`;
  progressBar.style.width = `${item.progress}%`;
  progressContainer.appendChild(progressBar);

  const progressText = document.createElement('div');
  progressText.className = 'progress-text';
  progressText.id = `progress-text-${item.id}`;
  progressText.innerText = `${Math.round(item.progress)}%`;

  card.appendChild(header);
  card.appendChild(status);
  card.appendChild(urlContainer);
  card.appendChild(statsText);
  card.appendChild(progressContainer);
  card.appendChild(progressText);

  if (item.status === 'Completed') {
    progressContainer.style.display = 'none';
    progressText.style.display = 'none';
    status.innerText = 'Completed';
    status.style.color = '#1a73e8';
  }

  listContainer.insertBefore(card, listContainer.firstChild); // prepend
  downloadCards[item.id] = card;
}

function updateCard(item) {
  if (!downloadCards[item.id]) {
    createCard(item);
    return;
  }
  const status = document.getElementById(`status-${item.id}`);
  const primaryIcon = document.getElementById(`primary-icon-${item.id}`);
  const progressBar = document.getElementById(`progress-${item.id}`);
  const progressText = document.getElementById(`progress-text-${item.id}`);
  const progressContainer = document.getElementById(`progress-container-${item.id}`);
  const statsText = document.getElementById(`stats-${item.id}`);
  const card = document.getElementById(`dl-${item.id}`);
  const sourceIcon = document.getElementById(`source-icon-${item.id}`);

  if (sourceIcon && item.sourcePage) {
    if (item.sourcePage !== item.url) {
      sourceIcon.style.opacity = '1';
      sourceIcon.title = 'Copy source page';
    }
    sourceIcon.onclick = () => {
      navigator.clipboard.writeText(item.sourcePage);
      showToast('Source page copied to clipboard');
    };
  }

  if (card) {
    const filenameDiv = card.querySelector('.filename');
    if (filenameDiv && !filenameDiv.querySelector('input') && filenameDiv.innerText !== item.filename) {
      filenameDiv.innerText = item.filename;
    }
  }

  if (status) status.innerText = item.status;
  if (progressBar) progressBar.style.width = `${item.progress}%`;
  if (progressText) progressText.innerText = `${Math.round(item.progress)}%`;
  
  if (statsText) {
    if (item.status === 'Completed' || item.status.startsWith('Failed') || item.status.includes('Error')) {
      let durStr = '';
      if (item.startTime && item.endTime) {
        durStr = ` (took ${formatDuration((item.endTime - item.startTime) / 1000)})`;
      }
      if (item.status === 'Completed') {
        statsText.innerText = formatBytes(item.total || item.received || 0) + durStr;
      } else {
        statsText.innerText = `Failed${durStr}`;
      }
    } else if (item.status.includes('Downloading')) {
      const speedStr = formatBytes(item.speed) + '/s';
      const receivedStr = formatBytes(item.received);
      const totalStr = item.total ? formatBytes(item.total) : 'Unknown';
      let etaStr = '';
      if (item.speed > 0 && item.total > item.received) {
        const secondsLeft = (item.total - item.received) / item.speed;
        etaStr = `, ETA: ${formatTime(secondsLeft)}`;
      }
      statsText.innerText = `${speedStr} - ${receivedStr} of ${totalStr}${etaStr}`;
    }
  }

  if (item.status === 'Completed') {
    if (progressContainer) progressContainer.style.display = 'none';
    if (progressText) progressText.style.display = 'none';
    if (status) {
      status.innerText = 'Completed';
      status.style.color = '#1a73e8';
    }
  } else {
    if (progressContainer) progressContainer.style.display = 'block';
    if (progressText) progressText.style.display = 'block';
    if (status) status.style.color = '#5f6368';
  }

  if (primaryIcon) {
    if (item.status.includes('Failed') || item.status.includes('Error') || item.status.includes('Interrupted')) {
      primaryIcon.innerHTML = '↻';
      primaryIcon.title = 'Retry download';
      primaryIcon.onclick = () => {
        ipcRenderer.invoke('retry-download', item.id);
        const card = document.getElementById(`dl-${item.id}`);
        if(card) card.remove();
        delete downloadCards[item.id];
      };
    } else {
      primaryIcon.innerHTML = '📁';
      primaryIcon.title = 'Open folder';
      primaryIcon.onclick = () => ipcRenderer.invoke('open-folder', item.id);
    }
  }
}

// Fetch initial list
ipcRenderer.invoke('get-downloads').then(list => {
  if (list && list.length > 0) {
    list.forEach(item => updateCard(item));
  } else {
    listContainer.innerHTML = '<div style="color: #5f6368; padding: 20px;">No downloads yet.</div>';
  }
});

// Listen for updates
ipcRenderer.on('download-progress', (event, item) => {
  if (item.status === 'Removed') {
    const card = document.getElementById(`dl-${item.id}`);
    if (card) card.remove();
    delete downloadCards[item.id];
    if (Object.keys(downloadCards).length === 0) {
      listContainer.innerHTML = '<div style="color: #5f6368; padding: 20px;">No downloads yet.</div>';
    }
    return;
  }
  
  if (Object.keys(downloadCards).length === 0) {
    listContainer.innerHTML = ''; // Clear "No downloads yet"
  }
  updateCard(item);
});
