const params = new URLSearchParams(location.search)
document.getElementById('domain').textContent = params.get('domain') || 'This site'
