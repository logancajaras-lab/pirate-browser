const { ipcRenderer } = require('electron');

const progressText = document.getElementById('progress-text');
const progressFill = document.getElementById('progress-fill');
const logBox = document.getElementById('log-box');
const runningView = document.getElementById('running-view');
const doneView = document.getElementById('done-view');

const urlParams = new URLSearchParams(window.location.search);
const profileId = urlParams.get('profileId');

let trainingData = [];
let profileData = null;
let testResults = {
  timestamp: Date.now(),
  totalTime: 0,
  total: 0,
  passed: 0,
  results: []
};

function addLog(msg, type = 'info') {
  const div = document.createElement('div');
  div.className = `log-item log-${type}`;
  div.innerHTML = msg;
  logBox.appendChild(div);
  logBox.scrollTop = logBox.scrollHeight;
}

async function runTests() {
  if (!profileId) {
    addLog('No profile ID provided.', 'error');
    return;
  }
  
  trainingData = await ipcRenderer.invoke('get-testing-data', profileId);
  profileData = await ipcRenderer.invoke('get-profile', profileId);
  
  if (!trainingData || trainingData.length === 0) {
    addLog('No training data found for this profile.', 'error');
    return;
  }
  
  // Filter out internal URLs or data URIs
  const validRequests = trainingData.filter(req => {
    return req.url && !req.url.startsWith('data:') && !req.url.startsWith('file:') && !req.url.startsWith('devtools:');
  });
  
  testResults.total = validRequests.length;
  
  addLog(`Starting test with ${validRequests.length} requests...`, 'info');
  
  const startTime = Date.now();
  
  for (let i = 0; i < validRequests.length; i++) {
    const req = validRequests[i];
    progressText.innerText = `Running request ${i + 1} of ${validRequests.length}...`;
    progressFill.style.width = `${((i + 1) / validRequests.length) * 100}%`;
    
    addLog(`[${req.method}] ${req.url}`);
    
    const reqStart = Date.now();
    let actualStatus = null;
    let expectedStatus = req.status || (req.responseHeaders ? 200 : null);
    let responseBody = '';
    let responseHeaders = {};
    
    if (!expectedStatus) {
       expectedStatus = req.errorText ? 'Failed' : 200;
    }
    
    try {
      const fetchOpts = {
        method: req.method,
        url: req.url,
        headers: Object.assign({}, req.headers || {}),
        postData: (req.method !== 'GET' && req.method !== 'HEAD') ? req.postData : undefined
      };
      
      // Inject fresh auth headers if available
      if (profileData && profileData.authHeaders) {
        try {
          const reqDomain = new URL(req.url).hostname;
          const domainAuth = profileData.authHeaders[reqDomain];
          if (domainAuth) {
            for (const [k, v] of Object.entries(domainAuth)) {
               fetchOpts.headers[k] = v;
            }
          }
        } catch(e) {}
      }
      
      const res = await ipcRenderer.invoke('execute-test-request', fetchOpts, profileId);
      actualStatus = res.status;
      responseHeaders = res.headers || {};
      responseBody = String(res.body || '');
      if (responseBody.length > 50000) {
         responseBody = responseBody.substring(0, 50000) + '\n... (truncated)';
      }
      
    } catch (e) {
      actualStatus = 'Failed';
      responseBody = String(e);
    }
    
    const timeTaken = Date.now() - reqStart;
    let isSuccess = String(actualStatus) === String(expectedStatus);
    let jsonErrorMsg = null;
    let extractedFields = null;
    
    if (req.jsonSuccessCriteria && Object.keys(req.jsonSuccessCriteria).length > 0) {
      try {
        const jsonObj = JSON.parse(responseBody);
        extractedFields = {};
        
        for (const [key, expectedValues] of Object.entries(req.jsonSuccessCriteria)) {
           const actualVal = String(jsonObj[key]);
           extractedFields[key] = actualVal;
           
           if (expectedValues && expectedValues.length > 0) {
              if (!expectedValues.includes(actualVal)) {
                 isSuccess = false;
                 jsonErrorMsg = `JSON mismatch: '${key}' was '${actualVal}' (Expected one of: ${expectedValues.join(', ')})`;
                 break;
              }
           }
        }
      } catch(e) {
        isSuccess = false;
        let rawPreview = String(responseBody).substring(0, 150);
        if (!rawPreview) rawPreview = '(Empty or no response body)';
        jsonErrorMsg = `Failed to parse JSON response for validation. Raw response: ${rawPreview}`;
      }
    }
    
    if (isSuccess) {
      testResults.passed++;
      addLog(`&nbsp;&nbsp;&nbsp;&check; Success! Expected: ${expectedStatus}, Got: ${actualStatus} (${timeTaken}ms)`, 'success');
    } else {
      const extraErr = jsonErrorMsg ? ` | ${jsonErrorMsg}` : '';
      addLog(`&nbsp;&nbsp;&nbsp;&times; Failed! Expected: ${expectedStatus}, Got: ${actualStatus}${extraErr} (${timeTaken}ms)`, 'error');
    }
    
    testResults.results.push({
      url: req.url,
      method: req.method,
      type: req.type,
      expectedStatus,
      actualStatus,
      timeTaken,
      headers: req.headers,
      postData: req.postData,
      responseHeaders,
      responseBody,
      jsonErrorMsg,
      extractedFields,
      expectedJsonCriteria: req.jsonSuccessCriteria
    });
    
    await new Promise(r => setTimeout(r, 100));
  }
  
  testResults.totalTime = Date.now() - startTime;
  
  setTimeout(() => {
    runningView.style.display = 'none';
    doneView.style.display = 'block';
    ipcRenderer.send('test-completed', profileId, testResults);
  }, 1000);
}

runTests();
