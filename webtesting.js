const { ipcRenderer } = require('electron');

const listSection = document.getElementById('list-section');
const formSection = document.getElementById('form-section');
const viewSection = document.getElementById('view-section');
const reviewSection = document.getElementById('review-section');

const profileContainer = document.getElementById('profile-container');
const btnAddProfile = document.getElementById('btn-add-profile');
const btnCancel = document.getElementById('btn-cancel');
const btnSave = document.getElementById('btn-save');

const btnBackFromView = document.getElementById('btn-back-from-view');
const viewTitle = document.getElementById('view-title');
const trainingStatusBox = document.getElementById('training-status-box');
const actionLog = document.getElementById('action-log');

const btnCancelReview = document.getElementById('btn-cancel-review');
const btnApproveReview = document.getElementById('btn-approve-review');
const reviewContainer = document.getElementById('review-container');

const profileIdInput = document.getElementById('profile-id');
const profileNameInput = document.getElementById('profile-name');
const profileUrlInput = document.getElementById('profile-url');
const formTitle = document.getElementById('form-title');

let profiles = [];
let currentProfileId = null;
let isTraining = false;
let isAuthenticating = false;
let trainingLogs = []; // Temporary holding of raw logs until review

const testHistoryBox = document.getElementById('test-history-box');
const testHistoryList = document.getElementById('test-history-list');
const reportSection = document.getElementById('report-section');
const reportSuccessRate = document.getElementById('report-success-rate');
const reportTotalTime = document.getElementById('report-total-time');
const reportRequestsList = document.getElementById('report-requests-list');
const reportPieChart = document.getElementById('report-pie-chart');
const reportTotalReqs = document.getElementById('report-total-reqs');
const reportPassedReqs = document.getElementById('report-passed-reqs');
const btnBackFromReport = document.getElementById('btn-back-from-report');
const filterStatus = document.getElementById('filter-status');
const filterHttp = document.getElementById('filter-http');
const filterTime = document.getElementById('filter-time');
const filterResources = document.getElementById('filter-resources');

let isTesting = false;
let currentRunData = null;

function hideAllSections() {
  listSection.style.display = 'none';
  formSection.style.display = 'none';
  viewSection.style.display = 'none';
  reviewSection.style.display = 'none';
  reportSection.style.display = 'none';
}

function showList() {
  hideAllSections();
  listSection.style.display = 'block';
  currentProfileId = null;
  isTraining = false;
  isTesting = false;
  trainingLogs = [];
}

function showForm(profile = null) {
  hideAllSections();
  formSection.style.display = 'block';
  
  if (profile) {
    formTitle.innerText = 'Edit Profile';
    profileIdInput.value = profile.id;
    profileNameInput.value = profile.name;
    profileUrlInput.value = profile.startUrl;
  } else {
    formTitle.innerText = 'Add New Profile';
    profileIdInput.value = '';
    profileNameInput.value = '';
    profileUrlInput.value = '';
  }
}

function showView(profile) {
  hideAllSections();
  viewSection.style.display = 'block';
  currentProfileId = profile.id;
  viewTitle.innerText = `Profile: ${profile.name}`;
  
  if (!profile.trainingData || profile.trainingData.length === 0) {
    renderEmptyTrainingState();
    testHistoryBox.style.display = 'none';
  } else {
    // Has data
      if (isTesting) {
        trainingStatusBox.innerHTML = `
          <p style="color: #3b82f6; font-weight: bold;">Running tests...</p>
          <p style="font-size: 13px;">Please wait for the test tab to finish or close it to abort.</p>
        `;
      } else if (isAuthenticating) {
        trainingStatusBox.innerHTML = `
          <p style="color: #f59e0b; font-weight: bold;">Authentication in progress...</p>
          <p style="font-size: 13px;">Log in on the new tab, then click the button below to save your live session.</p>
          <div style="display: flex; gap: 12px; justify-content: center;">
            <button class="btn-primary" style="background: #f59e0b; box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);" onclick="finishAuth()">Finish Authentication</button>
          </div>
        `;
      } else {
        const authStatus = Object.keys(profile.authHeaders || {}).length > 0 ? 
          '<span style="color:#059669; font-size:12px; font-weight:bold;">&#10003; Authenticated</span>' : '';
          
        trainingStatusBox.innerHTML = `
          <p style="color: #059669;">Profile is ready with <strong>${profile.trainingData.length}</strong> trained requests. ${authStatus}</p>
          <div style="display: flex; gap: 12px; justify-content: center;">
            <button class="btn-primary" style="background: #10b981; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);" onclick="startTesting()">Start Testing</button>
            <button class="btn-secondary" onclick="startAuth()">Authenticate Profile</button>
            <button class="btn-secondary" onclick="startTraining()">Retrain Profile</button>
            <button class="btn-secondary" onclick="editRules()">Edit Rules</button>
          </div>
        `;
      }
      actionLog.style.display = 'none';
    
    // Render History
    if (profile.testRuns && profile.testRuns.length > 0) {
      testHistoryBox.style.display = 'block';
      testHistoryList.innerHTML = '';
      
      // Sort newest first
      const runs = [...profile.testRuns].sort((a, b) => b.timestamp - a.timestamp);
      
      runs.forEach(run => {
        const runItem = document.createElement('div');
        runItem.className = 'review-request';
        runItem.style.display = 'flex';
        runItem.style.justifyContent = 'space-between';
        runItem.style.alignItems = 'center';
        runItem.style.cursor = 'pointer';
        
        const successRate = Math.round((run.passed / run.total) * 100);
        const d = new Date(run.timestamp);
        const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
        
        runItem.innerHTML = `
          <div style="flex: 1;">
            <div style="font-weight: 600; color: #0f172a; margin-bottom: 4px;">Run: ${dateStr}</div>
            <div class="req-detail">Requests: ${run.total} | Passed: ${run.passed}</div>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <div class="status-badge ${successRate === 100 ? 'active' : ''}" style="${successRate < 100 ? 'background:#fee2e2; color:#b91c1c;' : ''}">${successRate}% Success</div>
            <button class="icon-btn" title="Delete Test Run" onclick="event.stopPropagation(); deleteTestRun('${profile.id}', ${run.timestamp})" style="color:#ef4444;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
            </button>
          </div>
        `;
        runItem.onclick = () => showReport(run);
        testHistoryList.appendChild(runItem);
      });
    } else {
      testHistoryBox.style.display = 'none';
    }
  }
}

function renderEmptyTrainingState() {
  trainingStatusBox.innerHTML = `
    <p>Sorry, there is no data yet. Ready to tell me the rules?</p>
    <button class="btn-primary" onclick="startTraining()">Start Training</button>
  `;
  actionLog.style.display = 'none';
}

function getFaviconUrl(websiteUrl) {
  try {
    const url = new URL(websiteUrl);
    return `https://s2.googleusercontent.com/s2/favicons?domain=${url.hostname}&sz=64`;
  } catch (e) {
    return 'icon.png';
  }
}

function renderProfiles() {
  profileContainer.innerHTML = '';
  
  if (profiles.length === 0) {
    profileContainer.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>
        <h3>No profiles yet</h3>
        <p>Create your first webtesting profile to get started.</p>
      </div>
    `;
    return;
  }
  
  profiles.forEach(profile => {
    const item = document.createElement('div');
    item.className = `profile-item ${profile.active ? 'active' : ''}`;
    const faviconUrl = getFaviconUrl(profile.startUrl);
    
    item.innerHTML = `
      <div class="profile-info">
        <div class="profile-icon">
          <img src="${faviconUrl}" alt="${profile.name} icon" onerror="this.src='icon.png'">
        </div>
        <div class="profile-details">
          <h4 class="profile-name">${profile.name}</h4>
          <p class="profile-url">${profile.startUrl}</p>
        </div>
        ${profile.active ? '<span class="status-badge active">Active</span>' : ''}
      </div>
      <div class="profile-actions">
        <button class="icon-btn" title="Delete Profile" onclick="deleteProfile('${profile.id}')" style="color:#ef4444;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
        </button>
        <button class="icon-btn" title="Edit Profile" onclick="editProfile('${profile.id}')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
        </button>
        <button class="icon-btn" title="View Profile Data" onclick="viewHistory('${profile.id}')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
        </button>
        <label class="switch" title="Toggle Active Status">
          <input type="checkbox" onchange="toggleActive('${profile.id}')" ${profile.active ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
      </div>
    `;
    profileContainer.appendChild(item);
  });
}

async function loadProfiles() {
  profiles = await ipcRenderer.invoke('get-webtesting-profiles');
  renderProfiles();
}

function saveProfiles() {
  ipcRenderer.send('save-webtesting-profiles', profiles);
  renderProfiles();
}

// Inline handlers exposed to window
window.editProfile = (id) => {
  const profile = profiles.find(p => p.id === id);
  if (profile) showForm(profile);
};

window.viewHistory = (id) => {
  const profile = profiles.find(p => p.id === id);
  if (profile) showView(profile);
};

window.toggleActive = (id) => {
  profiles.forEach(p => {
    if (p.id === id) p.active = !p.active;
    else p.active = false;
  });
  saveProfiles();
};

window.deleteProfile = (id) => {
  const profile = profiles.find(p => p.id === id);
  if (!profile) return;
  if (confirm(`Are you sure you want to delete profile "${profile.name}" and all its data?`)) {
    profiles = profiles.filter(p => p.id !== id);
    saveProfiles();
    if (currentProfileId === id) showList();
  }
};

window.deleteTestRun = (profileId, timestamp) => {
  const profile = profiles.find(p => p.id === profileId);
  if (!profile) return;
  if (confirm('Are you sure you want to delete this test run?')) {
    if (profile.testRuns) {
      profile.testRuns = profile.testRuns.filter(r => r.timestamp !== timestamp);
      saveProfiles();
      showView(profile);
    }
  }
};

window.startTraining = () => {
  const profile = profiles.find(p => p.id === currentProfileId);
  if (!profile) return;
  
  isTraining = true;
  trainingLogs = [];
  actionLog.innerHTML = '';
  actionLog.style.display = 'block';
  testHistoryBox.style.display = 'none';
  
  trainingStatusBox.innerHTML = `
    <p>I am monitoring your actions so I can repeat the process without your interference.</p>
    <button class="btn-primary" onclick="stopTraining()" style="background: #ef4444; box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);">Stop Monitoring</button>
  `;
  
  ipcRenderer.send('start-training', profile.id, profile.startUrl);
};

window.stopTraining = () => {
  isTraining = false;
  ipcRenderer.send('stop-training', currentProfileId);
};

window.startAuth = async () => {
  const profile = profiles.find(p => p.id === currentProfileId);
  if (!profile) return;
  
  isAuthenticating = true;
  showView(profile);
  
  await ipcRenderer.invoke('start-auth-session');
  ipcRenderer.send('open-new-tab', profile.startUrl);
};

window.finishAuth = async () => {
  const profile = profiles.find(p => p.id === currentProfileId);
  if (!profile) return;
  
  const headers = await ipcRenderer.invoke('finish-auth-session');
  profile.authHeaders = headers;
  saveProfiles();
  
  isAuthenticating = false;
  showView(profile);
};

window.startTesting = () => {
  const profile = profiles.find(p => p.id === currentProfileId);
  if (!profile || !profile.trainingData || profile.trainingData.length === 0) return;
  
  isTesting = true;
  showView(profile); // refresh UI to running tests state
  
  ipcRenderer.send('start-testing', profile.id);
};

  function showReport(run) {
    currentRunData = run;
    hideAllSections();
    reportSection.style.display = 'block';
    
    const successRate = Math.round((run.passed / run.total) * 100) || 0;
    reportSuccessRate.innerText = `${successRate}%`;
    reportSuccessRate.style.color = successRate === 100 ? '#0f172a' : '#ef4444';
    
    reportPieChart.style.background = `conic-gradient(#10b981 0% ${successRate}%, #ef4444 ${successRate}% 100%)`;
    reportTotalReqs.innerText = run.total;
    reportPassedReqs.innerText = run.passed;
    reportTotalTime.innerText = `${(run.totalTime / 1000).toFixed(2)}s`;
    
    filterStatus.value = 'all';
    filterHttp.value = 'all';
    filterTime.value = 'all';
    if(filterResources) filterResources.checked = false;
    
    renderReportList();
  }
  
  function renderReportList() {
    if (!currentRunData) return;
    reportRequestsList.innerHTML = '';
    
    const statusF = filterStatus.value;
    const httpF = filterHttp.value;
    const timeF = filterTime.value;
    const hideResources = filterResources && filterResources.checked;
    
    const profile = profiles.find(p => p.id === currentProfileId);
    const baseHostname = (profile && profile.startUrl) ? new URL(profile.startUrl).hostname : '';
    
    currentRunData.results.forEach((req, idx) => {
      let isSuccess = String(req.actualStatus) === String(req.expectedStatus);
      if (req.jsonErrorMsg) isSuccess = false; // If JSON validation failed, the request is a failure
      
      if (statusF === 'pass' && !isSuccess) return;
      if (statusF === 'fail' && isSuccess) return;
      
      if (hideResources) {
        let isThirdParty = false;
        try {
          const reqHostname = new URL(req.url).hostname;
          if (baseHostname && reqHostname !== baseHostname && !reqHostname.endsWith('.' + baseHostname)) {
            isThirdParty = true;
          }
        } catch(e) {}
        
        if (isThirdParty) return; // Hide all third-party requests
        
        const importantTypes = ['Document', 'Fetch', 'XHR', 'WebSocket'];
        if (req.type && !importantTypes.includes(req.type)) {
          return; // Hide resource requests (stylesheets, images, etc.)
        }
        
        if (!req.type) {
          // Fallback for old test runs where req.type is undefined
          try {
            if (req.url.match(/\.(css|js|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|ico)(\?.*)?$/i)) {
              return;
            }
          } catch(e) {}
        }
      }
      
      if (httpF !== 'all') {
        const codeStr = String(req.actualStatus);
        if (httpF === '2xx' && !codeStr.startsWith('2')) return;
        if (httpF === '3xx' && !codeStr.startsWith('3')) return;
        if (httpF === '4xx' && !codeStr.startsWith('4')) return;
        if (httpF === '5xx' && !codeStr.startsWith('5')) return;
      }
      
      if (timeF !== 'all') {
        const time = req.timeTaken || 0;
        if (timeF === 'fast' && time >= 100) return;
        if (timeF === 'medium' && (time < 100 || time > 500)) return;
        if (timeF === 'slow' && time <= 500) return;
      }
      
      let badgeColor = isSuccess ? 'background:#10b981; color:#fff;' : 'background:#ef4444; color:#fff;';
      let statusText = isSuccess ? 'PASS' : 'FAIL';
      
      let diffHtml = '';
      if (!isSuccess) {
         let errMsg = req.jsonErrorMsg || `Expected Status: <strong>${req.expectedStatus || 'any'}</strong><br>Actual Status: <strong>${req.actualStatus || 'Timeout'}</strong>`;
         diffHtml = `<div style="margin-bottom: 12px; font-size: 13px; color: #b91c1c; background: #fef2f2; padding: 12px; border-radius: 6px; border: 1px solid #fecaca;">
           <strong>Mismatch!</strong><br>
           ${errMsg}
         </div>`;
      }
      
      let extractedHtml = '';
      if (req.expectedJsonCriteria && Object.keys(req.expectedJsonCriteria).length > 0) {
        let rowsHtml = Object.entries(req.expectedJsonCriteria).map(([k,expectedValues]) => {
           let actualVal = (req.extractedFields && req.extractedFields[k] !== undefined) ? String(req.extractedFields[k]) : 'Not found';
           let actualHtml = String(actualVal).replace(/</g, "&lt;").replace(/>/g, "&gt;");
           let expectedStr = Array.isArray(expectedValues) ? expectedValues.join(', ') : expectedValues;
           if (expectedStr === '*') expectedStr = 'Any value';
           
           let isMatch = false;
           if (Array.isArray(expectedValues)) {
               isMatch = expectedValues.includes(actualVal);
           } else if (expectedValues === '*') {
               isMatch = (req.extractedFields && req.extractedFields[k] !== undefined);
           } else {
               isMatch = (actualVal === expectedValues);
           }
           
           let matchColor = isMatch ? '#059669' : '#dc2626';
           let matchText = isMatch ? '&#10003; Match' : '&times; Mismatch';

           return `<tr>
             <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0; font-weight:600; color:#475569;">${k}</td>
             <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0; font-family:monospace; color:#0f172a;">${expectedStr}</td>
             <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0; font-family:monospace; color:#0f172a;">${actualHtml}</td>
             <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0; font-family:monospace; font-weight:bold; color:${matchColor};">${matchText}</td>
           </tr>`;
        }).join('');
        
        extractedHtml = `
          <div style="margin-bottom: 16px;">
            <div class="req-label" style="margin-bottom: 8px;">JSON Validation Requirements</div>
            <table style="width:100%; border-collapse:collapse; background:#f8fafc; border:1px solid #cbd5e1; border-radius:6px; font-size:12px; text-align:left;">
              <thead>
                <tr>
                  <th style="padding:6px 8px; border-bottom:2px solid #cbd5e1; color:#0f172a;">Field</th>
                  <th style="padding:6px 8px; border-bottom:2px solid #cbd5e1; color:#0f172a;">Expected Value</th>
                  <th style="padding:6px 8px; border-bottom:2px solid #cbd5e1; color:#0f172a;">Actual Value</th>
                  <th style="padding:6px 8px; border-bottom:2px solid #cbd5e1; color:#0f172a;">Status</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
            </table>
          </div>
        `;
      } else if (req.extractedFields && Object.keys(req.extractedFields).length > 0) {
        let rowsHtml = Object.entries(req.extractedFields).map(([k,v]) => {
           let valHtml = String(v).replace(/</g, "&lt;").replace(/>/g, "&gt;");
           return `<tr>
             <td style="padding:4px 8px; border-bottom:1px solid #e2e8f0; font-weight:600; color:#475569;">${k}</td>
             <td style="padding:4px 8px; border-bottom:1px solid #e2e8f0; font-family:monospace; color:#0f172a;">${valHtml}</td>
           </tr>`;
        }).join('');
        
        extractedHtml = `
          <div style="margin-bottom: 16px;">
            <div class="req-label" style="margin-bottom: 8px;">Extracted JSON Fields</div>
            <table style="width:100%; border-collapse:collapse; background:#f8fafc; border:1px solid #cbd5e1; border-radius:6px; font-size:12px; text-align:left;">
              ${rowsHtml}
            </table>
          </div>
        `;
      }
      
      let reqHeadersStr = '';
      if (req.headers && Object.keys(req.headers).length > 0) {
        reqHeadersStr = Object.entries(req.headers).map(([k,v]) => `<span class="req-label">${k}</span>: <span class="req-value">${v}</span>`).join('<br>');
      } else {
        reqHeadersStr = '<em>No request headers</em>';
      }
      
      let resHeadersStr = '';
      if (req.responseHeaders && Object.keys(req.responseHeaders).length > 0) {
        // try to parse if it is a string from main process
        let hObj = req.responseHeaders;
        if (typeof hObj === 'string') {
          try { hObj = JSON.parse(hObj); } catch(e) { hObj = {}; }
        }
        if (Object.keys(hObj).length > 0) {
          resHeadersStr = Object.entries(hObj).map(([k,v]) => `<span class="req-label">${k}</span>: <span class="req-value">${v}</span>`).join('<br>');
        } else {
          resHeadersStr = '<em>No response headers captured</em>';
        }
      } else {
        resHeadersStr = '<em>No response headers captured</em>';
      }
      
      let payloadHtml = '';
      if (req.postData) {
        payloadHtml = `<div style="margin-top: 16px;">
          <div class="req-label">Request Payload</div>
          <div class="req-pre">${req.postData}</div>
        </div>`;
      }
      
      let resBodyHtml = '';
      if (req.responseBody) {
         let bodyText = req.responseBody.replace(/</g, "&lt;").replace(/>/g, "&gt;");
         resBodyHtml = `<div style="margin-top: 16px;">
          <div class="req-label">Response Body</div>
          <div class="req-pre" style="background:#0f172a;">${bodyText}</div>
        </div>`;
      }
      
      const item = document.createElement('details');
      item.innerHTML = `
        <summary>
          <div style="display:flex; justify-content:space-between; align-items:flex-start; width: 100%;">
            <div style="display:flex; align-items:flex-start; gap: 12px; flex: 1;">
              <span style="display:inline-block; width: 24px; color: #94a3b8;">#${idx+1}</span>
              <span class="status-badge" style="${badgeColor} padding: 4px 8px; border-radius: 4px; font-size: 11px; flex-shrink: 0;">${statusText}</span>
              <strong style="color: #475569; min-width: 50px;">${req.method}</strong> 
              <span style="color: #0f172a; word-break: break-all; margin-right: 16px;">${req.url}</span>
            </div>
            <div style="color: #64748b; font-size: 12px; flex-shrink: 0; margin-top: 4px;">${req.timeTaken ? req.timeTaken + 'ms' : '-'}</div>
          </div>
        </summary>
        <div class="details-content">
          ${diffHtml}
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
            <div>
              <div class="req-label" style="margin-bottom: 8px;">Request Headers</div>
              <div style="background: #fff; padding: 12px; border-radius: 6px; border: 1px solid #e2e8f0; font-family: monospace; font-size: 12px; word-break: break-all;">
                ${reqHeadersStr}
              </div>
            </div>
            <div>
              <div class="req-label" style="margin-bottom: 8px;">Response Headers</div>
              <div style="background: #fff; padding: 12px; border-radius: 6px; border: 1px solid #e2e8f0; font-family: monospace; font-size: 12px; word-break: break-all;">
                ${resHeadersStr}
              </div>
            </div>
          </div>
          ${extractedHtml}
          ${payloadHtml}
          ${resBodyHtml}
        </div>
      `;
      
      reportRequestsList.appendChild(item);
    });
  }

// Listeners
filterStatus.addEventListener('change', renderReportList);
filterHttp.addEventListener('change', renderReportList);
filterTime.addEventListener('change', renderReportList);
if(filterResources) filterResources.addEventListener('change', renderReportList);

btnAddProfile.addEventListener('click', () => showForm());
btnCancel.addEventListener('click', () => showList());
btnBackFromView.addEventListener('click', () => showList());
btnCancelReview.addEventListener('click', () => showList());
btnBackFromReport.addEventListener('click', () => showView(profiles.find(p => p.id === currentProfileId)));
btnCancelReview.addEventListener('click', () => showList());

btnSave.addEventListener('click', () => {
  const name = profileNameInput.value.trim();
  const url = profileUrlInput.value.trim();
  const id = profileIdInput.value;
  
  if (!name || !url) { alert('Please provide a name and starting website link.'); return; }
  try { new URL(url); } catch (e) { alert('Please provide a valid URL.'); return; }

  if (id) {
    const profile = profiles.find(p => p.id === id);
    if (profile) { profile.name = name; profile.startUrl = url; }
  } else {
    profiles.push({
      id: Date.now().toString(),
      name: name,
      startUrl: url,
      active: profiles.length === 0,
      trainingData: []
    });
  }
  
  saveProfiles();
  showList();
});

btnApproveReview.addEventListener('click', () => {
  window.saveTraining();
});

window.saveTraining = () => {
  const profile = profiles.find(p => p.id === currentProfileId);
  if (profile) {
    const memory = {};
    
    // First pass: collect configurations
    trainingLogs.forEach(req => {
      if (req.jsonSuccessCriteriaRawKeys) {
          let hasConfig = false;
          let config = {};
          
          req.jsonSuccessCriteriaRawKeys.forEach(k => {
             const chk = document.getElementById(`chk_${req.id}_${k}`);
             if (chk && chk.checked) {
                hasConfig = true;
                const valInput = document.getElementById(`val_${req.id}_${k}`);
                const expectedVals = valInput.value.split(',').map(s => s.trim()).filter(s => s !== '');
                config[k] = expectedVals.length > 0 ? expectedVals : '*';
             }
          });
          
          if (hasConfig) {
             req.jsonSuccessCriteria = config;
             const sig = req.method + '|' + req.url.split('?')[0];
             memory[sig] = config;
          }
      }
    });
    
    // Second pass: apply memory to unconfigured identical requests
    trainingLogs.forEach(req => {
      if (req.jsonSuccessCriteriaRawKeys && !req.jsonSuccessCriteria) {
          const sig = req.method + '|' + req.url.split('?')[0];
          if (memory[sig]) {
              req.jsonSuccessCriteria = memory[sig];
          }
      }
      delete req.jsonSuccessCriteriaRawKeys; // cleanup DOM state representation
    });
    
    const includeThirdParty = document.getElementById('cfg-test-thirdparty') ? document.getElementById('cfg-test-thirdparty').checked : false;
    const includeResources = document.getElementById('cfg-test-resources') ? document.getElementById('cfg-test-resources').checked : false;
    
    let finalRequests = trainingLogs;
    if (!includeThirdParty || !includeResources) {
       finalRequests = trainingLogs.filter(req => {
          if (!includeThirdParty && req.isThirdParty) return false;
          
          let isResource = false;
          const importantTypes = ['Document', 'Fetch', 'XHR', 'WebSocket'];
          if (req.type && !importantTypes.includes(req.type)) {
             isResource = true;
          } else if (!req.type) {
             try {
                if (req.url.match(/\.(css|js|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|ico)(\?.*)?$/i)) isResource = true;
             } catch(e) {}
          }
          if (!includeResources && isResource) return false;
          
          return true;
       });
    }
    
    profile.trainingData = finalRequests; // Save approved data
    saveProfiles();
  }
  showList();
};

window.toggleJsonCfg = (reqId, key) => {
  const valInput = document.getElementById(`val_${reqId}_${key}`);
  if (valInput) {
    valInput.style.display = valInput.style.display === 'none' ? 'block' : 'none';
  }
};

// IPC training updates
ipcRenderer.on('training-action', (event, data) => {
  if (!isTraining) return;
  const { url, method } = data;
  
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `<span class="log-method">${method}</span> <span class="log-url">${url}</span>`;
  
  actionLog.prepend(entry);
  
  // Keep only last 10 entries visually
  while (actionLog.children.length > 10) {
    actionLog.removeChild(actionLog.lastChild);
  }
});

window.editRules = () => {
  const profile = profiles.find(p => p.id === currentProfileId);
  if (profile && profile.trainingData) {
    // Deep copy to allow abandoning changes without corrupting original
    window.renderTrainingReview(JSON.parse(JSON.stringify(profile.trainingData)));
  }
};

window.renderTrainingReview = (sessionData) => {
  hideAllSections();
  reviewSection.style.display = 'block';
  
  // Deduplicate sessionData to prevent identical requests from cluttering rules
  const uniqueLogs = [];
  const seenSignatures = new Set();
  
  (sessionData || []).forEach(req => {
     let sig = req.method + '|' + req.url;
     if (req.method !== 'GET' && req.method !== 'HEAD' && req.postData) {
         sig += '|' + req.postData;
     }
     if (!seenSignatures.has(sig)) {
         seenSignatures.add(sig);
         uniqueLogs.push(req);
     }
  });
  
  trainingLogs = uniqueLogs; // Full array of unique requested monitored data
  
  
  reviewContainer.innerHTML = '';
  if (!trainingLogs || trainingLogs.length === 0) {
    reviewContainer.innerHTML = '<p>No requests were captured during the session.</p>';
    return;
  }
  
  const profile = profiles.find(p => p.id === currentProfileId);
  let mainDomain = '';
  try { mainDomain = new URL(profile.startUrl).hostname.replace(/^www\./, ''); } catch(e) {}

  const grouped = {};
  let currentMainPage = profile ? profile.startUrl : 'Unknown Page';

  trainingLogs.forEach(req => {
    let reqDomain = '';
    try { reqDomain = new URL(req.url).hostname.replace(/^www\./, ''); } catch(e) {}
    
    const isThirdParty = mainDomain && reqDomain && !reqDomain.endsWith(mainDomain);
    req.isThirdParty = isThirdParty;

    if (req.type === 'Document' && !isThirdParty) {
      currentMainPage = req.url;
    }
    
    if (!grouped[currentMainPage]) grouped[currentMainPage] = [];
    grouped[currentMainPage].push(req);
  });
  
  Object.keys(grouped).forEach(pageUrl => {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'review-group';
    
    const pageHeader = document.createElement('div');
    pageHeader.className = 'review-page-url';
    pageHeader.innerText = `Page: ${pageUrl}`;
    groupDiv.appendChild(pageHeader);
    
    const createReqDiv = (req) => {
      const reqDiv = document.createElement('div');
      reqDiv.className = 'review-request';
      reqDiv.dataset.isThirdParty = req.isThirdParty ? 'true' : 'false';
      
      let isRes = false;
      try {
         if (req.url.match(/\.(css|js|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|ico)(\?.*)?$/i)) isRes = true;
      } catch(e) {}
      if (!isRes) {
         const importantTypes = ['Document', 'Fetch', 'XHR', 'WebSocket'];
         if (req.type && !importantTypes.includes(req.type)) isRes = true;
      }
      reqDiv.dataset.isResource = isRes ? 'true' : 'false';
      
      reqDiv.onclick = function() {
        this.querySelector('.request-details-pane').classList.toggle('open');
      };
      
      let typeStr = req.type || 'Document';
      let statusStr = req.status ? req.status : (req.errorText ? `Failed (${req.errorText})` : 'Pending');
      let timeStr = req.timeTaken ? req.timeTaken + 'ms' : '-';
      
      let reqHeadersStr = '';
      if (req.headers) {
        reqHeadersStr = Object.entries(req.headers).map(([k,v]) => `${k}: ${v}`).join('\n');
      }
      
      let resHeadersStr = '';
      if (req.responseHeaders) {
        resHeadersStr = Object.entries(req.responseHeaders).map(([k,v]) => `${k}: ${v}`).join('\n');
      }
      
      let payloadHtml = '';
      if (req.postData) {
        let safePostData = req.postData.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        payloadHtml = `
          <div style="margin-bottom: 8px;"><strong>Request Payload</strong></div>
          <div style="background: #e2e8f0; padding: 8px; border-radius: 4px; margin-bottom: 12px; white-space: pre-wrap;">${safePostData}</div>
        `;
      }
      
      let jsonValHtml = '';
      if (req.responseBody) {
        try {
          const jsonObj = JSON.parse(req.responseBody);
          if (jsonObj && typeof jsonObj === 'object' && !Array.isArray(jsonObj)) {
            const keys = Object.keys(jsonObj);
            
            if (keys.length > 0) {
               // Look for historical config to pre-fill
               let historicalConfig = null;
               const profile = profiles.find(p => p.id === currentProfileId);
               if (profile && profile.trainingData) {
                  const baseUrl = req.url.split('?')[0];
                  const match = profile.trainingData.find(r => r.url && r.url.split('?')[0] === baseUrl && r.method === req.method && r.jsonSuccessCriteria);
                  if (match) historicalConfig = match.jsonSuccessCriteria;
               }
               
               let keysHtml = keys.map(k => {
                 let isChecked = false;
                 let valStr = '';
                 if (historicalConfig && historicalConfig[k]) {
                    isChecked = true;
                    if (historicalConfig[k] !== '*') {
                       valStr = historicalConfig[k].join(', ');
                    }
                 }
                 
                 return `
                   <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;" onclick="event.stopPropagation()">
                     <input type="checkbox" id="chk_${req.id}_${k}" onchange="toggleJsonCfg('${req.id}', '${k}')" ${isChecked ? 'checked' : ''}>
                     <label for="chk_${req.id}_${k}" style="font-weight:bold; width:120px; overflow:hidden; text-overflow:ellipsis;">${k}</label>
                     <input type="text" id="val_${req.id}_${k}" value="${valStr}" placeholder="Expected value (e.g. true, 1)" style="flex:1; display:${isChecked ? 'block' : 'none'}; padding:4px;" class="input-text">
                   </div>
                 `;
               }).join('');
               
               jsonValHtml = `
                 <div style="margin-top:16px; border-top: 1px solid #cbd5e1; padding-top:12px;" onclick="event.stopPropagation()">
                   <h4 style="margin:0 0 4px 0; color:#0f172a;">Extract & Validate JSON</h4>
                   <p style="font-size:12px; color:#64748b; margin-bottom:12px;">Select fields to extract. Optionally provide expected values (comma separated) to validate success.</p>
                   <div id="json_cfg_${req.id}">
                     ${keysHtml}
                   </div>
                 </div>
               `;
               
               req.jsonSuccessCriteriaRawKeys = keys;
            }
          }
        } catch(e) {}
      }
      
      reqDiv.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <div class="review-request-url" style="margin:0; max-width: 80%;"><strong>${req.method}</strong> ${req.url}</div>
          <div class="status-badge ${req.status >= 200 && req.status < 300 ? 'active' : ''}">${statusStr}</div>
        </div>
        <div class="req-detail" style="margin-top: 4px;">
          <strong>Type:</strong> ${typeStr} <span style="margin:0 8px;">|</span> <strong>Time:</strong> ${timeStr}
        </div>
        
        <div class="request-details-pane" onclick="event.stopPropagation()">
          <div class="req-grid">
            <div class="req-label">URL</div><div class="req-value">${req.url}</div>
            <div class="req-label">Method</div><div class="req-value">${req.method}</div>
            <div class="req-label">Status</div><div class="req-value">${statusStr}</div>
            <div class="req-label">Time Taken</div><div class="req-value">${timeStr}</div>
            <div class="req-label">Resource Type</div><div class="req-value">${typeStr}</div>
            ${req.mimeType ? `<div class="req-label">Mime Type</div><div class="req-value">${req.mimeType}</div>` : ''}
          </div>
          
          <div style="margin-bottom: 8px;"><strong>Request Headers</strong></div>
          <div style="background: #e2e8f0; padding: 8px; border-radius: 4px; margin-bottom: 12px; white-space: pre-wrap;">${reqHeadersStr || 'None'}</div>
          
          ${payloadHtml}
          
          <div style="margin-bottom: 8px;"><strong>Response Headers</strong></div>
          <div style="background: #e2e8f0; padding: 8px; border-radius: 4px; white-space: pre-wrap;">${resHeadersStr || 'None'}</div>
          
          ${jsonValHtml}
        </div>
      `;
      return reqDiv;
    };

    const resourceTypes = ['Stylesheet', 'Script', 'Image', 'Font', 'Media', 'Manifest', 'Other'];
    const primaryReqs = [];
    const resourceReqs = [];
        grouped[pageUrl].forEach(req => {
        if (resourceTypes.includes(req.type) || req.isThirdParty) {
          resourceReqs.push(req);
        } else {
          primaryReqs.push(req);
        }
      });
      
      primaryReqs.forEach(req => groupDiv.appendChild(createReqDiv(req)));
      
      if (resourceReqs.length > 0) {
        const resToggleDiv = document.createElement('div');
        resToggleDiv.className = 'review-request';
        resToggleDiv.style.background = '#f8fafc';
        resToggleDiv.style.fontWeight = '500';
        resToggleDiv.style.color = '#475569';
        resToggleDiv.style.borderTop = '1px solid #e2e8f0';
        resToggleDiv.innerHTML = `&#9656; View ${resourceReqs.length} Background / 3rd-Party Resources`;
        
        const resContainer = document.createElement('div');
        resContainer.style.display = 'none';
        resContainer.style.borderTop = '1px solid #e2e8f0';
        
        resToggleDiv.onclick = function() {
           if (resContainer.style.display === 'none') {
             resContainer.style.display = 'block';
             this.innerHTML = `&#9662; Hide ${resourceReqs.length} Background / 3rd-Party Resources`;
           } else {
             resContainer.style.display = 'none';
             this.innerHTML = `&#9656; View ${resourceReqs.length} Background / 3rd-Party Resources`;
           }
        };

      resourceReqs.forEach(req => {
         resContainer.appendChild(createReqDiv(req));
      });

      groupDiv.appendChild(resToggleDiv);
      groupDiv.appendChild(resContainer);
    }
    
    reviewContainer.appendChild(groupDiv);
  });
  
  if (typeof window.applyReviewFilters === 'function') {
      window.applyReviewFilters();
  }
};

window.applyReviewFilters = () => {
    const showThirdParty = document.getElementById('cfg-test-thirdparty') ? document.getElementById('cfg-test-thirdparty').checked : false;
    const showResources = document.getElementById('cfg-test-resources') ? document.getElementById('cfg-test-resources').checked : false;
    
    document.querySelectorAll('.review-request').forEach(div => {
        let visible = true;
        if (div.dataset.isThirdParty === "true" && !showThirdParty) visible = false;
        if (div.dataset.isResource === "true" && !showResources) visible = false;
        div.style.display = visible ? 'block' : 'none';
        
        // Hide the parent group if all its requests are hidden
        const group = div.closest('.review-group');
        if (group) {
            const allReqs = Array.from(group.querySelectorAll('.review-request'));
            const anyVisible = allReqs.some(r => r.style.display !== 'none');
            group.style.display = anyVisible ? 'block' : 'none';
        }
    });
};

ipcRenderer.on('training-complete', (event, sessionData) => {
  window.renderTrainingReview(sessionData);
});

  ipcRenderer.on('test-aborted', (event, profileId) => {
    if (currentProfileId === profileId) {
      isTesting = false;
      const profile = profiles.find(p => p.id === currentProfileId);
      if (profile) showView(profile);
    }
  });

  ipcRenderer.on('test-completed', (event, profileId, result) => {
    const profile = profiles.find(p => p.id === profileId);
    if (profile) {
      if (!profile.testRuns) profile.testRuns = [];
      profile.testRuns.push(result);
      saveProfiles();
      
      if (currentProfileId === profileId) {
        isTesting = false;
        showView(profile);
      }
    }
  });

loadProfiles();
