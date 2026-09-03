const { ipcRenderer } = require('electron');

const stealthToggle = document.getElementById('stealth-mode-toggle');
const stealthJson = document.getElementById('stealth-json');
const stealthError = document.getElementById('stealth-json-error');
const stealthContainer = document.getElementById('stealth-config-container');
const stealthInfoIcon = document.getElementById('stealth-info-icon');
const stealthInfoContainer = document.getElementById('stealth-info-container');

if (stealthInfoIcon && stealthInfoContainer) {
  stealthInfoIcon.addEventListener('click', () => {
    stealthInfoContainer.style.display = stealthInfoContainer.style.display === 'none' ? 'block' : 'none';
  });
}

// We will load the full settings, but only modify the stealth ones, then save the full object back.
let currentSettings = {};

async function loadSettings() {
  currentSettings = await ipcRenderer.invoke('get-app-settings');
  
  stealthToggle.checked = !!currentSettings.stealthEnabled;
  stealthContainer.style.opacity = stealthToggle.checked ? '1' : '0.5';
  stealthJson.disabled = !stealthToggle.checked;
  
  if (currentSettings.stealthConfig) {
    stealthJson.value = JSON.stringify(currentSettings.stealthConfig, null, 2);
  } else {
    stealthJson.value = '{\n  "hardwareConcurrency": 12,\n  "deviceMemory": 8,\n  "ipAddress": "1.2.3.4",\n  "httpHost": "example.com"\n}';
  }
}

function saveSettings() {
  let parsedStealth = null;
  try {
    parsedStealth = JSON.parse(stealthJson.value || '{}');
    stealthError.style.display = 'none';
  } catch (e) {
    stealthError.style.display = 'block';
    return; // Don't save if JSON is invalid
  }

  currentSettings.stealthEnabled = stealthToggle.checked;
  currentSettings.stealthConfig = parsedStealth;

  ipcRenderer.send('save-app-settings', currentSettings);
}

stealthToggle.addEventListener('change', () => {
  stealthContainer.style.opacity = stealthToggle.checked ? '1' : '0.5';
  stealthJson.disabled = !stealthToggle.checked;
  saveSettings();
});

let stealthTimeout;
stealthJson.addEventListener('input', () => {
  clearTimeout(stealthTimeout);
  stealthTimeout = setTimeout(() => {
    try {
      JSON.parse(stealthJson.value || '{}');
      stealthError.style.display = 'none';
      saveSettings();
    } catch (e) {
      stealthError.style.display = 'block';
    }
  }, 500);
});

loadSettings();
