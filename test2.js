const { app, BrowserWindow } = require('electron');
app.whenReady().then(() => {
  const win = new BrowserWindow({ webPreferences: { webviewTag: true, nodeIntegration: true, contextIsolation: false } });
  win.loadURL(`data:text/html,<webview id="wv" src="about:blank"></webview><script>
    setTimeout(() => { 
      try {
        const wc = document.getElementById("wv").getWebContents();
        require("fs").writeFileSync("test_wc2.log", "Has debugger: " + !!(wc && wc.debugger));
      } catch (e) {
        require("fs").writeFileSync("test_wc2.log", "ERROR: " + e.message);
      }
      process.exit(0); 
    }, 2000);
  </script>`);
});
