/* ==========================================
   MD reader — Theme
   Colors follow prefers-color-scheme (see themes.css). The main process
   drives that media query through nativeTheme.themeSource, so the window
   background, native dialogs and the page always agree.
   ========================================== */

(function () {
  const media = window.matchMedia('(prefers-color-scheme: dark)');

  function isDark() {
    return media.matches;
  }

  function toggle() {
    window.mdReader.setSetting('theme', isDark() ? 'light' : 'dark');
  }

  // One-time migration from the old localStorage preference. Only "dark"
  // is carried over: the old code wrote "light" for everyone by default,
  // and pinning that would stop the app from following the system.
  try {
    const legacy = localStorage.getItem('md-reader-theme');
    if (legacy) {
      localStorage.removeItem('md-reader-theme');
      if (legacy === 'dark') window.mdReader.setSetting('theme', 'dark');
    }
  } catch (_) {
    /* storage unavailable */
  }

  window.MDReaderTheme = { toggle, isDark };
})();
