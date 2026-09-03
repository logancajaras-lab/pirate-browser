const { app, BrowserWindow, webContents } = require('electron');
app.whenReady().then(() => {
  const win = new BrowserWindow({ webPreferences: { webviewTag: true } });
  win.loadURL(`data:text/html,<webview id="wv" src="about:blank?test=1"></webview>`);
  setTimeout(() => {
    const all = webContents.getAllWebContents();
    let out = "";
    all.forEach(wc => {
      out += wc.getURL() + " | " + wc.id + "\n";
    });
    require('fs').writeFileSync('test_wc3.log', out);
    process.exit(0);
  }, 2000);
});
