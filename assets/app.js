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
  teardown: [],      // listeners the current view owns; run on navigate away
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

async function viewUnit(slug) {
  const meta = HH.manifest.units.find(u => u.slug === slug);
  if (!meta) return viewNotFound(`#/unit/${slug}`);
  if (!meta.ready) {
    return `<div class="wrap" style="padding:80px 0" data-accent="${esc(meta.accent)}">
      <div class="kicker" style="font:600 var(--t-micro)/1 var(--mono);color:var(--ink-4)">
        ${esc(meta.partRoman)} &middot; ${esc(meta.partTitle)}</div>
      <h1>${esc(meta.title)}</h1>
      <p class="prose">${esc(meta.blurb)}</p>
      <p class="prose" style="color:var(--ink-4)">This unit is planned but not
        written yet. It is in the track so the whole spine is visible.</p>
      <p><a class="btn ghost" href="#/track">Back to the track</a></p>
    </div>`;
  }

  const u = await getJSON(`data/unit/${slug}.json`);
  const sibs = HH.manifest.units;
  const prev = sibs[u.num - 1];
  const next = sibs[u.num + 1];

  const railItems = u.headings.map((h, i) => `
    <li class="lvl${h.level}" data-i="${i}" id="rail-${esc(h.id)}">
      <a href="#/unit/${esc(slug)}/${esc(h.id)}" data-h="${esc(h.id)}">${esc(h.text)}</a>
    </li>`).join('');

  const rail = `
    <nav class="rail" aria-label="Contents">
      <h2>Contents</h2>
      <ol>${railItems}</ol>
    </nav>`;

  const facts = [
    ['Part', `${u.partRoman} &middot; ${u.partTitle}`],
    ['Backend', u.backend],
    ['Words', u.words],
    u.meta.minutes ? ['Minutes', u.meta.minutes] : null,
    u.meta.needs ? ['Needs', [].concat(u.meta.needs).join(', ')] : null,
  ].filter(Boolean).map(([k, v]) =>
    `<span class="badge">${esc(k)}: ${v}</span>`).join('');

  const navLink = (unit, dir) => unit
    ? `<a class="${dir}" href="#/unit/${esc(unit.slug)}">
         <span class="dir">${dir === 'prev' ? 'Previous' : 'Next'}</span>
         <span class="ttl">${esc(unit.title)}</span></a>`
    : `<span class="${dir} placeholder"></span>`;

  return `
  <div class="wrap unit" data-accent="${esc(u.accent)}" data-slug="${esc(slug)}">
    ${rail}
    <header class="head">
      <div class="kicker">
        <span class="n">${String(u.num).padStart(3, '0')}</span>
        <span>${esc(u.partRoman)} &middot; ${esc(u.partTitle)}</span>
      </div>
      <h1>${esc(u.title)}</h1>
      ${u.meta.one_idea ? `<p class="idea">
        <span class="lbl">The one idea</span>${esc(u.meta.one_idea)}</p>` : ''}
      <div class="facts">${facts}</div>
    </header>
    <article class="body prose">${u.html}</article>
    <p class="head" style="grid-column:2;margin-top:28px">
      <a class="btn" href="#/work/${esc(slug)}/1">Start the exercises</a>
      <a class="btn ghost" href="#/drills/${esc(slug)}"
         style="margin-left:8px">Drills</a>
    </p>
    <nav class="unitnav" aria-label="Adjacent units">
      ${navLink(prev, 'prev')}${navLink(next, 'next')}
    </nav>
  </div>
  <button class="btn" id="sheetBtn" aria-expanded="false" aria-controls="sheet">
    Contents
  </button>
  <div class="scrim" id="scrim"></div>
  <div class="sheet" id="sheet" role="dialog" aria-modal="true" aria-label="Contents"
       data-open="false"></div>`;
}

/* Scroll to a heading and mark it, so the reader can see what moved. The
 * sticky-header offset lives in CSS as scroll-margin-top, not here. */
function land(id, behavior) {
  const t = document.getElementById(id);
  if (!t) return false;
  t.scrollIntoView({ behavior, block: 'start' });
  t.classList.remove('landed');
  void t.offsetWidth;               // restart the animation
  t.classList.add('landed');
  setTimeout(() => t.classList.remove('landed'), 2400);
  if (location.hash.split('/')[3] !== id) {
    history.replaceState(null, '',
      `#/unit/${el('.unit')?.dataset.slug}/${id}`);
  }
  return true;
}

/* The rail. Two jobs, one layout read, throttled to a frame.
 *
 * The spine fills by read progress and the dots LATCH: once passed, a heading
 * stays marked, and the furthest point is persisted. The reference
 * implementation recomputes both from the current scroll position, so its dots
 * un-fill when you scroll back up, which makes it a scroll indicator wearing a
 * progress indicator's clothes. */
function wireUnit(slug) {
  const unit = el('.unit');
  if (!unit) return;
  const rail = el('.rail');
  const items = [...document.querySelectorAll('.rail li')];
  const heads = [...document.querySelectorAll('.body h2, .body h3')];
  if (!rail || !items.length) return;

  const key = `read.${slug}`;              // no backend in the key, ever
  let furthest = Store.get(key, -1);

  const paint = () => {
    for (let i = 0; i <= furthest && i < items.length; i++) items[i].classList.add('read');
    rail.querySelector('ol').style.setProperty(
      '--read', items.length ? (furthest + 1) / items.length : 0);
  };
  paint();

  let queued = false;
  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      let current = -1;
      for (let i = 0; i < heads.length; i++) {
        if (heads[i].getBoundingClientRect().top < 140) current = i;
        else break;
      }
      // reaching the bottom counts as reading the last section
      const atEnd = innerHeight + scrollY >= document.body.scrollHeight - 4;
      if (atEnd) current = heads.length - 1;

      items.forEach((li, i) =>
        li.querySelector('a').setAttribute('aria-current', i === current ? 'true' : 'false'));

      if (current > furthest) {
        furthest = current;
        Store.set(key, furthest);
        paint();
      }
    });
  };
  addEventListener('scroll', onScroll, { passive: true });
  HH.teardown.push(() => removeEventListener('scroll', onScroll));
  onScroll();

  // anchor clicks scroll rather than navigate
  rail.addEventListener('click', ev => {
    const a = ev.target.closest('a[data-h]');
    if (!a) return;
    ev.preventDefault();
    land(a.dataset.h, 'smooth');
    closeSheet();
  });

  wireSheet(rail);
}

/* The sheet, with the focus trap the reference declares and does not have. */
let sheetReturn = null;

function openSheet() {
  const sheet = el('#sheet'), scrim = el('#scrim'), btn = el('#sheetBtn');
  if (!sheet) return;
  sheetReturn = document.activeElement;
  sheet.dataset.open = 'true';
  scrim.dataset.open = 'true';
  btn.setAttribute('aria-expanded', 'true');
  document.body.style.overflow = 'hidden';
  const first = sheet.querySelector('a, button');
  if (first) first.focus();
  announce('Contents opened');
}

function closeSheet() {
  const sheet = el('#sheet'), scrim = el('#scrim'), btn = el('#sheetBtn');
  if (!sheet || sheet.dataset.open !== 'true') return;
  sheet.dataset.open = 'false';
  scrim.dataset.open = 'false';
  btn.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
  if (sheetReturn && sheetReturn.isConnected) sheetReturn.focus();
  sheetReturn = null;
}

function wireSheet(rail) {
  const sheet = el('#sheet'), btn = el('#sheetBtn'), scrim = el('#scrim');
  if (!sheet || !btn) return;

  btn.onclick = () => {
    if (sheet.dataset.open === 'true') return closeSheet();
    // Move the live rail into the sheet so there is one source of truth for
    // read state rather than two copies that can disagree.
    rail.classList.add('in-sheet');
    sheet.appendChild(rail);
    openSheet();
  };
  scrim.onclick = closeSheet;

  const onKey = ev => {
    if (sheet.dataset.open !== 'true') return;
    if (ev.key === 'Escape') { ev.preventDefault(); return closeSheet(); }
    if (ev.key !== 'Tab') return;
    const f = [...sheet.querySelectorAll('a[href], button:not([disabled])')]
      .filter(n => n.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  };
  addEventListener('keydown', onKey);
  HH.teardown.push(() => { removeEventListener('keydown', onKey); closeSheet(); });
}

/* ------------------------------------------------------------- workbench */

async function viewWork(slug, nRaw) {
  const meta = HH.manifest.units.find(u => u.slug === slug);
  if (!meta || !meta.ready) return viewNotFound(`#/work/${slug}`);

  const data = await getJSON(`data/ex/${slug}.json`);
  const n = Math.min(Math.max(parseInt(nRaw || '1', 10) || 1, 1),
                     data.exercises.length);
  const ex = data.exercises[n - 1];
  HH.work = { slug, n, ex, unit: meta };

  const nav = data.exercises.map((e, i) => {
    const done = Store.get(`pass.${slug}.${i + 1}`, false);
    return `<a href="#/work/${esc(slug)}/${i + 1}"
       class="${done ? 'done' : ''}"
       ${i + 1 === n ? 'aria-current="page"' : ''}
       title="${esc(e.title)}">${i + 1}</a>`;
  }).join('');

  const saved = Store.get(`draft.${slug}.${n}`, null);
  const passed = Store.get(`pass.${slug}.${n}`, false);

  return `
  <div class="wrap wb" data-accent="${esc(meta.accent)}">
    <div class="pane">
      <header class="exhead">
        <div class="kicker">
          <span class="n">${String(meta.num).padStart(3, '0')}</span>
          <a href="#/unit/${esc(slug)}">${esc(meta.title)}</a>
          <span>exercise ${n} of ${data.exercises.length}</span>
          ${ex.backend === 'modal'
            ? '<span class="badge warn">runs on your GPU</span>' : ''}
        </div>
        <nav class="exnav" aria-label="Exercises">${nav}</nav>
        <h1>${esc(ex.title)}</h1>
      </header>

      <div class="prose" style="font-size:var(--t-body)">${ex.brief}</div>

      <div class="editor" id="ed" data-wrap="off"></div>

      <div class="wbbar">
        <button class="btn" id="run">Run</button>
        <button class="btn ghost" id="reset">Reset to starter</button>
        <span class="spacer"></span>
        <button class="tog" id="wrap" aria-pressed="false">wrap</button>
      </div>

      <div class="verdicts" id="verdicts" aria-live="polite"></div>
      <div id="diagnosis"></div>
      <div id="afterword" hidden>
        <div class="diagnosis" style="border-color:var(--ok)">
          <span class="lbl" style="color:var(--ok)">Passed</span>${ex.after}
        </div>
      </div>
    </div>

    <aside class="pane">
      <div class="card" style="position:sticky;top:76px">
        <div class="meta"><span>What this is about</span></div>
        <p style="color:var(--ink-2);font-size:var(--t-sm)">${esc(ex.concept)}</p>
        <div class="hintbox" id="hints">
          <div id="hintlist"></div>
          ${ex.hints.length
            ? `<button class="btn ghost" id="hintbtn">Hint
                 <span style="opacity:.6">1 of ${ex.hints.length}</span></button>`
            : ''}
        </div>
        <p style="margin-top:14px;color:var(--ink-4);font-size:var(--t-micro)">
          There are hints and no answers. A hint is a sentence that makes you
          see the error.
        </p>
      </div>
    </aside>
  </div>`;
}

function wireWork() {
  const w = HH.work;
  if (!w) return;
  const { slug, n, ex } = w;
  const host = el('#ed');
  if (!host) return;

  const lang = ex.backend === 'sim' ? 'netlist'
             : ex.backend === 'yosys' ? 'verilog'
             : ex.backend === 'modal' ? 'cuda' : 'cpp';

  const draftKey = `draft.${slug}.${n}`;
  const editor = WB.mountEditor(host, {
    value: Store.get(draftKey, null) ?? ex.starter,
    lang,
    onChange: v => {
      clearTimeout(HH._saveT);
      HH._saveT = setTimeout(() => Store.set(draftKey, v), 400);
    },
  });
  HH.teardown.push(() => clearTimeout(HH._saveT));

  el('#wrap').onclick = ev => {
    const on = ev.currentTarget.getAttribute('aria-pressed') !== 'true';
    ev.currentTarget.setAttribute('aria-pressed', String(on));
    editor.setWrap(on);
  };

  el('#reset').onclick = () => {
    // Reset means the starter, not the last thing you typed. The reference
    // implementation restores the edit, which makes the button useless at
    // exactly the moment you need it.
    editor.value = ex.starter;
    Store.set(draftKey, ex.starter);
    announce('Reset to the starter');
    editor.focus();
  };

  let shown = 0;
  const hintBtn = el('#hintbtn');
  if (hintBtn) {
    shown = Store.get(`hints.${slug}.${n}`, 0);
    const paintHints = () => {
      el('#hintlist').innerHTML = ex.hints.slice(0, shown)
        .map(h => `<div class="hint">${esc(h)}</div>`).join('');
      if (shown >= ex.hints.length) hintBtn.remove();
      else hintBtn.innerHTML =
        `Hint <span style="opacity:.6">${shown + 1} of ${ex.hints.length}</span>`;
    };
    paintHints();
    hintBtn.onclick = () => {
      shown = Math.min(shown + 1, ex.hints.length);
      Store.set(`hints.${slug}.${n}`, shown);
      paintHints();
      announce('Hint shown');
    };
  }

  if (Store.get(`pass.${slug}.${n}`, false)) el('#afterword').hidden = false;

  const runBtn = el('#run');
  const be = WB.BACKENDS[ex.backend];

  // A large runtime is stated before it is fetched, never during. The learner
  // decides whether to spend the bandwidth; the page does not decide for them.
  const needsConsent = () =>
    be && be.bytes && !be.loaded && !Store.get(`allow.${ex.backend}`, false);

  if (needsConsent()) {
    const mb = Math.round(be.bytes / 1e6);
    el('#verdicts').innerHTML = `
      <div class="vrow" data-state="unavailable">
        <div class="who">${esc(be.label)}</div>
        <div class="what">
          This unit is checked by running the real synthesiser in your browser.
          It is a <strong>${mb} MB</strong> download the first time, and your
          browser caches it afterwards. Nothing is sent anywhere.
          <p style="margin-top:10px">
            <button class="btn" id="allowbe">Download and run</button>
          </p>
        </div>
      </div>`;
    el('#allowbe').onclick = () => {
      Store.set(`allow.${ex.backend}`, true);
      el('#allowbe').closest('.what').innerHTML = 'Starting.';
      runBtn.click();
    };
  }

  runBtn.onclick = async () => {
    if (needsConsent()) return;
    runBtn.disabled = true;
    renderVerdicts([{ who: ex.backend, state: 'running', title: 'Checking.' }]);
    el('#diagnosis').innerHTML = '';
    try {
      const res = await WB.run(ex, editor.value, {
        judges: HH.judges,
        onProgress: (done, total) => {
          if (!total) return;
          const pct = Math.round((done / total) * 100);
          renderVerdicts([{
            who: be ? be.label : ex.backend, state: 'running',
            title: `Fetching the toolchain: ${pct}% of ` +
                   `${Math.round(total / 1e6)} MB.`,
          }]);
        },
      });
      renderVerdicts(res.verdicts);
      renderDiagnosis(ex, res);
      if (res.pass) {
        Store.set(`pass.${slug}.${n}`, true);
        el('#afterword').hidden = false;
        document.querySelector(`.exnav a[href$="/${n}"]`)?.classList.add('done');
        announce('Correct. ' + (res.verdicts[0]?.title || ''));
      } else {
        announce('Not yet. ' + (res.verdicts[0]?.title || ''));
      }
    } catch (err) {
      renderVerdicts([{ who: ex.backend, state: 'unavailable',
                        title: 'The checker could not run: ' + err.message }]);
    } finally {
      runBtn.disabled = false;
    }
  };
}

function renderVerdicts(verdicts, toolchain) {
  const box = el('#verdicts');
  if (!box) return;
  const foot = toolchain
    ? `<p style="margin:2px 0 0;color:var(--ink-4);font:500 var(--t-micro)/1.5 var(--mono)">
         checked by ${esc(toolchain)}</p>` : '';
  box.innerHTML = verdicts.map(v => `
    <div class="vrow" data-state="${esc(v.state)}">
      <div class="who">${esc(v.who)}</div>
      <div class="what">
        ${v.state === 'ok' ? '<span class="stamp">Correct</span><br>' : ''}
        ${esc(v.title)}
        ${v.detail || ''}
      </div>
    </div>`).join('') + foot;
}

/* Ordered, first match wins. The reader gets prose about the error they
 * actually hit, not the one the exercise expected them to hit. */
function renderDiagnosis(ex, res) {
  const box = el('#diagnosis');
  if (!box) return;
  box.innerHTML = '';
  if (res.pass) return;

  for (const d of ex.diagnose || []) {
    const hit = (res.signals || []).some(s => {
      if (s.judge !== d.judge) return false;
      if (d.judge === 'silent') return true;
      if (d.judge === 'verdict') return s.key === d.key;
      try { return new RegExp(d.key.slice(1, -1)).test(s.key); }
      catch { return false; }
    });
    if (!hit) continue;
    box.innerHTML =
      `<div class="diagnosis"><span class="lbl">What this means</span>${d.prose}</div>`;
    return;
  }
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
  'unit': viewUnit,
  'work': viewWork,
  'atlas': () => viewSoon('Atlas'),
  'progress': () => viewSoon('Progress'),
  'glossary': () => viewSoon('Glossary'),
  'search': () => viewSoon('Search'),
};

async function render() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [route, a, b] = raw.split('/');
  const main = el('#main');

  HH.teardown.splice(0).forEach(fn => { try { fn(); } catch {} });

  document.querySelectorAll('nav.main a, nav.tabs a').forEach(a => {
    if (a.dataset.route === route) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  try {
    const fn = ROUTES[route];
    main.innerHTML = fn ? await fn(a, b) : viewNotFound(location.hash || '#/');
    if (route === 'unit' && a) wireUnit(a);
    if (route === 'work') wireWork();
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
  if (route === 'unit' && b) {
    if (!land(b, 'instant')) window.scrollTo({ top: 0, behavior: 'instant' });
  } else {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
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
  // This app positions the page itself: to the top on navigation, or to a
  // heading on a deep link. The browser's own restoration runs AFTER that and
  // silently undoes it, which lands a deep-linked heading exactly
  // scroll-margin-top too far down. Take the wheel.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  initTheme();
  try {
    HH.manifest = await getJSON('data/manifest.json');
    // The backend configuration comes from the build, not from this file, so
    // the page cannot call a toolchain --validate has never checked.
    HH.judges = await getJSON('data/judges.json');
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
