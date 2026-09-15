// Run before styles and React so cold loads use the persisted scheme.
try {
  var mode = localStorage.getItem('vc.theme')
  var theme = mode === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : mode
  if (theme !== 'dark' && theme !== 'green') theme = 'light'
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light'
} catch (_) { /* Storage may be disabled. */ }
