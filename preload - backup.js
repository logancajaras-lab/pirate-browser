const { ipcRenderer } = require('electron');

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
