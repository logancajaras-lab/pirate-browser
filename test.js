const { app, BrowserWindow } = require('electron');
app.whenReady().then(() => {
  const win = new BrowserWindow({ webPreferences: { webviewTag: true, nodeIntegration: true, contextIsolation: false } });
  win.loadURL(`data:text/html,<webview id="wv" src="about:blank"></webview><script>
    setTimeout(() => { 
      try {
        const id = document.getElementById("wv").getWebContentsId();
        require("fs").writeFileSync("test_wc.log", "WCID: " + id);
      } catch (e) {
        require("fs").writeFileSync("test_wc.log", "ERROR: " + e.message);
      }
      process.exit(0); 
    }, 2000);
  </script>`);
});
