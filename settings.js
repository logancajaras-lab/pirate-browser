const { ipcRenderer } = require('electron');

const toggle = document.getElementById('multi-thread-toggle');
const slider = document.getElementById('connections-slider');
const valBadge = document.getElementById('connections-val');
const connectionsRow = document.getElementById('connections-row');
const adblockSelect = document.getElementById('adblock-select');
const devModeToggle = document.getElementById('developer-mode-toggle');
const ytdlpToggle = document.getElementById('ytdlp-toggle');

const downloadFolderDisplay = document.getElementById('download-folder-display');
const chooseFolderBtn = document.getElementById('choose-folder-btn');
let currentDownloadFolder = '';

async function loadSettings() {
  const settings = await ipcRenderer.invoke('get-app-settings');
  toggle.checked = settings.multiThreadEnabled;
  slider.value = settings.maxConnections;
  valBadge.innerText = settings.maxConnections;
  connectionsRow.style.opacity = toggle.checked ? '1' : '0.5';
  slider.disabled = !toggle.checked;
  adblockSelect.value = settings.adblockStrictness || 'strict';
  devModeToggle.checked = !!settings.developerMode;
  ytdlpToggle.checked = !!settings.useYtDlp;
  
  currentDownloadFolder = settings.downloadFolder || '';
  if (currentDownloadFolder) {
    downloadFolderDisplay.innerText = currentDownloadFolder;
  } else {
    downloadFolderDisplay.innerText = 'Default (Downloads folder)';
  }
}

function saveSettings() {

  ipcRenderer.send('save-app-settings', {
    multiThreadEnabled: toggle.checked,
    maxConnections: parseInt(slider.value, 10),
    adblockStrictness: adblockSelect.value,
    developerMode: devModeToggle.checked,
    useYtDlp: ytdlpToggle.checked,
    downloadFolder: currentDownloadFolder
  });
}

toggle.addEventListener('change', () => {
  connectionsRow.style.opacity = toggle.checked ? '1' : '0.5';
  slider.disabled = !toggle.checked;
  saveSettings();
});

slider.addEventListener('input', () => {
  valBadge.innerText = slider.value;
});
slider.addEventListener('change', saveSettings);
adblockSelect.addEventListener('change', saveSettings);
devModeToggle.addEventListener('change', saveSettings);
ytdlpToggle.addEventListener('change', saveSettings);

if (chooseFolderBtn) {
  chooseFolderBtn.addEventListener('click', async () => {
    const selectedPath = await ipcRenderer.invoke('select-folder');
    if (selectedPath) {
      currentDownloadFolder = selectedPath;
      downloadFolderDisplay.innerText = selectedPath;
      saveSettings();
    }
  });
}

async function loadSessions() {
  const container = document.getElementById('sessions-container');
  if (!container) return;
  const sessions = await ipcRenderer.invoke('get-sessions');
  if (!sessions || sessions.length === 0) {
    container.innerHTML = '<div style="color: #5f6368; font-size: 13px;">No past sessions found.</div>';
    return;
  }
  
  container.innerHTML = '';
  sessions.forEach(session => {
    const d = new Date(session.startTime);
    const time = d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
    const date = d.getDate().toString().padStart(2, '0') + '-' + (d.getMonth() + 1).toString().padStart(2, '0') + '-' + d.getFullYear();
    const durationMs = session.lastUpdated - session.startTime;
    const durationMins = Math.max(1, Math.round(durationMs / 60000));
    
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.justifyContent = 'space-between';
    row.style.alignItems = 'center';
    row.style.padding = '10px';
    row.style.border = '1px solid #dadce0';
    row.style.borderRadius = '4px';
    row.style.background = '#f8f9fa';
    
    const label = document.createElement('div');
    label.style.fontSize = '14px';
    label.style.fontWeight = '500';
    label.innerText = `Session - ${time} ${date} [${durationMins} mins] (${session.tabs.length} tabs)`;
    
    const restoreBtn = document.createElement('button');
    if (session.restored) {
      restoreBtn.innerText = 'Restored';
      restoreBtn.style.background = '#dadce0';
      restoreBtn.style.color = '#5f6368';
      restoreBtn.style.cursor = 'default';
      restoreBtn.disabled = true;
    } else {
      restoreBtn.innerText = 'Restore';
      restoreBtn.style.background = '#1a73e8';
      restoreBtn.style.color = 'white';
      restoreBtn.style.cursor = 'pointer';
    }
    restoreBtn.style.border = 'none';
    restoreBtn.style.padding = '6px 12px';
    restoreBtn.style.borderRadius = '4px';
    restoreBtn.style.fontWeight = 'bold';
    
    if (!session.restored) {
      restoreBtn.addEventListener('click', () => {
        ipcRenderer.invoke('restore-session', session.id);
        restoreBtn.innerText = 'Restored';
        restoreBtn.style.background = '#dadce0';
        restoreBtn.style.color = '#5f6368';
        restoreBtn.style.cursor = 'default';
        restoreBtn.disabled = true;
      });
    }
    
    row.appendChild(label);
    row.appendChild(restoreBtn);
    container.appendChild(row);
  });
}

// Profiler Logic
const profilerSelect = document.getElementById('profiler-select');
const profilerDashboard = document.getElementById('profiler-dashboard');

let profilerInterval = null;

async function loadProfilerTabs() {
  const liveTabs = await ipcRenderer.invoke('get-live-tabs');
  profilerSelect.innerHTML = '<option value="">Select a tab...</option>';
  
  if (liveTabs) {
    liveTabs.forEach(tab => {
      if (!tab.wcId) return; // Skip if no webContents attached yet
      const option = document.createElement('option');
      option.value = tab.wcId;
      option.innerText = tab.title;
      profilerSelect.appendChild(option);
    });
  }
}

async function updateProfilerData() {
  const wcId = parseInt(profilerSelect.value, 10);
  if (!wcId) {
    profilerDashboard.style.display = 'none';
    if (profilerInterval) clearInterval(profilerInterval);
    return;
  }
  
  profilerDashboard.style.display = 'grid';
  
  // OS Metrics
  const osMetrics = await ipcRenderer.invoke('get-tab-os-metrics', wcId);
  if (osMetrics) {
    document.getElementById('prof-cpu').innerText = osMetrics.cpu ? osMetrics.cpu.percentCPUUsage.toFixed(1) + '%' : '0%';
    document.getElementById('prof-ram').innerText = osMetrics.memory ? (osMetrics.memory.workingSetSize / 1024).toFixed(1) + ' MB' : '0 MB';
  } else {
    document.getElementById('prof-cpu').innerText = 'N/A';
    document.getElementById('prof-ram').innerText = 'N/A';
  }
  
  // Browser Network Metrics
  const browserMetrics = await ipcRenderer.invoke('get-tab-browser-metrics', wcId);
  if (browserMetrics) {
    document.getElementById('prof-load').innerText = Math.round(browserMetrics.loadTime) + ' ms';
    document.getElementById('prof-reqs').innerText = browserMetrics.requests;
    document.getElementById('prof-js').innerText = (browserMetrics.scripts / 1024).toFixed(1) + ' KB';
    document.getElementById('prof-css').innerText = (browserMetrics.css / 1024).toFixed(1) + ' KB';
    document.getElementById('prof-img').innerText = (browserMetrics.images / 1024).toFixed(1) + ' KB';
  } else {
    document.getElementById('prof-load').innerText = 'N/A';
    document.getElementById('prof-reqs').innerText = 'N/A';
    document.getElementById('prof-js').innerText = 'N/A';
    document.getElementById('prof-css').innerText = 'N/A';
    document.getElementById('prof-img').innerText = 'N/A';
  }
}

profilerSelect.addEventListener('change', () => {
  if (profilerInterval) clearInterval(profilerInterval);
  updateProfilerData();
  if (profilerSelect.value) {
    profilerInterval = setInterval(updateProfilerData, 2000); // Update every 2 seconds
  }
});

// Initialization
loadSettings();
loadSessions();
loadProfilerTabs();

const webtestingBtn = document.getElementById('webtesting-btn');
if (webtestingBtn) {
  webtestingBtn.addEventListener('click', () => {
    ipcRenderer.send('open-new-tab', 'pirate://webtesting');
  });
}

const resetBtn = document.getElementById('reset-btn');
if (resetBtn) {
  resetBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to factory reset the browser? This will delete all history, downloads, profiles, and settings.')) {
      await ipcRenderer.invoke('factory-reset');
      alert('Browser has been reset. Please restart the application.');
    }
  });
}

const stealthBtn = document.getElementById('stealth-mode-btn');
if (stealthBtn) {
  stealthBtn.addEventListener('click', () => {
    ipcRenderer.send('open-new-tab', 'pirate://stealth');
  });
}
