const host = window.location.host; // includes hostname and port
const link = document.getElementById('api-link');
if (link) {
  link.href = `http://${host}/api`;
  link.textContent = `http://${host}/api`;
}