const { ipcRenderer } = require('electron');

let rawHistory = [];

function formatDateString(timestamp) {
  const d = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  let prefix = '';
  
  if (d.toDateString() === today.toDateString()) {
    prefix = 'Today - ';
  } else if (d.toDateString() === yesterday.toDateString()) {
    prefix = 'Yesterday - ';
  }
  
  return prefix + d.toLocaleDateString('en-US', options);
}

function formatTime(timestamp) {
  const d = new Date(timestamp);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function renderHistory(searchQuery = '') {
  const container = document.getElementById('history-list');
  container.innerHTML = '';
  
  const query = searchQuery.toLowerCase();
  const filtered = rawHistory.filter(item => {
    return item.title.toLowerCase().includes(query) || item.url.toLowerCase().includes(query);
  });
  
  if (filtered.length === 0) {
    container.innerHTML = '<div style="padding: 24px; color: #5f6368; text-align: center;">No history entries found.</div>';
    return;
  }
  
  // Group by date string
  const grouped = {};
  filtered.forEach(item => {
    const dateStr = formatDateString(item.timestamp);
    if (!grouped[dateStr]) grouped[dateStr] = [];
    grouped[dateStr].push(item);
  });
  
  Object.keys(grouped).forEach(dateStr => {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'date-group';
    
    const header = document.createElement('div');
    header.className = 'date-header';
    header.innerText = dateStr;
    groupDiv.appendChild(header);
    
    grouped[dateStr].forEach(item => {
      const itemDiv = document.createElement('div');
      itemDiv.className = 'history-item';
      itemDiv.innerHTML = `
        <input type="checkbox" class="checkbox">
        <div class="time">${formatTime(item.timestamp)}</div>
        <div class="favicon"><svg xmlns="http://www.w3.org/2000/svg" height="16" viewBox="0 -960 960 960" width="16" fill="currentColor"><path d="M480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 31.5-155.5t86-127Q252-817 325-848.5T480-880q83 0 155.5 31.5t127 86q54.5 54.5 86 127T880-480q0 82-31.5 155t-86 127.5q-54.5 54.5-127 86T480-80Zm0-82q26-36 45-75t31-83H404q12 44 31 83t45 75Zm-104-16h-44q-41-17-74.5-47T201-300q29 33 65 57t76 39Zm208 0q40-15 76-39t65-57q-23-45-56.5-75T600-178Zm46-162h164q3-17 5-34t2-36q0-19-2-36t-5-34H646q2 17 3 34t1 36q0 19-1 36t-3 34ZM226-340h164q-2-17-3-34t-1-36q0-19 1-36t3-34H226q-3 17-5 34t-2 36q0 19 2 36t5 34Zm166-16h176q-2-17-2.5-34t-.5-36q0-19 .5-36t2.5-34H392q2 17 2.5 34t.5 36q0 19-.5 36t-2.5 34Zm-16-162h44q41 17 74.5 47T759-660q-29-33-65-57t-76-39Zm-208 0q-40 15-76 39t-65 57q23 45 56.5 75T360-782ZM480-802q-26 36-45 75t-31 83h152q-12-44-31-83t-45-75Z"/></svg></div>
        <div class="item-info">
          <div class="title" title="${item.title}">${item.title}</div>
          <div class="domain" title="${item.url}">${item.domain}</div>
        </div>
        <div class="menu-btn" data-url="${item.url}" title="Delete record">
          <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20" fill="currentColor"><path d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z"/></svg>
        </div>
      `;
      
      // Click title or domain to open
      itemDiv.querySelector('.item-info').addEventListener('click', () => {
        ipcRenderer.send('open-new-tab', item.url);
      });
      
      // Click 3 dots to delete specific item
      itemDiv.querySelector('.menu-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        await ipcRenderer.invoke('clear-history', item.url);
        loadHistory();
      });
      
      groupDiv.appendChild(itemDiv);
    });
    
    container.appendChild(groupDiv);
  });
}

async function loadHistory() {
  rawHistory = await ipcRenderer.invoke('get-history');
  renderHistory(document.getElementById('search-input').value);
}

document.getElementById('search-input').addEventListener('input', (e) => {
  renderHistory(e.target.value);
});

document.getElementById('clear-btn').addEventListener('click', async () => {
  if (confirm('Are you sure you want to clear all browsing history?')) {
    await ipcRenderer.invoke('clear-history', null);
    loadHistory();
  }
});

loadHistory();
