document.addEventListener('DOMContentLoaded', () => {
  const curtain = document.getElementById('pageCurtain');
  const input = document.getElementById('galaxyInput');
  const sendBtn = document.getElementById('sendBtn');
  const feed = document.getElementById('chatFeed');
  const intro = document.getElementById('terminalIntro');
  const chips = document.querySelectorAll('.target-chip');

  // Trigger curtain fade-out on load for a cinematic entrance
  requestAnimationFrame(() => {
    setTimeout(() => {
      if (curtain) curtain.classList.add('loaded');
    }, 60);
  });

  function getTimestamp() {
    const now = new Date();
    return now.toTimeString().split(' ')[0] + ' UTC';
  }

  function appendMessage(role, text) {
    if (intro) intro.classList.add('has-messages');

    const item = document.createElement('div');
    item.className = `feed-item ${role}`;

    const meta = document.createElement('div');
    meta.className = 'feed-meta mono';
    
    const roleSpan = document.createElement('span');
    roleSpan.className = role === 'user' ? 'feed-role-user' : 'feed-role-system';
    roleSpan.textContent = role === 'user' ? '› TARGET QUERY' : '● OBSERVATORY';
    
    const timeSpan = document.createElement('span');
    timeSpan.textContent = getTimestamp();

    meta.appendChild(roleSpan);
    meta.appendChild(timeSpan);

    const body = document.createElement('div');
    body.className = 'feed-body';
    body.textContent = text;

    item.appendChild(meta);
    item.appendChild(body);
    feed.appendChild(item);

    // Smooth scroll down
    feed.scrollTo({
      top: feed.scrollHeight,
      behavior: 'smooth'
    });
  }

  function handleQuery(queryText) {
    const text = (queryText || input.value).trim();
    if (!text) return;

    appendMessage('user', text);
    input.value = '';

    // Simulate astronomical target acquisition response
    setTimeout(() => {
      appendMessage(
        'system',
        `Acquiring high-resolution NIRCam/MIRI spectral imaging for [${text}]... Aligning celestial coordinates and resolving deep-field gravitational contours.`
      );
    }, 450);
  }

  sendBtn.addEventListener('click', () => handleQuery());

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleQuery();
    }
  });

  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const target = chip.getAttribute('data-target');
      if (target) {
        handleQuery(target);
      }
    });
  });
});
