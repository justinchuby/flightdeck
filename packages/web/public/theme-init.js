// Apply theme before paint to prevent flash of wrong theme.
// Matches localStorage key and logic in stores/settingsStore.ts
(function() {
  var theme = 'dark';
  try {
    var saved = localStorage.getItem('theme');
    if (saved === 'light') theme = 'light';
    else if (saved === 'system') {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
  } catch(e) {}
  document.documentElement.classList.add(theme);
})();
