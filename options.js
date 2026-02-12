// Options page for RoleSync extension

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();

  document.getElementById('settings-form').addEventListener('submit', saveSettings);
  document.getElementById('test-btn').addEventListener('click', testConnection);
});

// Load saved settings from storage
async function loadSettings() {
  try {
    const result = await chrome.storage.local.get(['airtableSettings']);
    const settings = result.airtableSettings || {};

    if (settings.apiToken) {
      document.getElementById('api-token').value = settings.apiToken;
    }
    if (settings.baseId) {
      document.getElementById('base-id').value = settings.baseId;
    }
    if (settings.tableName) {
      document.getElementById('table-name').value = settings.tableName;
    }

    // If we have settings, test the connection
    if (settings.apiToken && settings.baseId) {
      testConnection();
    }
  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

// Save settings to storage
async function saveSettings(e) {
  e.preventDefault();

  const apiToken = document.getElementById('api-token').value.trim();
  const baseId = document.getElementById('base-id').value.trim();
  const tableName = document.getElementById('table-name').value.trim() || 'Job Applications';

  // Validate inputs
  if (!apiToken) {
    showMessage('Please enter your API token', 'error');
    return;
  }

  if (!baseId) {
    showMessage('Please enter your Base ID', 'error');
    return;
  }

  if (!baseId.startsWith('app')) {
    showMessage('Base ID should start with "app"', 'error');
    return;
  }

  // Save to storage
  try {
    await chrome.storage.local.set({
      airtableSettings: {
        apiToken,
        baseId,
        tableName
      }
    });

    showMessage('Settings saved successfully!', 'success');

    // Test connection after saving
    testConnection();
  } catch (error) {
    showMessage('Error saving settings: ' + error.message, 'error');
  }
}

// Test the Airtable connection
async function testConnection() {
  const testBtn = document.getElementById('test-btn');
  const statusEl = document.getElementById('connection-status');
  const statusText = document.getElementById('status-text');

  // Get current form values
  const apiToken = document.getElementById('api-token').value.trim();
  const baseId = document.getElementById('base-id').value.trim();
  const tableName = document.getElementById('table-name').value.trim() || 'Job Applications';

  // Validate before testing
  if (!apiToken) {
    statusEl.className = 'connection-status disconnected';
    statusText.textContent = 'Please enter your API token';
    return;
  }

  if (!baseId) {
    statusEl.className = 'connection-status disconnected';
    statusText.textContent = 'Please enter your Base ID';
    return;
  }

  testBtn.disabled = true;
  testBtn.textContent = 'Testing...';

  statusEl.className = 'connection-status unknown';
  statusText.textContent = 'Saving and testing...';

  try {
    // Save current form values first (so test uses latest values)
    await chrome.storage.local.set({
      airtableSettings: {
        apiToken,
        baseId,
        tableName
      }
    });

    const response = await chrome.runtime.sendMessage({ action: 'testConnection' });

    if (response.success) {
      statusEl.className = 'connection-status connected';
      statusText.textContent = 'Connected to Airtable';
      showMessage('Settings saved and connected!', 'success');
    } else {
      statusEl.className = 'connection-status disconnected';
      statusText.textContent = response.error || 'Connection failed';
    }
  } catch (error) {
    statusEl.className = 'connection-status disconnected';
    statusText.textContent = 'Error: ' + error.message;
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = 'Test Connection';
  }
}

// Show a message to the user
function showMessage(text, type) {
  const messageEl = document.getElementById('message');
  messageEl.textContent = text;
  messageEl.className = 'message ' + type;

  // Auto-hide success messages after 3 seconds
  if (type === 'success') {
    setTimeout(() => {
      messageEl.className = 'message';
    }, 3000);
  }
}
