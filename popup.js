// Popup script for RoleSync extension

document.addEventListener('DOMContentLoaded', init);

async function init() {
  // Check if Airtable is configured
  const configured = await checkConfiguration();

  if (!configured) {
    showConfigWarning();
  }

  // Set up event listeners
  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('open-settings')?.addEventListener('click', openSettings);
  document.getElementById('job-form').addEventListener('submit', handleSubmit);
  document.getElementById('save-another')?.addEventListener('click', resetForm);

  // Get job data from current tab
  await loadJobData();

  // Check connection status
  checkConnectionStatus();
}

// Check if Airtable settings are configured
async function checkConfiguration() {
  try {
    const result = await chrome.storage.local.get(['airtableSettings']);
    const settings = result.airtableSettings || {};
    return !!(settings.apiToken && settings.baseId);
  } catch (error) {
    console.error('Error checking configuration:', error);
    return false;
  }
}

// Show configuration warning banner
function showConfigWarning() {
  document.getElementById('config-warning').classList.remove('hidden');
}

// Open settings page
function openSettings() {
  chrome.runtime.openOptionsPage();
}

// Load job data from content script or storage
async function loadJobData() {
  showState('loading');

  try {
    // First try to get data from the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab && tab.id) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'getJobData' });

        if (response && response.success && response.data) {
          populateForm(response.data);
          showState('form');
          return;
        }
      } catch (e) {
        // Content script not loaded on this page, try storage
        console.log('Content script not available, checking storage');
      }
    }

    // Fall back to stored data ONLY if URL matches current tab
    const result = await chrome.storage.local.get(['pendingJobData']);
    if (result.pendingJobData && result.pendingJobData.link) {
      try {
        const cachedUrl = new URL(result.pendingJobData.link);
        const currentUrl = tab && tab.url ? new URL(tab.url) : null;

        // Only use cached data if domains match
        if (currentUrl && cachedUrl.hostname === currentUrl.hostname) {
          populateForm(result.pendingJobData);
          showState('form');
          return;
        } else {
          // Clear stale cached data
          await chrome.storage.local.remove(['pendingJobData']);
        }
      } catch (urlError) {
        // Invalid URLs, clear cache
        await chrome.storage.local.remove(['pendingJobData']);
      }
    }

    // No job data found
    showState('no-job');
  } catch (error) {
    console.error('Error loading job data:', error);
    showState('no-job');
  }
}

// Populate form with job data
function populateForm(data) {
  // Text fields
  document.getElementById('company').value = data.company || '';
  document.getElementById('jobTitle').value = data.jobTitle || '';
  document.getElementById('salary').value = data.salary || '';
  document.getElementById('location').value = data.location || '';
  document.getElementById('notes').value = data.notes || '';

  // Select fields
  setSelectValue('jobType', data.jobType);
  setSelectValue('workModel', data.workModel);
  setSelectValue('status', data.status || 'Applied');

  // Date fields
  if (data.dateApplied) {
    document.getElementById('dateApplied').value = formatDateForInput(data.dateApplied);
  }

  // Hidden fields
  document.getElementById('link').value = data.link || '';

  // Update source dropdown and link
  const sourceSelect = document.getElementById('source-badge');
  const jobLink = document.getElementById('job-link');

  if (data.source) {
    // Set the source dropdown value
    setSelectValue('source-badge', data.source);
  }

  if (data.link) {
    jobLink.href = data.link;
    jobLink.classList.remove('hidden');
  } else {
    jobLink.classList.add('hidden');
  }
}

// Set select value, handling cases where value might not match options exactly
function setSelectValue(id, value) {
  const select = document.getElementById(id);
  if (!value) {
    select.value = '';
    return;
  }

  // Try exact match first
  const option = Array.from(select.options).find(opt =>
    opt.value.toLowerCase() === value.toLowerCase()
  );

  if (option) {
    select.value = option.value;
  } else {
    select.value = '';
  }
}

// Format date string for input[type="date"]
function formatDateForInput(dateStr) {
  if (!dateStr) return '';

  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '';

    return date.toISOString().split('T')[0];
  } catch {
    return '';
  }
}

// Handle form submission
async function handleSubmit(e) {
  e.preventDefault();

  // Validate required fields
  const company = document.getElementById('company').value.trim();
  const jobTitle = document.getElementById('jobTitle').value.trim();

  if (!company || !jobTitle) {
    showError('Company and Job Title are required.');
    return;
  }

  // Collect form data
  const formData = {
    company,
    jobTitle,
    jobType: document.getElementById('jobType').value,
    workModel: document.getElementById('workModel').value,
    salary: document.getElementById('salary').value.trim(),
    location: document.getElementById('location').value.trim(),
    dateApplied: document.getElementById('dateApplied').value,
    status: document.getElementById('status').value,
    source: document.getElementById('source-badge').value,
    link: document.getElementById('link').value,
    notes: document.getElementById('notes').value.trim()
  };

  // Show loading state
  setButtonLoading(true);
  hideError();

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'saveToAirtable',
      data: formData
    });

    if (response.success) {
      // Clear stored data
      await chrome.storage.local.remove(['pendingJobData']);
      showState('success');
    } else {
      showError(response.error || 'Failed to save job. Please try again.');
    }
  } catch (error) {
    console.error('Error saving job:', error);
    showError('Failed to save job: ' + error.message);
  } finally {
    setButtonLoading(false);
  }
}

// Show/hide different states
function showState(state) {
  const states = ['loading', 'no-job', 'form', 'success'];

  states.forEach(s => {
    const el = document.getElementById(s === 'loading' ? 'loading-state' :
      s === 'no-job' ? 'no-job-state' :
        s === 'form' ? 'job-form' :
          'success-state');

    if (el) {
      el.classList.toggle('hidden', s !== state);
    }
  });

  // Show footer only when form is visible
  const footer = document.getElementById('popup-footer');
  if (footer) {
    footer.classList.toggle('hidden', state !== 'form');
  }
}

// Show error message
function showError(message) {
  const errorEl = document.getElementById('error-message');
  errorEl.textContent = message;
  errorEl.classList.remove('hidden');
}

// Hide error message
function hideError() {
  const errorEl = document.getElementById('error-message');
  errorEl.classList.add('hidden');
}

// Set button loading state
function setButtonLoading(loading) {
  const btn = document.getElementById('save-btn');
  const btnText = btn.querySelector('.btn-text');
  const btnLoading = btn.querySelector('.btn-loading');

  btn.disabled = loading;
  btnText.classList.toggle('hidden', loading);
  btnLoading.classList.toggle('hidden', !loading);
}

// Reset form to save another job
function resetForm() {
  document.getElementById('job-form').reset();
  showState('form');
  loadJobData();
}

// Check Airtable connection status
async function checkConnectionStatus() {
  const statusEl = document.getElementById('connection-status');
  const statusText = document.getElementById('status-text');

  try {
    const response = await chrome.runtime.sendMessage({ action: 'testConnection' });

    if (response.success) {
      statusEl.classList.add('connected');
      statusEl.classList.remove('disconnected');
      statusText.textContent = 'Connected to Airtable';
    } else {
      statusEl.classList.add('disconnected');
      statusEl.classList.remove('connected');
      statusText.textContent = 'Not connected';
    }
  } catch (error) {
    statusEl.classList.add('disconnected');
    statusEl.classList.remove('connected');
    statusText.textContent = 'Connection error';
  }
}
