/* ==========================================
   MD reader — Theme Manager (Light/Dark)
   ========================================== */

(function () {
  const STORAGE_KEY = 'md-reader-theme';

  /**
   * Get the current theme from localStorage, default to 'light'
   * @returns {'light'|'dark'}
   */
  function getTheme() {
    return localStorage.getItem(STORAGE_KEY) || 'light';
  }

  /**
   * Apply theme to the document
   * @param {'light'|'dark'} themeName
   */
  function applyTheme(themeName) {
    document.documentElement.setAttribute('data-theme', themeName);
    localStorage.setItem(STORAGE_KEY, themeName);
    updateThemeIcon(themeName);
  }

  /**
   * Toggle between light and dark themes
   * @returns {'light'|'dark'} the new theme
   */
  function toggle() {
    const current = getTheme();
    const next = current === 'light' ? 'dark' : 'light';
    applyTheme(next);
    return next;
  }

  /**
   * Update the theme toggle button icon
   * @param {'light'|'dark'} themeName
   */
  function updateThemeIcon(themeName) {
    const sunIcon = document.getElementById('sunIcon');
    const moonIcon = document.getElementById('moonIcon');
    if (sunIcon && moonIcon) {
      if (themeName === 'light') {
        sunIcon.style.display = '';
        moonIcon.style.display = 'none';
      } else {
        sunIcon.style.display = 'none';
        moonIcon.style.display = '';
      }
    }
  }

  /**
   * Initialize theme from stored preference
   */
  function init() {
    const theme = getTheme();
    applyTheme(theme);
  }

  // Export to window
  window.MDReaderTheme = { init, toggle, getTheme, applyTheme };
})();
