const { ipcRenderer } = require('electron');

// Stealth navigator overrides
try {
  const stealthSettings = ipcRenderer.sendSync('get-stealth-settings-sync');
  
  if (stealthSettings.enabled && stealthSettings.config) {
    const config = stealthSettings.config;
    
    // Override Navigator
    const navOverrides = {
      deviceMemory: config.deviceMemory,
      hardwareConcurrency: config.hardwareConcurrency,
      maxTouchPoints: config.maxTouchPoints,
      language: config.language,
      languages: config.languages,
      webdriver: false
    };

    for (const [key, value] of Object.entries(navOverrides)) {
      if (value !== undefined) {
        Object.defineProperty(navigator, key, { get: () => value });
        if (Object.getPrototypeOf(navigator)) {
          Object.defineProperty(Object.getPrototypeOf(navigator), key, { get: () => value });
        }
      }
    }
    
    // Override Window properties
    if (config.window) {
      for (const [key, value] of Object.entries(config.window)) {
        Object.defineProperty(window, key, { get: () => value });
      }
    }
    
    // Override Screen properties
    if (config.screen) {
      for (const [key, value] of Object.entries(config.screen)) {
        Object.defineProperty(screen, key, { get: () => value });
      }
    }
    
    // Override Connection properties
    if (config.connection && navigator.connection) {
      for (const [key, value] of Object.entries(config.connection)) {
        Object.defineProperty(navigator.connection, key, { get: () => value });
        if (Object.getPrototypeOf(navigator.connection)) {
          Object.defineProperty(Object.getPrototypeOf(navigator.connection), key, { get: () => value });
        }
      }
    }

    // Override Timezone
    if (config.timezoneOffset !== undefined) {
      Date.prototype.getTimezoneOffset = function() {
        return config.timezoneOffset;
      };
    }
    if (config.timezone !== undefined && window.Intl) {
      const originalResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
      Intl.DateTimeFormat.prototype.resolvedOptions = function() {
        const options = originalResolvedOptions.call(this);
        options.timeZone = config.timezone;
        return options;
      };
    }
  } else {
    // Default fallback if stealth is disabled
    const overrides = {
      deviceMemory: 32,
      hardwareConcurrency: 12,
      language: 'en-IN',
      languages: ['en-IN', 'en-GB', 'en-US', 'en', 'ml'],
      webdriver: false
    };
    for (const [key, value] of Object.entries(overrides)) {
      Object.defineProperty(navigator, key, { get: () => value });
      if (Object.getPrototypeOf(navigator)) {
        Object.defineProperty(Object.getPrototypeOf(navigator), key, { get: () => value });
      }
    }
  }
} catch (e) {}

const detectedMediaUrls = new Map();

function looksLikeMediaUrl(value) {
  if (!value || typeof value !== 'string') return false;
  if (value.startsWith('blob:') || value.startsWith('data:')) return false;

  const lower = value.toLowerCase();
  return (
    lower.includes('.m3u8') ||
    lower.includes('.mpd') ||
    lower.includes('.mp4') ||
    lower.includes('.webm') ||
    lower.includes('videoplayback') ||
    lower.includes('video_redirect') ||
    lower.includes('fbcdn.net') && (lower.includes('bytestart') || lower.includes('byteend') || lower.includes('oh=') || lower.includes('__gda__'))
  );
}

function reportMediaUrl(url, type = 'Page Media') {
  if (!looksLikeMediaUrl(url)) return;

  const now = Date.now();
  const lastSeen = detectedMediaUrls.get(url) || 0;
  if (now - lastSeen < 5000) return;
  detectedMediaUrls.set(url, now);
  if (detectedMediaUrls.size > 500) detectedMediaUrls.clear();

  ipcRenderer.send('page-media-detected', { url, type });
}

function installMediaRequestHooks() {
  if (window.__pirateMediaHooksInstalled) return;
  window.__pirateMediaHooksInstalled = true;

  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = async function(...args) {
      const requestUrl = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url);
      reportMediaUrl(requestUrl, 'Fetch Media');

      const response = await originalFetch.apply(this, args);
      try {
        const contentType = response.headers && response.headers.get('content-type');
        if (contentType && /video|mpegurl|dash\+xml|mp4|webm/i.test(contentType)) {
          reportMediaUrl(response.url || requestUrl, contentType.includes('dash') ? 'DASH Stream' : 'Fetch Media');
        }
      } catch (e) {}
      return response;
    };
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__pirateRequestUrl = url;
    reportMediaUrl(url, 'XHR Media');
    return originalOpen.call(this, method, url, ...rest);
  };

  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function(...args) {
    this.addEventListener('loadstart', () => reportMediaUrl(this.__pirateRequestUrl, 'XHR Media'));
    this.addEventListener('load', () => {
      try {
        const contentType = this.getResponseHeader('content-type');
        if (contentType && /video|mpegurl|dash\+xml|mp4|webm/i.test(contentType)) {
          reportMediaUrl(this.responseURL || this.__pirateRequestUrl, contentType.includes('dash') ? 'DASH Stream' : 'XHR Media');
        }
      } catch (e) {}
    });
    return originalSend.apply(this, args);
  };

  setInterval(() => {
    document.querySelectorAll('video').forEach(video => {
      reportMediaUrl(video.currentSrc, 'Video Element');
      reportMediaUrl(video.src, 'Video Element');
      video.querySelectorAll('source[src]').forEach(source => reportMediaUrl(source.src, 'Video Element'));
    });

    try {
      performance.getEntriesByType('resource').forEach(entry => {
        if (/video|media|fetch|xmlhttprequest/i.test(entry.initiatorType || '') || looksLikeMediaUrl(entry.name)) {
          reportMediaUrl(entry.name, 'Resource Media');
        }
      });
    } catch (e) {}
  }, 2000);
}

installMediaRequestHooks();

document.addEventListener('DOMContentLoaded', async () => {
  const hostname = window.location.hostname;
  
  // Try to autofill credentials
  const credentials = await ipcRenderer.invoke('get-credentials', hostname);
  if (credentials) {
    const passwordInputs = document.querySelectorAll('input[type="password"]');
    passwordInputs.forEach(passInput => {
      // Find a likely username field before the password field
      const form = passInput.closest('form') || document;
      const textInputs = Array.from(form.querySelectorAll('input[type="text"], input[type="email"], input:not([type])'));
      const userInput = textInputs.find(input => 
        input.name.toLowerCase().includes('user') || 
        input.name.toLowerCase().includes('email') || 
        input.id.toLowerCase().includes('user')
      ) || textInputs[0]; // fallback to first text input

      if (userInput && credentials.username) {
        userInput.value = credentials.username;
      }
      passInput.value = credentials.password;
    });
  }

  // Intercept form submissions to save credentials
  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (form.tagName === 'FORM') {
      const passInput = form.querySelector('input[type="password"]');
      if (passInput && passInput.value) {
        const textInputs = Array.from(form.querySelectorAll('input[type="text"], input[type="email"], input:not([type])'));
        const userInput = textInputs.find(input => 
          input.name.toLowerCase().includes('user') || 
          input.name.toLowerCase().includes('email') || 
          input.id.toLowerCase().includes('user')
        ) || textInputs[0];

        const username = userInput ? userInput.value : '';
        const password = passInput.value;

        ipcRenderer.send('save-credentials', {
          hostname,
          username,
          password
        });
      }
    }
  }, true);
});

// Chrome-like Zoom handling
window.addEventListener('wheel', (e) => {
  if (e.ctrlKey) {
    e.preventDefault();
    const action = e.deltaY > 0 ? 'out' : 'in';
    ipcRenderer.sendToHost('webview-zoom', action);
  }
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey) {
    if (e.key === '=' || e.key === '+') {
      e.preventDefault();
      ipcRenderer.sendToHost('webview-zoom', 'in');
    } else if (e.key === '-') {
      e.preventDefault();
      ipcRenderer.sendToHost('webview-zoom', 'out');
    } else if (e.key === '0') {
      e.preventDefault();
      ipcRenderer.sendToHost('webview-zoom', 'reset');
    }
  }
});
