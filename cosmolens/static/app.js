document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('galaxyInput');
  const btn = document.getElementById('sendBtn');
  const messages = document.getElementById('messages');

  function sendMessage() {
    const text = input.value.trim();
    if (!text) return;
    
    // Add user message
    const msgEl = document.createElement('div');
    msgEl.className = 'message user';
    msgEl.textContent = text;
    messages.appendChild(msgEl);
    
    input.value = '';
    
    // Auto scroll
    messages.scrollTop = messages.scrollHeight;
    
    // Simulate system response after a small delay
    setTimeout(() => {
      const sysEl = document.createElement('div');
      sysEl.className = 'message system';
      sysEl.textContent = `Acquiring coordinates for ${text}...`;
      messages.appendChild(sysEl);
      messages.scrollTop = messages.scrollHeight;
    }, 600);
  }

  btn.addEventListener('click', sendMessage);
  
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      sendMessage();
    }
  });
});
