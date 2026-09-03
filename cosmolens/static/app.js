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

  const TARGET_KNOWLEDGE = {
    'NGC 4414': {
      ra: '12h 26m 27.1s',
      dec: '+31° 13′ 25″',
      dist: '62.3 Mly',
      type: 'Flocculent Spiral Galaxy (SA(rs)c)',
      instrument: 'NIRCam / F115W + F200W + F356W',
      resolution: '0.031 arcsec/px · 155,000 resolved stellar nodes',
      lensProb: '0.04 (Low field distortion)'
    },
    'SMACS J0723': {
      ra: '07h 23m 19.5s',
      dec: '−73° 27′ 15″',
      dist: '4.6 Gly (Cluster core) / z = 0.390',
      type: 'Massive Gravitational Lensing Cluster',
      instrument: 'NIRCam + MIRI composite / 12.5h integration',
      resolution: 'Multiple arcs resolved · Relativistic Einstein ring detected',
      lensProb: '0.998 (Confirmed Strong Gravitational Lens)'
    },
    'JWST-CL-0003': {
      ra: '02h 17m 44.0s',
      dec: '-03° 45′ 12″',
      dist: '8.4 Gly / z = 1.12',
      type: 'Early Epoch Galaxy Cluster',
      instrument: 'NIRCam Deep Field Mosaic',
      resolution: 'Sub-kpc core morphology · High-z lensed candidate',
      lensProb: '0.874 (High confidence candidate)'
    },
    'Cartwheel Galaxy': {
      ra: '00h 37m 41.1s',
      dec: '−33° 42′ 59″',
      dist: '500 Mly',
      type: 'Lenticular & Ring Galaxy (Collisional)',
      instrument: 'NIRCam & MIRI Multi-Band Spectrogram',
      resolution: 'Outer starburst ring resolved · Differential velocity mapped',
      lensProb: '0.12 (Peripheral shear)'
    },
    "Stephan's Quintet": {
      ra: '22h 35m 57.5s',
      dec: '+33° 57′ 36″',
      dist: '290 Mly',
      type: 'Compact Galaxy Group (HCG 92)',
      instrument: 'NIRCam / MIRI / NIRSpec IFU',
      resolution: 'Shockwave gas filament & tidal bridges resolved',
      lensProb: '0.38 (Tidal distortion mapping)'
    }
  };

  function appendMessage(role, text, metaData = null) {
    if (intro) intro.classList.add('has-messages');

    const item = document.createElement('div');
    item.className = `feed-item ${role}`;

    const meta = document.createElement('div');
    meta.className = 'feed-meta mono';
    
    const roleSpan = document.createElement('span');
    roleSpan.className = role === 'user' ? 'feed-role-user' : 'feed-role-system';
    roleSpan.textContent = role === 'user' ? '› TARGET QUERY' : '● OBSERVATORY // TELEMETRY';
    
    const timeSpan = document.createElement('span');
    timeSpan.textContent = getTimestamp();

    meta.appendChild(roleSpan);
    meta.appendChild(timeSpan);

    const body = document.createElement('div');
    body.className = 'feed-body';
    
    if (typeof text === 'string') {
      const p = document.createElement('p');
      p.textContent = text;
      body.appendChild(p);
    }

    if (metaData) {
      const card = document.createElement('div');
      card.style.marginTop = '12px';
      card.style.padding = '12px 14px';
      card.style.background = 'rgba(4, 8, 20, 0.7)';
      card.style.border = '1px solid rgba(140, 175, 245, 0.18)';
      card.style.borderRadius = '10px';
      card.style.display = 'grid';
      card.style.gridTemplateColumns = 'repeat(auto-fit, minmax(180px, 1fr))';
      card.style.gap = '8px 16px';
      card.style.fontSize = '0.78rem';
      card.className = 'mono';

      for (const [key, val] of Object.entries(metaData)) {
        const row = document.createElement('div');
        row.innerHTML = `<span style="color: var(--accent-gold); text-transform: uppercase; font-size: 0.68rem;">${key}:</span> <span style="color: var(--ink);">${val}</span>`;
        card.appendChild(row);
      }
      body.appendChild(card);
    }

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

    const matchingKey = Object.keys(TARGET_KNOWLEDGE).find(
      k => k.toLowerCase() === text.toLowerCase() || text.toLowerCase().includes(k.toLowerCase())
    );

    setTimeout(() => {
      if (matchingKey) {
        const info = TARGET_KNOWLEDGE[matchingKey];
        appendMessage(
          'system',
          `Celestial coordinates acquired for [${matchingKey}]. Synthesizing NIRCam multi-spectral deep-field pipeline...`,
          {
            'Coordinates': `${info.ra} | ${info.dec}`,
            'Distance / Redshift': info.dist,
            'Morphology': info.type,
            'Optical Filter': info.instrument,
            'Resolution Metrics': info.resolution,
            'Lens Score': info.lensProb
          }
        );
      } else {
        appendMessage(
          'system',
          `Acquiring high-resolution NIRCam/MIRI spectral imaging for [${text}]... Aligning celestial coordinates and resolving deep-field gravitational contours.`,
          {
            'Target': text.toUpperCase(),
            'Pipeline Status': 'RESOLVED (155k particle buffer created)',
            'HPC Cores': 'Multi-worker SIMD GPU Dispatch',
            'Spectroscopy': '0.6 - 5.0 μm NIRCam Broad-Band'
          }
        );
      }
    }, 400);
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
