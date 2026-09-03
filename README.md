# Pirate Browser 🏴‍☠️

A customized, fully open-source browser designed with powerful privacy, stealth, and media extraction tools built right in. Pirate Browser is lightweight, fully transparent, and built on Electron.

## ✨ Key Features

### 🌐 Complete Browser Experience
A fully-featured web browser with seamless multi-tab support, history tracking, bookmarks, and a clean, customizable user interface.

### 🥷 Stealth Mode
Browse securely and privately with built-in stealth features. Prevent fingerprinting, block trackers, mask your User-Agent, and customize your network headers on the fly to bypass restrictions.

### 📥 Universal Stream Downloader
Download media from almost anywhere on the web natively. Pirate Browser automatically intercepts and parses video streams (including complex HLS and DASH streams) and offers a one-click download. 
* Works perfectly with Facebook, Instagram, and more!
* Multi-threaded downloading for maximum speed.
* Powered by native integrations with `ffmpeg` and `yt-dlp`.

### 🤖 Automation Tools
Built-in web automation and testing suite to script repetitive tasks or test web applications without needing external heavy frameworks like Puppeteer or Selenium.

### 🛡️ 100% Open Source & Safe
No hidden telemetry, no shady background processes. The entire codebase is open-source and fully transparent so you know exactly what is running on your machine.

---

## 🛠️ Installation & Build

**Prerequisites:** Node.js

1. Clone the repository:
   ```bash
   git clone https://github.com/logancajaras-lab/pirate-browser.git
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the browser locally:
   ```bash
   npm start
   ```
4. Build portable executable (Windows):
   ```bash
   npm run build
   ```