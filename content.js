// Content script for RoleSync extension
// Detects job sites and extracts job posting data

(function() {
  'use strict';

  // Store extracted data for popup retrieval
  let extractedJobData = null;
  let currentSite = null;

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    currentSite = detectSite();
    console.log('RoleSync: Initialized on', window.location.hostname, '- Detected site:', currentSite);

    if (currentSite) {
      // Wait for dynamic content to load (especially for SPAs like LinkedIn)
      waitForJobContent().then(() => {
        extractedJobData = extractJobData();
        console.log('RoleSync: Final extracted data:', extractedJobData);
        injectSaveButton();
        storeDataForPopup();
      });

      // Re-extract when URL changes (SPA navigation)
      observeUrlChanges();
    } else {
      console.log('RoleSync: No job site detected');
    }
  }

  // ==================== SITE DETECTION ====================

  function detectSite() {
    const hostname = window.location.hostname;
    const pathname = window.location.pathname;

    if (hostname.includes('linkedin.com') && pathname.includes('/jobs/')) {
      return 'linkedin';
    }
    if (hostname.includes('joinhandshake.com')) {
      return 'handshake';
    }
    if (hostname.includes('ziprecruiter.com') && (pathname.includes('/jobs/') || pathname.includes('/c/'))) {
      return 'ziprecruiter';
    }
    if (isCareerPage()) {
      return 'generic';
    }
    return null;
  }

  function isCareerPage() {
    const url = window.location.href.toLowerCase();
    const indicators = [
      'greenhouse.io', 'lever.co', 'workday.com', 'myworkdayjobs.com',
      'icims.com', 'smartrecruiters.com', 'jobvite.com', 'ashbyhq.com',
      '/careers/', '/jobs/', '/job/', '/opportunities/', '/positions/'
    ];
    return indicators.some(ind => url.includes(ind));
  }

  // ==================== WAIT FOR CONTENT ====================

  function waitForJobContent() {
    return new Promise((resolve) => {
      console.log('RoleSync: Waiting for job content on', currentSite);

      // Site-specific selectors to wait for
      const selectors = {
        linkedin: '.job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, .topcard__title, h1.t-24, .job-view-layout h1',
        handshake: '[data-hook="job-title"], h1',
        ziprecruiter: 'h1.job_title, .job_header h1, h1',
        generic: 'h1'
      };

      const selector = selectors[currentSite] || 'h1';
      const element = document.querySelector(selector);

      if (element && element.textContent.trim()) {
        console.log('RoleSync: Content found immediately');
        resolve();
        return;
      }

      // Use MutationObserver for dynamic content
      const observer = new MutationObserver((mutations, obs) => {
        const el = document.querySelector(selector);
        if (el && el.textContent.trim()) {
          console.log('RoleSync: Content found via observer');
          obs.disconnect();
          resolve();
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      // Timeout fallback - increased to 8 seconds for slow-loading LinkedIn pages
      setTimeout(() => {
        console.log('RoleSync: Timeout reached, proceeding anyway');
        observer.disconnect();
        resolve();
      }, 8000);
    });
  }

  // ==================== DATA EXTRACTION ====================

  function extractJobData() {
    let data = {};

    switch (currentSite) {
      case 'linkedin':
        data = extractLinkedIn();
        break;
      case 'handshake':
        data = extractHandshake();
        break;
      case 'ziprecruiter':
        data = extractZipRecruiter();
        break;
      case 'generic':
      default:
        data = extractGeneric();
        break;
    }

    // Always set source and link
    data.source = getSourceName();
    data.link = cleanUrl(window.location.href);
    data.status = 'Not Applied'; // Default status

    return normalizeJobData(data);
  }

  // ==================== LINKEDIN EXTRACTION ====================

  function extractLinkedIn() {
    const data = {};

    console.log('RoleSync: Extracting LinkedIn data...');

    // Job Title - try multiple selectors (updated for current LinkedIn DOM)
    const titleSelectors = [
      '.job-details-jobs-unified-top-card__job-title h1',
      '.job-details-jobs-unified-top-card__job-title a',
      '.job-details-jobs-unified-top-card__job-title',
      '.jobs-unified-top-card__job-title h1',
      '.jobs-unified-top-card__job-title a',
      '.jobs-unified-top-card__job-title',
      'h1.t-24.t-bold.inline',
      'h1.t-24.t-bold',
      '.jobs-details-top-card__job-title',
      '.topcard__title',
      '.job-details h1',
      '.jobs-details h1',
      '.job-view-layout h1'
    ];
    data.jobTitle = getFirstMatch(titleSelectors);
    console.log('RoleSync: Found title:', data.jobTitle);

    // Company - updated selectors
    const companySelectors = [
      '.job-details-jobs-unified-top-card__company-name a',
      '.job-details-jobs-unified-top-card__company-name',
      '.job-details-jobs-unified-top-card__primary-description-container a',
      '.jobs-unified-top-card__company-name a',
      '.jobs-unified-top-card__company-name',
      '.jobs-details-top-card__company-url',
      '.topcard__org-name-link',
      '.jobs-company__name a',
      'a[data-tracking-control-name="public_jobs_topcard-org-name"]',
      'a[data-tracking-control-name="public_jobs_topcard_org-name"]'
    ];
    data.company = getFirstMatch(companySelectors);
    console.log('RoleSync: Found company:', data.company);

    // Location - updated selectors
    const locationSelectors = [
      '.job-details-jobs-unified-top-card__primary-description-container .tvm__text',
      '.job-details-jobs-unified-top-card__bullet',
      '.jobs-unified-top-card__bullet',
      '.jobs-unified-top-card__subtitle-primary-grouping .tvm__text',
      '.jobs-details-top-card__bullet',
      '.topcard__flavor--bullet',
      '.jobs-company__location',
      '.job-details-jobs-unified-top-card__primary-description-container span.tvm__text'
    ];
    data.location = getFirstMatch(locationSelectors);
    console.log('RoleSync: Found location:', data.location);

    // --- Job insights: jobType, workModel, salary ---
    // LinkedIn packs these into insight elements, often combining
    // "Full-time · Remote" or "Full-time · Hybrid" in one span.
    const insightSelectors = [
      '.job-details-jobs-unified-top-card__job-insight',
      '.job-details-jobs-unified-top-card__job-insight-view-model-secondary',
      '.jobs-unified-top-card__job-insight',
      '.job-details-preferences-and-skills .job-details-preferences-and-skills__pill',
      '.jobs-description-content__text li',
      '.description__job-criteria-item',
      // Individual spans inside insight containers
      '.job-details-jobs-unified-top-card__job-insight span',
      '.jobs-unified-top-card__job-insight span'
    ];
    const insights = document.querySelectorAll(insightSelectors.join(', '));
    console.log('RoleSync: Found insights:', insights.length);

    insights.forEach(insight => {
      const text = insight.textContent.toLowerCase();

      // Work model detection
      if (!data.workModel) {
        if (text.includes('remote') || text.includes('hybrid') || text.includes('on-site') || text.includes('onsite') || text.includes('in-office') || text.includes('in office')) {
          data.workModel = extractWorkModel(insight.textContent);
        }
      }

      // Job type detection
      if (!data.jobType) {
        if (text.includes('full-time') || text.includes('full time') || text.includes('part-time') || text.includes('part time') || text.includes('contract') || text.includes('internship') || text.includes('intern ') || text.includes('temporary') || text.includes('freelance') || text.includes('volunteer')) {
          data.jobType = extractJobType(insight.textContent);
        }
      }

      // Salary detection
      if (!data.salary) {
        if (text.includes('$') || text.includes('€') || text.includes('£') || text.includes('/yr') || text.includes('/hr') || text.includes('/year') || text.includes('/hour') || text.includes('salary') || text.includes('compensation') || text.includes('per year') || text.includes('per hour') || text.includes('annually')) {
          data.salary = cleanText(insight.textContent);
        }
      }
    });

    // Try the primary description area (contains "City · Type · Model" line)
    if (!data.jobType || !data.workModel) {
      const primaryDescSelectors = [
        '.job-details-jobs-unified-top-card__primary-description-container',
        '.job-details-jobs-unified-top-card__primary-description',
        '.jobs-unified-top-card__subtitle-primary-grouping'
      ];
      for (const sel of primaryDescSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          const text = el.textContent;
          if (!data.jobType) data.jobType = extractJobType(text);
          if (!data.workModel) data.workModel = extractWorkModel(text);
          break;
        }
      }
    }

    // Try the job criteria section (older LinkedIn layout)
    if (!data.jobType || !data.workModel) {
      const criteriaItems = document.querySelectorAll('.description__job-criteria-item');
      criteriaItems.forEach(item => {
        const header = item.querySelector('.description__job-criteria-subheader');
        const value = item.querySelector('.description__job-criteria-text');
        if (header && value) {
          const headerText = header.textContent.toLowerCase().trim();
          const valueText = value.textContent.trim();
          if (headerText.includes('employment type') && !data.jobType) {
            data.jobType = extractJobType(valueText);
          }
          if (headerText.includes('job function') || headerText.includes('workplace type')) {
            if (!data.workModel) data.workModel = extractWorkModel(valueText);
          }
        }
      });
    }

    // Fallback: scan the full job description body
    if (!data.jobType || !data.workModel || !data.salary) {
      const descSelectors = [
        '.jobs-description-content__text',
        '.jobs-description__content',
        '.job-details-jobs-unified-top-card__job-description',
        '#job-details',
        '.jobs-box__html-content',
        'article'
      ];
      for (const sel of descSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          const descText = el.textContent;
          if (!data.jobType) data.jobType = extractJobType(descText);
          if (!data.workModel) data.workModel = extractWorkModel(descText);
          if (!data.salary) data.salary = extractSalaryFromText(descText);
          break;
        }
      }
    }

    console.log('RoleSync: Extracted data:', data);
    return data;
  }

  // ==================== HANDSHAKE EXTRACTION ====================

  function extractHandshake() {
    const data = {};

    // Try JSON-LD first
    const jsonLdData = extractJsonLd();
    if (jsonLdData.jobTitle) {
      Object.assign(data, jsonLdData);
    }

    // Job Title
    if (!data.jobTitle) {
      const titleSelectors = [
        '[data-hook="job-title"]',
        'h1[class*="JobTitle"]',
        '.style__job-title',
        'h1'
      ];
      data.jobTitle = getFirstMatch(titleSelectors);
    }

    // Company
    if (!data.company) {
      const companySelectors = [
        '[data-hook="employer-name"]',
        'a[href*="/employers/"]',
        '[class*="EmployerName"]'
      ];
      data.company = getFirstMatch(companySelectors);
    }

    // Location
    const locationSelectors = [
      '[data-hook="job-location"]',
      '[class*="JobLocation"]',
      '[class*="location"]'
    ];
    data.location = data.location || getFirstMatch(locationSelectors);

    // Deadline
    const deadlineSelectors = [
      '[data-hook="apply-deadline"]',
      '[class*="deadline"]',
      'time[datetime]'
    ];
    const deadlineEl = document.querySelector(deadlineSelectors.join(', '));
    if (deadlineEl) {
      data.deadline = deadlineEl.getAttribute('datetime') || deadlineEl.textContent.trim();
    }

    // Job Type
    const jobTypeSelectors = [
      '[data-hook="job-type"]',
      '[class*="employment-type"]'
    ];
    data.jobType = data.jobType || getFirstMatch(jobTypeSelectors);

    // Salary
    const salarySelectors = [
      '[data-hook="compensation"]',
      '[class*="salary"]',
      '[class*="compensation"]'
    ];
    data.salary = data.salary || getFirstMatch(salarySelectors);

    return data;
  }

  // ==================== ZIPRECRUITER EXTRACTION ====================

  function extractZipRecruiter() {
    const data = {};

    // Try JSON-LD first
    const jsonLdData = extractJsonLd();
    if (jsonLdData.jobTitle) {
      Object.assign(data, jsonLdData);
    }

    // Job Title
    if (!data.jobTitle) {
      const titleSelectors = [
        'h1.job_title',
        '.job_header h1',
        '[data-testid="job-title"]',
        'h1[class*="Title"]',
        'h1'
      ];
      data.jobTitle = getFirstMatch(titleSelectors);
    }

    // Company
    if (!data.company) {
      const companySelectors = [
        'a.company_name',
        '[data-testid="employer-name"]',
        '.hiring_company_text a',
        '.company_name'
      ];
      data.company = getFirstMatch(companySelectors);
    }

    // Location
    const locationSelectors = [
      '.job_location',
      '[data-testid="job-location"]',
      '.location_text'
    ];
    data.location = data.location || getFirstMatch(locationSelectors);

    // Salary
    const salarySelectors = [
      '.job_salary',
      '[data-testid="salary"]',
      '.salary_text'
    ];
    data.salary = data.salary || getFirstMatch(salarySelectors);

    // Job Type
    const jobTypeSelectors = [
      '.job_type',
      '[data-testid="job-type"]',
      '.employment_type'
    ];
    data.jobType = data.jobType || getFirstMatch(jobTypeSelectors);

    return data;
  }

  // ==================== GENERIC EXTRACTION ====================

  function extractGeneric() {
    const data = {};

    // Priority 1: JSON-LD structured data
    const jsonLdData = extractJsonLd();
    if (jsonLdData.jobTitle) {
      Object.assign(data, jsonLdData);
    }

    // Priority 2: Common patterns for job title
    if (!data.jobTitle) {
      const titleCandidates = [
        document.querySelector('h1'),
        document.querySelector('[class*="job-title"]'),
        document.querySelector('[class*="job_title"]'),
        document.querySelector('[class*="jobTitle"]'),
        document.querySelector('[class*="position-title"]'),
        document.querySelector('[class*="posting-title"]'),
        document.querySelector('[data-automation*="title"]'),
        document.querySelector('[data-testid*="title"]')
      ];
      const titleEl = titleCandidates.find(el => el && el.textContent.trim());
      data.jobTitle = titleEl ? titleEl.textContent.trim() : '';
    }

    // Priority 3: Meta tags for title
    if (!data.jobTitle) {
      data.jobTitle = document.querySelector('meta[property="og:title"]')?.content || '';
    }

    // Company from URL patterns or page content
    if (!data.company) {
      data.company = extractCompanyFromUrl() ||
        getFirstMatch([
          '[class*="company-name"]',
          '[class*="companyName"]',
          '[class*="company_name"]',
          '[class*="employer"]',
          '[data-automation*="company"]',
          '[data-testid*="company"]'
        ]) ||
        document.querySelector('meta[property="og:site_name"]')?.content || '';
    }

    // Location
    if (!data.location) {
      data.location = getFirstMatch([
        '[class*="job-location"]',
        '[class*="jobLocation"]',
        '[class*="job_location"]',
        '[class*="location"]',
        '[data-automation*="location"]',
        '[data-testid*="location"]'
      ]);
    }

    // Job type from structured elements
    if (!data.jobType) {
      data.jobType = getFirstMatch([
        '[class*="employment-type"]',
        '[class*="employmentType"]',
        '[class*="employment_type"]',
        '[class*="job-type"]',
        '[class*="jobType"]',
        '[class*="job_type"]',
        '[data-automation*="employment"]',
        '[data-testid*="job-type"]'
      ]);
    }

    // Work model from structured elements
    if (!data.workModel) {
      data.workModel = getFirstMatch([
        '[class*="workplace-type"]',
        '[class*="workplaceType"]',
        '[class*="work-model"]',
        '[class*="workModel"]',
        '[class*="remote"]'
      ]);
    }

    // Salary from structured elements
    if (!data.salary) {
      data.salary = getFirstMatch([
        '[class*="salary"]',
        '[class*="compensation"]',
        '[class*="pay-range"]',
        '[class*="payRange"]',
        '[data-automation*="salary"]',
        '[data-testid*="salary"]'
      ]);
    }

    // Fallback: scan full page body for missing fields
    if (!data.jobType || !data.workModel || !data.salary) {
      const bodySelectors = [
        '.job-description',
        '[class*="job-description"]',
        '[class*="jobDescription"]',
        '[class*="posting-description"]',
        '[class*="description"]',
        'article',
        'main',
        '.content'
      ];
      for (const sel of bodySelectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent.length > 100) {
          const descText = el.textContent;
          if (!data.jobType) data.jobType = extractJobType(descText);
          if (!data.workModel) data.workModel = extractWorkModel(descText);
          if (!data.salary) data.salary = extractSalaryFromText(descText);
          break;
        }
      }
    }

    return data;
  }

  // ==================== HELPER FUNCTIONS ====================

  function getFirstMatch(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent.trim()) {
        return element.textContent.trim();
      }
    }
    return '';
  }

  function extractJsonLd() {
    const data = {};
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');

    for (const script of scripts) {
      try {
        const json = JSON.parse(script.textContent);
        const jobPosting = findJobPosting(json);

        if (jobPosting) {
          data.jobTitle = jobPosting.title || '';
          data.company = jobPosting.hiringOrganization?.name || '';
          data.location = extractLocationFromJsonLd(jobPosting.jobLocation);
          data.salary = formatSalaryFromJsonLd(jobPosting.baseSalary);
          data.deadline = jobPosting.validThrough || '';
          const empType = jobPosting.employmentType;
          data.jobType = Array.isArray(empType) ? empType.join(', ') : (empType || '');
          // JSON-LD jobLocationType indicates remote/telecommute
          const locType = jobPosting.jobLocationType;
          if (locType) {
            const locTypeStr = Array.isArray(locType) ? locType.join(', ') : locType;
            data.workModel = locTypeStr;
          }
          break;
        }
      } catch (e) {
        // Ignore parse errors
      }
    }

    return data;
  }

  function findJobPosting(json) {
    if (json['@type'] === 'JobPosting') return json;
    if (Array.isArray(json)) {
      return json.find(item => item['@type'] === 'JobPosting');
    }
    if (json['@graph']) {
      return json['@graph'].find(item => item['@type'] === 'JobPosting');
    }
    return null;
  }

  function extractLocationFromJsonLd(jobLocation) {
    if (!jobLocation) return '';
    if (typeof jobLocation === 'string') return jobLocation;
    if (Array.isArray(jobLocation)) {
      jobLocation = jobLocation[0];
    }
    if (jobLocation.address) {
      const addr = jobLocation.address;
      const parts = [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean);
      return parts.join(', ');
    }
    return jobLocation.name || '';
  }

  function formatSalaryFromJsonLd(baseSalary) {
    if (!baseSalary) return '';
    if (typeof baseSalary === 'string') return baseSalary;

    const value = baseSalary.value;
    const currency = baseSalary.currency || 'USD';

    if (!value) return '';

    if (typeof value === 'object') {
      if (value.minValue && value.maxValue) {
        return `${formatCurrency(value.minValue, currency)} - ${formatCurrency(value.maxValue, currency)}`;
      }
      return formatCurrency(value.value || value.minValue || value.maxValue, currency);
    }

    return formatCurrency(value, currency);
  }

  function formatCurrency(amount, currency) {
    if (!amount) return '';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
      maximumFractionDigits: 0
    }).format(amount);
  }

  function extractCompanyFromUrl() {
    const url = window.location.hostname;
    const pathname = window.location.pathname;

    // Greenhouse: boards.greenhouse.io/companyname
    if (url.includes('greenhouse.io')) {
      const match = pathname.match(/^\/([^\/]+)/);
      return match ? formatCompanyName(match[1]) : '';
    }

    // Lever: jobs.lever.co/companyname
    if (url.includes('lever.co')) {
      const match = pathname.match(/^\/([^\/]+)/);
      return match ? formatCompanyName(match[1]) : '';
    }

    // Workday: companyname.wd5.myworkdayjobs.com
    if (url.includes('myworkdayjobs.com')) {
      const match = url.match(/([^.]+)\.wd\d*\.myworkdayjobs/);
      return match ? formatCompanyName(match[1]) : '';
    }

    return '';
  }

  function formatCompanyName(name) {
    // Convert kebab-case or underscore to title case
    return name
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  function extractWorkModel(text) {
    if (!text) return '';
    const lower = text.toLowerCase().replace(/[_\-]/g, ' ');
    // Order matters: check "hybrid" before "remote" since some listings say "remote/hybrid"
    if (lower.includes('hybrid')) return 'Hybrid';
    if (lower.includes('remote') || lower.includes('telecommute') || lower.includes('work from home') || lower.includes('wfh')) return 'Remote';
    if (lower.includes('on site') || lower.includes('onsite') || lower.includes('in office') || lower.includes('in person')) return 'On-site';
    return '';
  }

  function extractJobType(text) {
    if (!text) return '';
    // Normalize underscores/hyphens and lowercase for matching
    const lower = text.toLowerCase().replace(/[_\-]/g, ' ');
    // Check most specific patterns first to avoid false positives
    // (e.g., "intern" matching inside "international")
    if (lower.includes('full time') || lower.includes('fulltime')) return 'Full-time';
    if (lower.includes('part time') || lower.includes('parttime')) return 'Part-time';
    if (lower.includes('internship') || /\bintern\b/.test(lower)) return 'Internship';
    if (lower.includes('contract') || lower.includes('contractor') || lower.includes('freelance')) return 'Contract';
    if (lower.includes('temporary') || lower.includes('temp ') || lower.includes('seasonal')) return 'Temporary';
    if (lower.includes('volunteer')) return 'Volunteer';
    return '';
  }

  function extractSalaryFromText(text) {
    if (!text) return '';
    // Match common salary patterns: $80,000 - $100,000, $50/hr, $80K-$100K, etc.
    const patterns = [
      /\$[\d,]+(?:\.\d{2})?\s*[-–—to]+\s*\$[\d,]+(?:\.\d{2})?\s*(?:\/?\s*(?:yr|year|hr|hour|annually|per\s+year|per\s+hour|a\s+year))?/i,
      /\$[\d,]+(?:\.\d{2})?\s*(?:\/?\s*(?:yr|year|hr|hour|annually|per\s+year|per\s+hour|a\s+year))/i,
      /\$\d+[kK]\s*[-–—to]+\s*\$\d+[kK]/i,
      /(?:salary|compensation|pay)[:\s]*\$[\d,]+(?:\.\d{2})?(?:\s*[-–—to]+\s*\$[\d,]+(?:\.\d{2})?)?/i,
      /(?:€|£)[\d,]+(?:\.\d{2})?\s*[-–—to]+\s*(?:€|£)[\d,]+(?:\.\d{2})?/i
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[0].trim();
    }
    return '';
  }

  function extractCompanyFromPageTitle() {
    const title = document.title;
    if (!title) return '';

    // Common patterns: "Software Engineer at Google | LinkedIn"
    const atMatch = title.match(/(?:at|@)\s+([^|–\-\u2013\u2014]+)/i);
    if (atMatch) {
      return atMatch[1].trim();
    }

    // Pattern: "Google - Software Engineer" or "Google | Software Engineer"
    const prefixMatch = title.match(/^([^|\-–\u2013\u2014]+?)[\s]*[|\-–\u2013\u2014]/);
    if (prefixMatch) {
      const potential = prefixMatch[1].trim();
      // Avoid returning job titles (usually have common job words)
      const jobWords = ['engineer', 'developer', 'manager', 'analyst', 'designer', 'specialist', 'coordinator', 'associate', 'director', 'lead', 'senior', 'junior'];
      const isJobTitle = jobWords.some(word => potential.toLowerCase().includes(word));
      if (!isJobTitle && potential.length > 2 && potential.length < 50) {
        return potential;
      }
    }

    // Pattern: "Company Name: Job Title"
    const colonMatch = title.match(/^([^:]+):/);
    if (colonMatch) {
      const potential = colonMatch[1].trim();
      if (potential.length > 2 && potential.length < 50) {
        return potential;
      }
    }

    return '';
  }

  function normalizeJobData(data) {
    // Get company - prioritize extracted data, only use page title as last resort
    let company = cleanText(data.company) || '';
    if (!company) {
      // Try page title only if we have no company at all
      const titleCompany = extractCompanyFromPageTitle();
      // Validate it's not actually a job title (common mistake)
      const jobWords = ['engineer', 'developer', 'manager', 'analyst', 'designer', 'specialist', 'coordinator', 'associate', 'director', 'lead', 'senior', 'junior', 'intern', 'remote', 'job', 'position', 'opening', 'opportunity'];
      const isLikelyJobTitle = jobWords.some(word => titleCompany.toLowerCase().includes(word));
      if (titleCompany && !isLikelyJobTitle) {
        company = titleCompany;
      }
    }

    // Normalize jobType: re-run through extractJobType to ensure it matches
    // dropdown values exactly (handles JSON-LD formats like "FULL_TIME")
    const rawJobType = cleanText(data.jobType) || '';
    const normalizedJobType = extractJobType(rawJobType) || rawJobType;
    // Only keep the value if it matches a known dropdown option
    const validJobTypes = ['Full-time', 'Part-time', 'Contract', 'Internship', 'Temporary'];
    const finalJobType = validJobTypes.includes(normalizedJobType) ? normalizedJobType : '';

    // Normalize workModel similarly
    const rawWorkModel = cleanText(data.workModel) || '';
    const normalizedWorkModel = extractWorkModel(rawWorkModel) || rawWorkModel;
    const validWorkModels = ['Remote', 'Hybrid', 'On-site'];
    const finalWorkModel = validWorkModels.includes(normalizedWorkModel) ? normalizedWorkModel : '';

    return {
      company: company,
      jobTitle: cleanText(data.jobTitle) || '',
      jobType: finalJobType,
      workModel: finalWorkModel,
      salary: cleanText(data.salary) || '',
      location: cleanText(data.location) || '',
      dateApplied: '',
      status: data.status || 'Not Applied',
      source: data.source || '',
      link: data.link || '',
      notes: ''
    };
  }

  function cleanText(text) {
    if (!text) return '';
    return text
      .replace(/\s+/g, ' ')
      .replace(/\n/g, ' ')
      .trim();
  }

  function cleanUrl(url) {
    // Remove tracking parameters
    try {
      const urlObj = new URL(url);
      const paramsToRemove = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref', 'refId', 'trackingId'];
      paramsToRemove.forEach(param => urlObj.searchParams.delete(param));
      return urlObj.toString();
    } catch {
      return url;
    }
  }

  function getSourceName() {
    switch (currentSite) {
      case 'linkedin': return 'LinkedIn';
      case 'handshake': return 'Handshake';
      case 'ziprecruiter': return 'ZipRecruiter';
      default: return 'Career Page';
    }
  }

  // ==================== UI INJECTION ====================

  function injectSaveButton() {
    // Remove existing button if present
    const existing = document.getElementById('job-tracker-save-btn');
    if (existing) existing.remove();

    const button = document.createElement('button');
    button.id = 'job-tracker-save-btn';
    button.className = 'job-tracker-floating-btn';
    button.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/>
        <polyline points="17,21 17,13 7,13 7,21"/>
        <polyline points="7,3 7,8 15,8"/>
      </svg>
      <span>Save Job</span>
    `;

    button.addEventListener('click', () => {
      // Open the panel directly
      togglePanel();
    });

    document.body.appendChild(button);
  }

  function showToast(message) {
    const existing = document.getElementById('job-tracker-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'job-tracker-toast';
    toast.className = 'job-tracker-toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // ==================== DATA STORAGE ====================

  function storeDataForPopup() {
    if (extractedJobData) {
      chrome.storage.local.set({ pendingJobData: extractedJobData });
    }
  }

  // ==================== URL CHANGE OBSERVER ====================

  function observeUrlChanges() {
    let lastUrl = window.location.href;

    const observer = new MutationObserver(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;

        // Re-detect site and re-extract after URL change
        setTimeout(() => {
          currentSite = detectSite();
          if (currentSite) {
            waitForJobContent().then(() => {
              extractedJobData = extractJobData();
              injectSaveButton();
              storeDataForPopup();
            });
          }
        }, 1000);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // ==================== MESSAGE LISTENER ====================

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getJobData') {
      // Re-extract fresh data
      if (currentSite) {
        extractedJobData = extractJobData();
      }
      sendResponse({
        success: !!extractedJobData,
        data: extractedJobData,
        site: currentSite
      });
    }

    if (request.action === 'togglePanel') {
      togglePanel();
      sendResponse({ success: true });
    }
    return true;
  });

  // ==================== FLOATING PANEL ====================

  let panelVisible = false;
  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  function togglePanel() {
    const existingPanel = document.getElementById('job-tracker-panel');

    if (existingPanel) {
      if (panelVisible) {
        existingPanel.classList.add('hidden');
        panelVisible = false;
      } else {
        existingPanel.classList.remove('hidden');
        panelVisible = true;
        // Refresh data when showing
        if (currentSite) {
          extractedJobData = extractJobData();
          populatePanelForm(extractedJobData);
        }
      }
    } else {
      // Create panel if it doesn't exist
      createPanel();
    }
  }

  function createPanel() {
    // Re-extract data
    if (currentSite) {
      extractedJobData = extractJobData();
    }

    const panel = document.createElement('div');
    panel.id = 'job-tracker-panel';
    panel.className = 'job-tracker-panel';
    panel.innerHTML = `
      <div class="panel-header" id="panel-header">
        <div class="panel-title">
          <span>RoleSync</span>
        </div>
        <div class="panel-actions">
          <button class="panel-settings-btn" id="panel-settings" title="Settings">⚙</button>
          <button class="panel-minimize-btn" id="panel-minimize" title="Minimize">−</button>
          <button class="panel-close-btn" id="panel-close" title="Close">×</button>
        </div>
      </div>
      <div class="panel-body" id="panel-body">
        <form id="panel-job-form">
          <!-- Company -->
          <div class="panel-form-group">
            <label for="panel-company">Company <span class="required">*</span></label>
            <input type="text" id="panel-company" name="company" required placeholder="e.g., Google, Apple">
          </div>

          <!-- Job Title -->
          <div class="panel-form-group">
            <label for="panel-jobTitle">Job Title <span class="required">*</span></label>
            <input type="text" id="panel-jobTitle" name="jobTitle" required placeholder="e.g., Software Engineer">
          </div>

          <!-- Two-column: Job Type, Work Model -->
          <div class="panel-form-row">
            <div class="panel-form-group half">
              <label for="panel-jobType">Job Type</label>
              <select id="panel-jobType" name="jobType">
                <option value="">Select...</option>
                <option value="Full-time">Full-time</option>
                <option value="Part-time">Part-time</option>
                <option value="Contract">Contract</option>
                <option value="Internship">Internship</option>
                <option value="Temporary">Temporary</option>
              </select>
            </div>
            <div class="panel-form-group half">
              <label for="panel-workModel">Work Model</label>
              <select id="panel-workModel" name="workModel">
                <option value="">Select...</option>
                <option value="Remote">Remote</option>
                <option value="Hybrid">Hybrid</option>
                <option value="On-site">On-site</option>
              </select>
            </div>
          </div>

          <!-- Salary -->
          <div class="panel-form-group">
            <label for="panel-salary">Salary</label>
            <input type="text" id="panel-salary" name="salary" placeholder="e.g., $80,000 - $100,000">
          </div>

          <!-- Location -->
          <div class="panel-form-group">
            <label for="panel-location">Location</label>
            <input type="text" id="panel-location" name="location" placeholder="e.g., San Francisco, CA">
          </div>

          <!-- Two-column: Status, Date Applied -->
          <div class="panel-form-row">
            <div class="panel-form-group half">
              <label for="panel-status">Status</label>
              <select id="panel-status" name="status">
                <option value="Not Applied" selected>Not Applied</option>
                <option value="Applied">Applied</option>
              </select>
            </div>
            <div class="panel-form-group half">
              <label for="panel-dateApplied">Date Applied</label>
              <input type="date" id="panel-dateApplied" name="dateApplied">
            </div>
          </div>

          <!-- Notes -->
          <div class="panel-form-group">
            <label for="panel-notes">Notes</label>
            <textarea id="panel-notes" name="notes" rows="2" placeholder="Add any notes..."></textarea>
          </div>

          <!-- Source (full width dropdown with copy link button) -->
          <div class="panel-meta-info">
            <div class="panel-source-row">
              <span class="panel-source-label">Source</span>
              <select id="panel-source" class="panel-source-select" name="source">
                <option value="LinkedIn">LinkedIn</option>
                <option value="Handshake">Handshake</option>
                <option value="ZipRecruiter">ZipRecruiter</option>
                <option value="Career Page">Career Page</option>
                <option value="Other">Other</option>
              </select>
              <button type="button" id="panel-copy-link" class="panel-copy-link-btn" title="Copy job URL">
                <span class="copy-icon">🔗</span>
              </button>
            </div>
          </div>

          <!-- Hidden link field (always saved) -->
          <input type="hidden" id="panel-link" name="link">

          <!-- Error message -->
          <div id="panel-error" class="panel-error hidden"></div>

          <!-- Submit Button -->
          <button type="submit" id="panel-save-btn" class="panel-save-button">
            <span class="btn-text">Save to Airtable</span>
            <span class="btn-loading hidden">
              <span class="panel-spinner"></span>
              Saving...
            </span>
          </button>

          <!-- Success Row (inline, below save button) -->
          <div id="panel-success-row" class="panel-success-row hidden">
            <div class="panel-success-badge">
              <span class="success-checkmark">✓</span>
              <span class="success-text">Job saved</span>
            </div>
            <button type="button" id="panel-save-another" class="panel-save-another-btn">Save Another Job</button>
          </div>
        </form>

        <!-- Connection Status (at very bottom of panel) -->
        <div id="panel-connection-status" class="panel-connection-status">
          <span class="panel-status-dot"></span>
          <span class="panel-status-text">Connected to Airtable</span>
        </div>

        <!-- Resize handle -->
        <div class="panel-resize-handle" id="panel-resize-handle"></div>
      </div>
    `;

    document.body.appendChild(panel);

    // Position panel on the right side of viewport
    panel.style.right = '24px';
    panel.style.top = '100px';

    // Set up event listeners
    setupPanelEvents(panel);

    // Populate form with extracted data
    populatePanelForm(extractedJobData);

    panelVisible = true;
  }

  function setupPanelEvents(panel) {
    const header = panel.querySelector('#panel-header');
    const closeBtn = panel.querySelector('#panel-close');
    const minimizeBtn = panel.querySelector('#panel-minimize');
    const form = panel.querySelector('#panel-job-form');
    const saveAnotherBtn = panel.querySelector('#panel-save-another');

    // Check connection status
    checkPanelConnectionStatus();

    // Close button
    closeBtn.addEventListener('click', () => {
      panel.classList.add('hidden');
      panelVisible = false;
    });

    // Minimize button
    minimizeBtn.addEventListener('click', () => {
      const body = panel.querySelector('#panel-body');
      body.classList.toggle('minimized');
      minimizeBtn.textContent = body.classList.contains('minimized') ? '+' : '−';
    });

    // Drag functionality
    header.addEventListener('mousedown', startDrag);

    function startDrag(e) {
      if (e.target.closest('button')) return; // Don't drag if clicking buttons
      isDragging = true;
      const rect = panel.getBoundingClientRect();
      dragOffsetX = e.clientX - rect.left;
      dragOffsetY = e.clientY - rect.top;
      panel.classList.add('dragging');
      e.preventDefault();
    }

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      const x = e.clientX - dragOffsetX;
      const y = e.clientY - dragOffsetY;

      // Keep panel within viewport
      const maxX = window.innerWidth - panel.offsetWidth;
      const maxY = window.innerHeight - panel.offsetHeight;

      panel.style.left = Math.max(0, Math.min(x, maxX)) + 'px';
      panel.style.top = Math.max(0, Math.min(y, maxY)) + 'px';
      panel.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        panel.classList.remove('dragging');
      }
    });

    // Form submission
    form.addEventListener('submit', handlePanelSubmit);

    // Save another button
    saveAnotherBtn.addEventListener('click', () => {
      // Hide success row
      panel.querySelector('#panel-success-row').classList.add('hidden');
      // Reset save button
      const saveBtn = panel.querySelector('#panel-save-btn');
      saveBtn.disabled = false;
      saveBtn.querySelector('.btn-text').textContent = 'Save to Airtable';
      // Refresh data
      if (currentSite) {
        extractedJobData = extractJobData();
        populatePanelForm(extractedJobData);
      }
    });

    // Copy link button
    const copyLinkBtn = panel.querySelector('#panel-copy-link');
    if (copyLinkBtn) {
      copyLinkBtn.addEventListener('click', () => {
        const linkUrl = document.getElementById('panel-link').value || window.location.href;
        navigator.clipboard.writeText(linkUrl).then(() => {
          // Brief visual feedback
          copyLinkBtn.querySelector('.copy-icon').textContent = '✓';
          setTimeout(() => {
            copyLinkBtn.querySelector('.copy-icon').textContent = '🔗';
          }, 1500);
        });
      });
    }

    // Resize functionality
    const resizeHandle = panel.querySelector('#panel-resize-handle');
    if (resizeHandle) {
      let isResizing = false;
      let startX, startY, startWidth, startHeight;

      resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startY = e.clientY;
        startWidth = panel.offsetWidth;
        startHeight = panel.offsetHeight;
        e.preventDefault();
      });

      document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const newWidth = startWidth + (e.clientX - startX);
        const newHeight = startHeight + (e.clientY - startY);
        // Set minimum and maximum sizes - compact constraints
        panel.style.width = Math.max(260, Math.min(newWidth, 480)) + 'px';
        panel.style.height = Math.max(280, Math.min(newHeight, 600)) + 'px';
      });

      document.addEventListener('mouseup', () => {
        isResizing = false;
      });
    }

    // Settings button
    const settingsBtn = panel.querySelector('#panel-settings');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'openOptions' });
      });
    }
  }

  function populatePanelForm(data) {
    if (!data) data = {};

    const panel = document.getElementById('job-tracker-panel');
    if (!panel) return;

    // Set text inputs
    setInputValue('panel-company', data.company);
    setInputValue('panel-jobTitle', data.jobTitle);
    setInputValue('panel-salary', data.salary);
    setInputValue('panel-location', data.location);
    setInputValue('panel-notes', data.notes);

    // Set select values
    setPanelSelectValue('panel-jobType', data.jobType);
    setPanelSelectValue('panel-workModel', data.workModel);
    setPanelSelectValue('panel-status', data.status || 'Not Applied');
    setPanelSelectValue('panel-source', data.source);

    // Set date
    if (data.dateApplied) {
      const dateInput = document.getElementById('panel-dateApplied');
      if (dateInput) dateInput.value = formatDateForInput(data.dateApplied);
    }

    // Always set the job link - use current URL as fallback
    const linkUrl = data.link || window.location.href;
    setInputValue('panel-link', linkUrl);
  }

  function setInputValue(id, value) {
    const input = document.getElementById(id);
    if (input) input.value = value || '';
  }

  function setPanelSelectValue(id, value) {
    const select = document.getElementById(id);
    if (!select || !value) return;

    const option = Array.from(select.options).find(opt =>
      opt.value.toLowerCase() === value.toLowerCase()
    );
    if (option) select.value = option.value;
  }

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

  async function handlePanelSubmit(e) {
    e.preventDefault();

    const panel = document.getElementById('job-tracker-panel');
    const form = panel.querySelector('#panel-job-form');
    const errorEl = panel.querySelector('#panel-error');
    const saveBtn = panel.querySelector('#panel-save-btn');
    const btnText = saveBtn.querySelector('.btn-text');
    const btnLoading = saveBtn.querySelector('.btn-loading');

    // Get form data
    const company = document.getElementById('panel-company').value.trim();
    const jobTitle = document.getElementById('panel-jobTitle').value.trim();

    // Validate
    if (!company || !jobTitle) {
      errorEl.textContent = 'Company and Job Title are required.';
      errorEl.classList.remove('hidden');
      return;
    }

    // Collect form data (always include link)
    const formData = {
      company,
      jobTitle,
      jobType: document.getElementById('panel-jobType').value,
      workModel: document.getElementById('panel-workModel').value,
      salary: document.getElementById('panel-salary').value.trim(),
      location: document.getElementById('panel-location').value.trim(),
      dateApplied: document.getElementById('panel-dateApplied').value,
      status: document.getElementById('panel-status').value,
      source: document.getElementById('panel-source').value,
      link: document.getElementById('panel-link').value || window.location.href,
      notes: document.getElementById('panel-notes').value.trim()
    };

    // Show loading state
    saveBtn.disabled = true;
    btnText.classList.add('hidden');
    btnLoading.classList.remove('hidden');
    errorEl.classList.add('hidden');

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'saveToAirtable',
        data: formData
      });

      if (response.success) {
        // Clear stored data
        await chrome.storage.local.remove(['pendingJobData']);
        // Show success row below save button (don't hide form)
        panel.querySelector('#panel-success-row').classList.remove('hidden');
        // Update save button to show saved state
        saveBtn.disabled = true;
        btnText.textContent = '✓ Saved';
      } else {
        errorEl.textContent = response.error || 'Failed to save job. Please try again.';
        errorEl.classList.remove('hidden');
      }
    } catch (error) {
      errorEl.textContent = 'Failed to save job: ' + error.message;
      errorEl.classList.remove('hidden');
    } finally {
      // Only re-enable if not successful
      if (!panel.querySelector('#panel-success-row').classList.contains('hidden')) {
        // Success state - keep button disabled
      } else {
        saveBtn.disabled = false;
      }
      btnText.classList.remove('hidden');
      btnLoading.classList.add('hidden');
    }
  }

  // Check Airtable connection status for the panel
  async function checkPanelConnectionStatus() {
    const statusEl = document.getElementById('panel-connection-status');
    const statusText = statusEl?.querySelector('.panel-status-text');
    if (!statusEl || !statusText) return;

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

})();
