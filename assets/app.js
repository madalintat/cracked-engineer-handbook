/* The Hardware Handbook: routing, views, state.
 *
 * No framework, no build step. Views are functions that return an HTML string;
 * wiring happens after paint. Same architecture as the Rust Handbook, with the
 * gaps its analysis turned up closed:
 *
 *   - a 404 and a thrown error are different states, not the same one
 *   - focus moves to the view heading on navigation
 *   - the live region announces what happened
 *   - progress keys never include the backend, so one exercise solved twice
 *     does not count twice
 */

'use strict';

const HH = {
  manifest: null,
  cache: new Map(),
  KEY: 'hh-v1',
};

/* ------------------------------------------------------------------ store */

const Store = {
  read() {
    try { return JSON.parse(localStorage.getItem(HH.KEY)) || {}; }
    catch { return {}; }
  },
  write(o) {
    try { localStorage.setItem(HH.KEY, JSON.stringify(o)); } catch {}
  },
  get(path, dflt) {
    const o = Store.read();
    return path.split('.').reduce((a, k) => (a && k in a ? a[k] : undefined), o) ?? dflt;
  },
  set(path, val) {
    const o = Store.read();
    const ks = path.split('.');
    let cur = o;
    ks.slice(0, -1).forEach(k => { cur[k] = cur[k] || {}; cur = cur[k]; });
    cur[ks.at(-1)] = val;
    Store.write(o);
  },
};

/* ------------------------------------------------------------------- util */

const esc = s => String(s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const el = sel => document.querySelector(sel);

function announce(msg) {
  const live = el('#live');
  if (live) { live.textContent = ''; setTimeout(() => { live.textContent = msg; }, 30); }
}

async function getJSON(url) {
  if (HH.cache.has(url)) return HH.cache.get(url);
  const r = await fetch(url);
  if (!r.ok) {
    const e = new Error(`${r.status} fetching ${url}`);
    e.status = r.status;
    throw e;
  }
  const j = await r.json();
  HH.cache.set(url, j);
  return j;
}

/* ------------------------------------------------------------------ views */

function viewHome() {
  const c = HH.manifest.counts;
  const parts = HH.manifest.parts.map(p => {
    const units = HH.manifest.units.filter(u => u.part === p.id);
    const done = units.filter(u => u.ready).length;
    return `
      <a class="card" href="#/track#${esc(p.id)}" data-accent="${esc(p.accent)}">
        <div class="meta"><span class="n">${esc(p.roman)}</span>
          <span>${units.length} units</span>
          ${done ? `<span class="badge ok">${done} written</span>` : ''}
        </div>
        <h3>${esc(p.title)}</h3>
        <p>${esc(p.blurb)}</p>
      </a>`;
  }).join('');

  return `
  <div class="wrap">
    <section style="padding:64px 0 40px;max-width:var(--measure)">
      <h1>How computers work,<br>from the transistor up.</h1>
      <p class="prose" style="margin-top:20px;font-size:var(--t-lede)">
        ${c.parts} parts and ${c.units} units in one dependency chain. Leakage
        physics forces the frequency wall, the wall forces multicore, multicore
        forces GPUs, and GPUs force four-bit arithmetic. Every exercise is
        checked by a tool that complains specifically.
      </p>
      <p style="margin-top:24px">
        <a class="btn" href="#/track">Start at the switch</a>
      </p>
    </section>
    <section>
      <h2 style="margin-bottom:16px">The track</h2>
      <div class="grid stagger">${parts}</div>
    </section>
  </div>`;
}

function viewTrack() {
  const byPart = new Map();
  HH.manifest.units.forEach(u => {
    if (!byPart.has(u.part)) byPart.set(u.part, []);
    byPart.get(u.part).push(u);
  });

  const sections = HH.manifest.parts.map(p => {
    const units = byPart.get(p.id) || [];
    const cards = units.map(u => `
      <a class="card ${u.ready ? '' : 'stub'}"
         href="${u.ready ? `#/unit/${esc(u.slug)}` : '#/track'}"
         ${u.ready ? '' : 'aria-disabled="true"'}>
        <div class="meta">
          <span class="n">${String(u.num).padStart(3, '0')}</span>
          <span>${esc(u.backend)}</span>
          ${u.ready ? '' : '<span>planned</span>'}
        </div>
        <h3>${esc(u.title)}</h3>
        <p>${esc(u.blurb)}</p>
      </a>`).join('');
    return `
      <section id="${esc(p.id)}" data-accent="${esc(p.accent)}" style="margin-top:48px">
        <div style="display:flex;align-items:baseline;gap:12px">
          <span style="font:700 var(--t-sm)/1 var(--mono);color:var(--accent)">${esc(p.roman)}</span>
          <h2>${esc(p.title)}</h2>
        </div>
        <p style="color:var(--ink-3);max-width:var(--measure);margin:8px 0 18px">${esc(p.blurb)}</p>
        <div class="grid">${cards}</div>
      </section>`;
  }).join('');

  return `<div class="wrap"><h1 style="padding-top:48px">The track</h1>${sections}</div>`;
}

function viewNotFound(hash) {
  return `<div class="wrap" style="padding:80px 0">
    <h1>No such page</h1>
    <p class="prose">Nothing is routed at <code>${esc(hash)}</code>.</p>
    <p><a class="btn" href="#/">Back to the start</a></p>
  </div>`;
}

function viewError(err) {
  return `<div class="wrap" style="padding:80px 0">
    <h1>That did not load</h1>
    <p class="prose">${esc(err.message || String(err))}</p>
    <p><button class="btn" id="retry">Try again</button></p>
  </div>`;
}

function viewSoon(title) {
  return `<div class="wrap" style="padding:80px 0">
    <h1>${esc(title)}</h1>
    <p class="prose">Not built yet.</p>
  </div>`;
}

/* ---------------------------------------------------------------- routing */

const ROUTES = {
  '': viewHome,
  'track': viewTrack,
  'atlas': () => viewSoon('Atlas'),
  'progress': () => viewSoon('Progress'),
  'glossary': () => viewSoon('Glossary'),
  'search': () => viewSoon('Search'),
};

async function render() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [route] = raw.split('/');
  const main = el('#main');

  document.querySelectorAll('nav.main a, nav.tabs a').forEach(a => {
    if (a.dataset.route === route) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  try {
    const fn = ROUTES[route];
    main.innerHTML = fn ? await fn() : viewNotFound(location.hash || '#/');
  } catch (err) {
    console.error(err);
    main.innerHTML = viewError(err);
    const r = el('#retry');
    if (r) r.onclick = () => { HH.cache.clear(); render(); };
  }

  // Focus the heading so a keyboard or screen-reader user lands in the content
  // rather than back at the top of the document.
  const h = main.querySelector('h1');
  if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  window.scrollTo({ top: 0, behavior: 'instant' });
  announce(h ? h.textContent.trim() : 'Page changed');
}

/* ----------------------------------------------------------------- theme */

function initTheme() {
  const saved = Store.get('theme');
  const sys = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.dataset.theme = saved || sys;
  el('#theme').onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    Store.set('theme', next);
    announce(`${next} theme`);
  };
}

/* ------------------------------------------------------------------ boot */

async function boot() {
  initTheme();
  try {
    HH.manifest = await getJSON('data/manifest.json');
    const c = HH.manifest.counts;
    el('#footcount').textContent =
      `${c.parts} parts, ${c.units} units, ${c.ready} written. ` +
      `${c.exercises} exercises, ${c.drills} drills.`;
  } catch (err) {
    el('#main').innerHTML = viewError(err);
    return;
  }
  addEventListener('hashchange', render);
  render();
}

boot();
