console.log('Settings.js loaded');

// Get current theme from localStorage
const currentTheme = localStorage.getItem('theme') || 'dark';
console.log('Current theme:', currentTheme);

// Set the toggle to match current theme
const themeSwitch = document.getElementById('themeSwitch');
const themeLabel = document.querySelector('label[for="themeSwitch"]');

console.log('Theme switch element found:', themeSwitch);

if (themeSwitch && themeLabel) {
  themeSwitch.checked = (currentTheme === 'dark');
  
  // Update label based on current theme
  updateLabel(currentTheme);
  
  console.log('Switch checked state:', themeSwitch.checked);
  
  // Listen for changes
  themeSwitch.addEventListener('change', (e) => {
    console.log('Switch toggled!', e.target.checked);
    const newTheme = e.target.checked ? 'dark' : 'light';
    console.log('Setting new theme:', newTheme);
    setTheme(newTheme);
    updateLabel(newTheme);
  });
} else {
  console.error('themeSwitch or themeLabel element not found!');
}

function setTheme(theme) {
  console.log('setTheme called with:', theme);
  document.documentElement.setAttribute('data-bs-theme', theme);
  localStorage.setItem('theme', theme);
  console.log('Theme set to:', theme);
  console.log('HTML data-bs-theme attribute:', document.documentElement.getAttribute('data-bs-theme'));
}

function updateLabel(theme) {
  const themeLabel = document.querySelector('label[for="themeSwitch"]');
  if (themeLabel) {
    if (theme === 'dark') {
      themeLabel.innerHTML = '<i class="fas fa-moon me-2"></i>Dark Mode';
    } else {
      themeLabel.innerHTML = '<i class="fas fa-sun me-2"></i>Light Mode';
    }
  }
}