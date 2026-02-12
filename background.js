// Background service worker for Job Tracker extension
// Handles Airtable API communication

// Handle extension icon click - toggle panel in content script
chrome.action.onClicked.addListener(async (tab) => {
  // Check if we can inject into this tab
  if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
    // Open options page if on a chrome:// URL
    chrome.runtime.openOptionsPage();
    return;
  }

  try {
    // First try to send message to existing content script
    await chrome.tabs.sendMessage(tab.id, { action: 'togglePanel' });
  } catch (error) {
    // Content script not loaded, inject it first
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ['styles.css']
      });
      // Now send the toggle message
      setTimeout(async () => {
        try {
          await chrome.tabs.sendMessage(tab.id, { action: 'togglePanel' });
        } catch (e) {
          console.log('Could not toggle panel:', e);
        }
      }, 100);
    } catch (injectError) {
      console.log('Could not inject content script:', injectError);
    }
  }
});

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'saveToAirtable') {
    handleSaveToAirtable(request.data)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep message channel open for async response
  }

  if (request.action === 'testConnection') {
    testAirtableConnection()
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'getSettings') {
    getSettings()
      .then(settings => sendResponse({ success: true, settings }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'openOptions') {
    chrome.runtime.openOptionsPage();
    sendResponse({ success: true });
    return true;
  }
});

// Get settings from chrome storage
async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['airtableSettings'], (result) => {
      resolve(result.airtableSettings || {});
    });
  });
}

// Test connection to Airtable
async function testAirtableConnection() {
  const settings = await getSettings();

  console.log('Testing connection with settings:', {
    hasToken: !!settings.apiToken,
    tokenStart: settings.apiToken ? settings.apiToken.substring(0, 10) + '...' : 'none',
    baseId: settings.baseId,
    tableName: settings.tableName
  });

  if (!settings.apiToken || !settings.baseId) {
    return { success: false, error: 'Missing API token or Base ID. Please configure in settings.' };
  }

  const apiToken = settings.apiToken.trim();
  const baseId = settings.baseId.trim();
  const tableName = encodeURIComponent(settings.tableName || 'Job Applications');

  const url = `https://api.airtable.com/v0/${baseId}/${tableName}?maxRecords=1`;
  console.log('Testing URL:', url);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiToken}`
      }
    });

    console.log('Response status:', response.status);

    if (response.ok) {
      return { success: true, message: 'Connection successful' };
    } else {
      const errorData = await response.json();
      console.log('Error response:', errorData);
      return { success: false, error: errorData.error?.message || `HTTP ${response.status}` };
    }
  } catch (error) {
    console.error('Network error:', error);
    return { success: false, error: 'Network error: ' + error.message };
  }
}

// Save job data to Airtable
async function handleSaveToAirtable(jobData) {
  const settings = await getSettings();

  if (!settings.apiToken || !settings.baseId) {
    throw new Error('Airtable not configured. Please add your API token and Base ID in settings.');
  }

  const tableName = encodeURIComponent(settings.tableName || 'Job Applications');
  const airtableRecord = formatForAirtable(jobData);

  const response = await fetch(
    `https://api.airtable.com/v0/${settings.baseId}/${tableName}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${settings.apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        records: [{ fields: airtableRecord }],
        typecast: true // Auto-convert values to match field types
      })
    }
  );

  if (!response.ok) {
    const errorData = await response.json();
    const errorMessage = errorData.error?.message || `API Error: ${response.status}`;

    // Provide helpful error messages
    if (response.status === 401) {
      throw new Error('Invalid API token. Please check your settings.');
    } else if (response.status === 403) {
      throw new Error('Access denied. Make sure your token has write permissions for this base.');
    } else if (response.status === 404) {
      throw new Error('Table not found. Please verify your Base ID and table name.');
    } else if (response.status === 422) {
      throw new Error('Invalid data format: ' + errorMessage);
    } else if (response.status === 429) {
      throw new Error('Rate limit exceeded. Please wait a moment and try again.');
    }

    throw new Error(errorMessage);
  }

  const result = await response.json();
  return { success: true, record: result.records[0] };
}

// Format job data for Airtable fields
// Field names must match user's actual Airtable columns exactly
function formatForAirtable(jobData) {
  const record = {};

  // Map each field to Airtable column name
  // Only include fields that have values
  if (jobData.company) record['Company'] = jobData.company;
  if (jobData.jobTitle) record['Job Title'] = jobData.jobTitle;
  if (jobData.jobType) record['Job Type'] = jobData.jobType;
  if (jobData.workModel) record['Work Model'] = jobData.workModel;
  if (jobData.salary) record['Salary'] = jobData.salary;
  if (jobData.location) record['Location'] = jobData.location;
  if (jobData.dateApplied) record['Date Applied'] = jobData.dateApplied;
  if (jobData.status) record['Status'] = jobData.status;
  if (jobData.source) record['Source'] = jobData.source;
  if (jobData.link) record['Link'] = jobData.link;
  if (jobData.notes) record['Notes'] = jobData.notes;

  return record;
}
