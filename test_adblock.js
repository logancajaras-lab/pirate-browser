const { session, app } = require('electron');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');

app.whenReady().then(async () => {
  const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
  const blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch);
  
  const dummySession = session.fromPartition('dummy');
  let hooks = [];
  
  // Mock webRequest
  dummySession.webRequest.onBeforeRequest = () => hooks.push('onBeforeRequest');
  dummySession.webRequest.onBeforeSendHeaders = () => hooks.push('onBeforeSendHeaders');
  dummySession.webRequest.onHeadersReceived = () => hooks.push('onHeadersReceived');
  dummySession.webRequest.onResponseStarted = () => hooks.push('onResponseStarted');
  dummySession.webRequest.onCompleted = () => hooks.push('onCompleted');
  dummySession.webRequest.onErrorOccurred = () => hooks.push('onErrorOccurred');

  blocker.enableBlockingInSession(dummySession);
  
  console.log("Hooks registered by Ghostery: ", hooks.join(', '));
  app.quit();
});
