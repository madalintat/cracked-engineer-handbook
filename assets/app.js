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

/* A unit's number as a reader counts it. `num` is the index into the track and
 * stays that way, because prev/next index with it; printing it raw made the
 * first unit "000" and made the track and the unit page disagree by one. */
const unitNo = u => String(u.num + 1).padStart(3, '0');

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

  const ready = HH.manifest.units.filter(u => u.ready).length;
  /* The unit opened most recently. Before `last` was recorded this found the
   * first unit with any read state, which after fourteen units still said
   * "Continue: The switch". The fallback is for a store from before then. */
  const last = Store.get('last');
  const started = HH.manifest.units.find(u => u.slug === last && u.ready)
    || HH.manifest.units.find(u => Store.get(`read.${u.slug}`, -1) >= 0);

  return `
  <div class="wrap">
    <section class="hero">
      <div class="hero-copy">
        <p class="eyebrow">${c.phases} phases &middot; ${c.parts} parts &middot;
          ${c.units} units</p>
        <h1>Everything under your code.</h1>
        <p class="lede">A transistor leaks, and a hundred and twenty units
          later that is why a model trains in four-bit floating point. In
          between sit gates, compilers, caches, kernels, filesystems, networks,
          ciphers and motors. Every exercise here is checked by a tool that
          complains specifically, and nothing is asserted that was not
          measured.</p>
        <p class="hero-cta">
          <a class="btn" href="#/track">${started
            ? 'Back to the track' : 'Start at the switch'}</a>
          ${started ? `<a class="btn ghost" href="#/unit/${esc(started.slug)}"
            >Continue: ${esc(started.title)}</a>`
            : '<a class="btn ghost" href="#/paths">Or pick a shorter route</a>'}
        </p>
        <p class="hero-note">${ready} of ${c.units} units written so far, and
          the rest are in the track so the whole spine is visible.</p>
      </div>
      <div class="hero-art">
        <img src="assets/img/mascot-512.png" width="360" height="360"
             alt="" decoding="async">
      </div>
    </section>
    <section>
      <h2 style="margin-bottom:16px">The track</h2>
      <div class="grid stagger">${parts}</div>
    </section>
  </div>`;
}

/* The track at 122 units.
 *
 * This was a list, and a list of 122 rows is 122 near-identical lines carrying
 * the same two badges. In Part I every row said GODBOLT; in Part II every row
 * said SIM; almost every row said "1 before". Repetition at that density stops
 * being information and becomes texture, and the two things a reader actually
 * wants, which unit is this and what is it about, were the smallest type on
 * the row.
 *
 * So: cards, chunked by part, and everything constant within a part stated
 * once in the part's header instead of on every unit under it. A per-unit
 * backend badge appears only where a unit disagrees with its part, which is
 * the only case where it tells you anything. Prerequisite counts are gone
 * from here entirely; the unit page names them, and a number was never the
 * useful form of that.
 */
function viewTrack() {
  const byPart = new Map();
  HH.manifest.units.forEach(u => {
    if (!byPart.has(u.part)) byPart.set(u.part, []);
    byPart.get(u.part).push(u);
  });
  const partById = new Map(HH.manifest.parts.map(p => [p.id, p]));

  const TOOL = {
    sim: 'the simulator in this page',
    godbolt: 'a real compiler, through Compiler Explorer',
    yosys: 'Yosys, synthesising in this page',
    modal: 'a GPU you rent by the second',
  };

  /* One unit. The number is set large and ghosted rather than small and dim:
   * at 122 units the number is how you keep your place, so it should be the
   * thing you can find without reading. */
  const card = (u, oddBackend) => {
    const started = Store.get(`read.${u.slug}`, -1) >= 0;
    const cls = ['u', u.ready ? '' : 'stub', started ? 'started' : '']
      .filter(Boolean).join(' ');
    const inner = `
      <span class="u-n">${unitNo(u)}</span>
      <span class="u-t">${esc(u.title)}</span>
      <span class="u-b">${esc(u.blurb)}</span>
      <span class="u-foot">
        ${started ? '<span class="u-dot" title="You have started this"></span>' : ''}
        ${oddBackend ? `<span class="badge">${esc(u.backend)}</span>` : ''}
      </span>`;
    return `
    <li class="${cls}"
        data-hay="${esc([unitNo(u), u.title, u.blurb, u.backend].join(' ').toLowerCase())}">
      ${u.ready
        ? `<a href="#/unit/${esc(u.slug)}">${inner}</a>`
        : `<div class="u-card">${inner}</div>`}
    </li>`;
  };

  const phases = HH.manifest.phases.map(ph => {
    const units = ph.parts.flatMap(pid => byPart.get(pid) || []);
    const written = units.filter(u => u.ready).length;

    const parts = ph.parts.map(pid => {
      const p = partById.get(pid);
      const us = byPart.get(pid) || [];
      const read = us.filter(u => Store.get(`read.${u.slug}`, -1) >= 0).length;
      const written = us.filter(u => u.ready).length;

      /* What every unit here is checked by, said once. A part is usually all
       * one backend, and where it is not, the majority goes in the header and
       * only the exceptions carry a badge. */
      const tally = {};
      us.forEach(u => { tally[u.backend] = (tally[u.backend] || 0) + 1; });
      const main = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0];

      /* One tick per unit, filled for the ones you have opened. A ring
       * showing "0" told you nothing and told it prominently; this says how
       * long the part is and how far in you are in the same glance. */
      const rail = us.map(u => {
        const on = Store.get(`read.${u.slug}`, -1) >= 0;
        return `<span class="tick${on ? ' on' : ''}${
          u.ready ? '' : ' stub'}"></span>`;
      }).join('');
      /* `.ticks`, not `.rail`: the contents rail on a unit page owns that
       * name, and sharing it hid these below 1060px and laid the rail's
       * heading beside its list above it. */

      return `
      <section class="part" id="${esc(p.id)}" data-part="${esc(p.id)}">
        <div class="part-head">
          <p class="part-eyebrow">Part ${esc(p.roman)}</p>
          <h3>${esc(p.title)}</h3>
          <p class="pb">${esc(p.blurb)}</p>
          <div class="part-meta">
            <span class="ticks" role="img"
                  aria-label="${read} of ${us.length} started">${rail}</span>
            <span class="part-tool">${
              written === us.length ? `All ${us.length} written`
              : written ? `${written} of ${us.length} written`
              : `${us.length} units, none written yet`
            } &middot; checked by ${esc(TOOL[main] || main)}</span>
          </div>
        </div>
        <ul class="ugrid">${
          us.map(u => card(u, u.backend !== main)).join('')}</ul>
      </section>`;
    }).join('');

    return `
    <section class="phase" id="phase-${esc(ph.id)}" data-accent="${esc(ph.accent)}"
             data-phase="${esc(ph.id)}">
      <header class="ph-head">
        <p class="ph-count">${units.length} units${
          written ? `, ${written} written` : ''}</p>
        <h2>${esc(ph.title)}</h2>
        <p>${esc(ph.blurb)}</p>
      </header>
      ${parts}
    </section>`;
  }).join('');

  const chips = HH.manifest.phases.map(ph =>
    `<a class="chip" data-accent="${esc(ph.accent)}" href="#/track#phase-${esc(ph.id)}"
     >${esc(ph.title)}</a>`).join('');

  const c = HH.manifest.counts;
  return `<div class="wrap track">
    <h1 style="padding-top:48px">The track</h1>
    <p class="prose">${c.units} units in ${c.parts} parts, grouped into
      ${c.phases} phases. The colour is the phase, so a unit's colour tells you
      which stage of the machine you are standing in. This is the order the
      dependencies impose. If you arrived with one goal rather than the whole
      thing, the <a href="#/paths">paths</a> are shorter routes that reach one
      each.</p>
    <nav class="chips" aria-label="Phases">${chips}</nav>
    <div class="tfilter">
      <label class="sr-only" for="tf">Filter units</label>
      <input id="tf" type="search" placeholder="Filter by title, idea or backend"
             autocomplete="off" spellcheck="false">
      <span id="tfc" class="count" aria-live="polite"></span>
    </div>
    <p id="tfnone" class="empty" hidden>
      Nothing matches that. The filter reads unit titles, their one-line
      summaries and the backend each one runs on, so try a tool name like
      <code>yosys</code>, or an idea like <code>cache</code>.</p>
    ${phases}
  </div>`;
}

function wireTrack() {
  const input = el('#tf');
  if (!input) return;
  const count = el('#tfc');
  const none = el('#tfnone');
  const rows = [...document.querySelectorAll('.track li.u')];
  const parts = [...document.querySelectorAll('.track .part')];
  const phases = [...document.querySelectorAll('.track .phase')];
  const chips = el('.track .chips');

  const apply = () => {
    const q = input.value.trim().toLowerCase();
    let shown = 0;
    rows.forEach(li => {
      const hit = !q || li.dataset.hay.includes(q);
      li.hidden = !hit;
      if (hit) shown++;
    });
    // A part or phase with nothing left in it is noise, so it goes too.
    parts.forEach(sec => {
      sec.hidden = ![...sec.querySelectorAll('li.u')].some(li => !li.hidden);
    });
    phases.forEach(sec => {
      sec.hidden = ![...sec.querySelectorAll('.part')].some(p => !p.hidden);
    });
    count.textContent = q
      ? `${shown} of ${rows.length}` : `${rows.length} units`;
    none.hidden = !(q && shown === 0);
    if (chips) chips.hidden = !!q;   // jumping to a hidden phase does nothing
  };

  input.addEventListener('input', apply);
  // Escape clears rather than merely blurring, which is what a search input
  // that has already filtered the page should do.
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape' && input.value) {
      e.stopPropagation();
      input.value = '';
      apply();
    }
  });
  apply();
  HH.teardown.push(() => { input.value = ''; });
}

/* The dependency edges, rendered rather than computed and discarded.
 * `needs` answers "what must I have read", and the reverse edge answers
 * "where does this go next", which nothing else on the site can tell you:
 * the next unit in the track is often not the one that uses this one.
 * Reading state is shown against each prerequisite, because an unread
 * prerequisite is the only actionable thing on this list. */
const edgeList = (slugs, kind) => {
  if (!slugs || !slugs.length) return '';
  const items = slugs.map(sl => {
    const m = HH.manifest.units.find(x => x.slug === sl);
    if (!m) return '';
    const started = Store.get(`read.${sl}`, -1) >= 0;
    const state = kind === 'needs'
      ? (started ? '<span class="badge ok">read</span>'
                 : m.ready ? '<span class="badge">not yet</span>'
                           : '<span class="badge muted">planned</span>')
      : (m.ready ? '' : '<span class="badge muted">planned</span>');
    return `<li>${m.ready
      ? `<a href="#/unit/${esc(sl)}">${esc(m.title)}</a>`
      : `<span class="planned">${esc(m.title)}</span>`}${state}</li>`;
  }).join('');
  const label = kind === 'needs'
    ? 'Read these first'
    : 'Units that build on this one';
  return `<div class="edges ${kind}"><h2>${label}</h2><ul>${items}</ul></div>`;
};

function unitEdges(u) {
  return edgeList(u.needs, 'needs') + edgeList(u.neededBy, 'feeds');
}

async function viewUnit(slug) {
  const meta = HH.manifest.units.find(u => u.slug === slug);
  if (!meta) return viewNotFound(`#/unit/${slug}`);
  if (!meta.ready) {
    return `<div class="wrap" style="padding:80px 0" data-accent="${esc(meta.accent)}">
      <div class="kicker" style="font:600 var(--t-micro)/1 var(--mono);color:var(--ink-4)">
        <span style="color:var(--accent-ink)">${unitNo(meta)}</span>
        ${esc(meta.partRoman)} &middot; ${esc(meta.partTitle)}</div>
      <h1>${esc(meta.title)}</h1>
      <p class="prose">${esc(meta.blurb)}</p>
      <p class="prose" style="color:var(--ink-4)">This unit is planned but not
        written yet. It is in the track so the whole spine is visible.</p>
      ${unitEdges(meta)}
      <p style="margin-top:24px"><a class="btn ghost" href="#/track">Back to the track</a></p>
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
  ].filter(Boolean).map(([k, v]) =>
    `<span class="badge">${esc(k)}: ${v}</span>`).join('');

  const edges = unitEdges(u);

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
        <span class="n">${unitNo(u)}</span>
        <span>${esc(u.partRoman)} &middot; ${esc(u.partTitle)}</span>
      </div>
      <h1>${esc(u.title)}</h1>
      ${u.meta.one_idea ? `<p class="idea">
        <span class="lbl">The one idea</span>${esc(u.meta.one_idea)}</p>` : ''}
      <div class="facts">${facts}</div>
      ${edges}
    </header>
    <article class="body prose">${u.html}</article>
    <p class="cta">
      <a class="btn" href="#/work/${esc(slug)}/1">Start the exercises</a>
      <a class="btn ghost" href="#/drills/${esc(slug)}">Drills</a>
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

/* The GPU picker.
 *
 * Every card is listed with its compute capability and its hourly price, and
 * the ones that cannot run this exercise are disabled with the reason shown.
 * That is not politeness. Modal lists RTX-PRO-6000 at $3.03/hr next to B200 at
 * $6.25/hr, both labelled Blackwell, and the cheap one is sm_120 while FP4
 * datacenter code needs sm_100a. A learner economising picks the wrong card
 * and gets a PTX error that explains nothing. Modal documents this nowhere.
 */
function smSatisfies(required, available) {
  if (!required || required === available) return true;
  const fam = (HH.gpus && HH.gpus.families) || {};
  const order = (HH.gpus && HH.gpus.order) || [];
  if ((fam[required] || []).includes(available)) return true;
  if (required.endsWith('a')) return false;
  const major = (sm) => {
    const d = (sm.split('_')[1] || '').replace(/\D/g, '');
    return d ? parseInt(d.slice(0, -1), 10) : 0;
  };
  if (major(required) >= 10 && major(required) !== major(available)) return false;
  const i = order.indexOf(available), j = order.indexOf(required);
  return i >= 0 && j >= 0 && i >= j;
}

function gpuPicker(ex) {
  const cat = (HH.gpus && HH.gpus.gpus) || [];
  if (!cat.length) return '';
  const chosen = Store.get('gpu', 'T4');
  const need = ex.gpu || '';
  const rows = cat.map(g => {
    const ok = smSatisfies(need, g.smMin);
    const sel = ok && g.gpu_string === chosen;
    return `<option value="${esc(g.gpu_string)}" ${sel ? 'selected' : ''}
      ${ok ? '' : 'disabled'}>
      ${esc(g.gpu_string)} &middot; ${esc(g.smMin)} &middot; ${g.vram_gb} GB &middot; $${g.price_per_hour}/hr${ok ? '' : ' — cannot run ' + esc(need)}
    </option>`;
  }).join('');
  const eligible = cat.filter(g => smSatisfies(need, g.smMin));
  const cheapest = eligible.length ? eligible[0] : null;
  return `
    <div class="gpubar">
      <label for="gpusel">GPU</label>
      <select id="gpusel">${rows}</select>
      <span class="note" id="gpunote"></span>
      <a class="note" href="#/settings">runner settings</a>
    </div>`;
}

/* The rail. Two jobs, one layout read, throttled to a frame.
 *
 * The spine fills by read progress and the dots LATCH: once passed, a heading
 * stays marked, and the furthest point is persisted. The reference
 * implementation recomputes both from the current scroll position, so its dots
 * un-fill when you scroll back up, which makes it a scroll indicator wearing a
 * progress indicator's clothes. */
function wireGlossHover() {
  wirePopover({
    openers: 'a.gl[data-g]',
    cls: 'pop pop-gloss',
    cardFor: el => {
      const term = el.textContent.trim();
      return `<p class="eyebrow">${esc(term)}</p>
        <div class="gloss-def">${el.dataset.g}</div>
        <p class="gloss-more">Open the
          <a href="${esc(el.getAttribute('href'))}">glossary</a>
          for where else it is used.</p>`;
    },
  });
}

function wireUnit(slug) {
  wireGlossHover();
  const unit = el('.unit');
  if (!unit) return;
  Store.set('last', slug);
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
          <span class="n">${unitNo(meta)}</span>
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

      ${ex.backend === 'modal' ? gpuPicker(ex) : ''}

      <div class="wbbar">
        <button class="btn" id="run">Run</button>
        <button class="btn ghost" id="reset">Reset to starter</button>
        <span id="vimbadge" class="vimbadge" hidden aria-live="polite"></span>
        <span id="vimmsg" class="vimmsg" hidden></span>
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
      <div class="card about">
        <div class="meta"><span>What this is about</span></div>
        <p style="color:var(--ink-2);font-size:var(--t-sm)">${ex.concept}</p>
        <div class="hintbox" id="hints">
          <div id="hintlist"></div>
          ${ex.hints.length
            ? `<button class="btn ghost" id="hintbtn">Hint
                 <span class="dim">1 of ${ex.hints.length}</span></button>`
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
  Store.set('last', slug);

  /* The exercise declares its language and the build validates it against the
   * backend, so use it. Deriving it from the backend instead meant every
   * godbolt exercise was highlighted as C++, including the assembly ones, and
   * a `@lang cpp` exercise on Modal was highlighted as CUDA. */
  const lang = ex.lang || (ex.backend === 'sim' ? 'netlist'
                         : ex.backend === 'yosys' ? 'verilog'
                         : ex.backend === 'modal' ? 'cuda' : 'cpp');

  const draftKey = `draft.${slug}.${n}`;
  const editor = WB.mountEditor(host, {
    value: Store.get(draftKey, null) ?? ex.starter,
    lang,
    onChange: v => {
      clearTimeout(HH._saveT);
      HH._saveT = setTimeout(() => Store.set(draftKey, v), 400);
    },
  });
  /* Vim mode: a setting, and desk only. A modal editor on a phone keyboard is
   * a way to lose your work rather than a way to edit faster. */
  const badge = el('#vimbadge');
  const wantVim = Store.get('vim', false)
    && matchMedia('(min-width: 900px)').matches
    && matchMedia('(pointer: fine)').matches;
  if (wantVim && editor.useVim) {
    editor.useVim(true, {
      onMode: m => {
        if (!badge) return;
        badge.hidden = !m;
        badge.textContent = m ? m.toUpperCase() : '';
        badge.dataset.mode = m;
      },
      onMessage: msg => {
        const line = el('#vimmsg');
        if (line) { line.textContent = msg || ''; line.hidden = !msg; }
      },
    });
  } else if (badge) {
    badge.hidden = true;
  }

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
        .map(h => `<div class="hint">${h}</div>`).join('');
      if (shown >= ex.hints.length) hintBtn.remove();
      else hintBtn.innerHTML =
        `Hint <span class="dim">${shown + 1} of ${ex.hints.length}</span>`;
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

  const sel = el('#gpusel');
  if (sel) {
    const note = el('#gpunote');
    const paint = () => {
      const cat = (HH.gpus && HH.gpus.gpus) || [];
      const g = cat.find(x => x.gpu_string === sel.value);
      if (!g || !note) return;
      const hours = (30 / g.price_per_hour);
      note.textContent =
        `${g.name}. $30 of monthly credit is about ` +
        `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} hours of this card.`;
    };
    sel.onchange = () => { Store.set('gpu', sel.value); paint(); };
    paint();
  }

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
      const res = await WB.run(
        { ...ex, gpuChoice: sel ? sel.value : undefined },
        editor.value, {
        judges: HH.judges,
        modal: Store.get('modal', {}),
        gpu: sel ? sel.value : undefined,
        onProgress: (done, total, msg) => {
          if (!total) {
            if (msg) renderVerdicts([{ who: be ? be.label : ex.backend,
                                       state: 'running', title: msg }]);
            return;
          }
          const pct = Math.round((done / total) * 100);
          renderVerdicts([{
            who: be ? be.label : ex.backend, state: 'running',
            title: `Fetching the toolchain: ${pct}% of ` +
                   `${Math.round(total / 1e6)} MB.`,
          }]);
        },
      });
      const wasNew = res.pass && !Store.get(`pass.${slug}.${n}`, false);
      if (res.pass) Store.set(`pass.${slug}.${n}`, true);
      // The reader may have moved on while the tool was thinking. The solve
      // is recorded either way; the verdict is drawn only on the page that
      // asked for it, not on whatever page is there now.
      if (!host.isConnected) return;
      renderVerdicts(res.verdicts, undefined, ex.backend,
                     (res.signals.find(s => s.judge === 'verdict') || {}).key,
                     res.pass);
      renderDiagnosis(ex, res);
      if (res.pass) {
        el('#afterword').hidden = false;
        document.querySelector(`.exnav a[href$="/${n}"]`)?.classList.add('done');
        announce('Correct. ' + (res.verdicts[0]?.title || ''));
        // The one place anything is allowed to speak, and only for a solve
        // that was not already solved.
        if (wasNew && typeof COMPANION !== 'undefined') {
          const total = meta.exercises || 0;
          let done = 0;
          for (let i = 1; i <= total; i++) {
            if (Store.get(`pass.${slug}.${i}`, false)) done++;
          }
          COMPANION.cheer(done, total);
        }
      } else {
        announce('Not yet. ' + (res.verdicts[0]?.title || ''));
      }
    } catch (err) {
      if (!host.isConnected) return;
      renderVerdicts([{ who: ex.backend, state: 'unavailable',
                        title: 'The checker could not run: ' + err.message }]);
    } finally {
      runBtn.disabled = false;
    }
  };
}

function renderVerdicts(verdicts, toolchain, backend, verdictKey, passed) {
  const box = el('#verdicts');
  if (!box) return;
  const foot = toolchain
    ? `<p style="margin:2px 0 0;color:var(--ink-4);font:500 var(--t-micro)/1.5 var(--mono)">
         checked by ${esc(toolchain)}</p>` : '';
  // The verdict describes the run, not a row, so put the link on the row that
  // actually reports the trouble. It was on the first row, which meant a
  // failing attempt explained "nonzero-exit" next to "Compiled cleanly."
  const at = verdicts.findIndex(v => v.state !== 'ok');
  const explainRow = at === -1 ? verdicts.length - 1 : at;
  // Nothing to explain when it worked: "what ok means" is noise on a pass.
  const explain = (i) => (!passed && i === explainRow && backend && verdictKey)
    ? ` <a class="what-is" href="#/errors#${esc(backend)}-${esc(verdictKey)}"
         >what <code>${esc(verdictKey)}</code> means</a>` : '';
  // The stamp says the reader got it right, so it belongs to the run and not
  // to a row. A compiler that is happy about a wrong answer is still happy,
  // and it was stamping "Correct" on every failing attempt that compiled.
  box.innerHTML = verdicts.map((v, i) => `
    <div class="vrow" data-state="${esc(v.state)}">
      <div class="who">${esc(v.who)}</div>
      <div class="what">
        ${passed && i === 0 ? '<span class="stamp">Correct</span><br>' : ''}
        ${esc(v.title)}${explain(i)}
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

/* -------------------------------------------------------------- glossary */

async function viewGlossary() {
  const data = await getJSON('data/glossary.json');
  const terms = data.terms || [];
  if (!terms.length) {
    return `<div class="wrap" style="padding:80px 0"><h1>Glossary</h1>
      <p class="prose">No terms yet.</p></div>`;
  }

  const byLetter = new Map();
  terms.forEach(t => {
    const k = t.slug[0].toUpperCase();
    if (!byLetter.has(k)) byLetter.set(k, []);
    byLetter.get(k).push(t);
  });

  const jump = [...byLetter.keys()].sort().map(k =>
    `<a href="#/glossary#letter-${k}">${k}</a>`).join('');

  const sections = [...byLetter.entries()].sort().map(([k, list]) => `
    <section id="letter-${k}" class="gsec">
      <h2>${k}</h2>
      ${list.map(termCard).join('')}
    </section>`).join('');

  return `
  <div class="wrap" style="padding:48px 0" data-accent="slate">
    <h1>Glossary</h1>
    <p class="prose" style="max-width:var(--measure)">${terms.length} terms.
      Each says where it is used, so a definition is never a dead end.</p>
    <nav class="atlastabs" style="margin-top:18px">${jump}</nav>
    <div class="wbbar" style="margin-top:14px">
      <input class="filter" id="glossq" type="search" spellcheck="false"
             placeholder="filter ${terms.length} terms" aria-label="Filter terms">
      <span class="note" id="glosscount"></span>
    </div>
    <p id="glossnone" class="empty" hidden>
      No term matches that. The glossary only holds terms a written note links
      to with <code>[[double brackets]]</code>, so it grows with the track
      rather than ahead of it. <a href="#/search">Search</a> reads the notes
      themselves.</p>
    ${sections}
  </div>`;
}

function termCard(t) {
  const seeAlso = t.see.length
    ? `<p class="see">See also ${t.see.map(x =>
        `<a href="#/glossary#term-${esc(x)}">${esc(x)}</a>`).join(', ')}.</p>`
    : '';
  const used = t.usedBy.length
    ? `<p class="usedby">Used in ${t.usedBy.map(u => {
        const m = HH.manifest.units.find(x => x.slug === u);
        return `<a href="#/unit/${esc(u)}">${esc(m ? m.title : u)}</a>`;
      }).join(', ')}.</p>`
    : '';
  return `
    <article class="term" id="term-${esc(t.slug)}" data-slug="${esc(t.slug)}">
      <h3><code>${esc(t.slug)}</code></h3>
      <div class="prose" style="font-size:var(--t-sm)">${t.html}</div>
      ${seeAlso}${used}
    </article>`;
}

function wireGlossary() {
  const q = el('#glossq');
  if (!q) return;
  const terms = [...document.querySelectorAll('.term')];
  const secs = [...document.querySelectorAll('.gsec')];
  const count = el('#glosscount');
  const paint = () => {
    const needle = q.value.trim().toLowerCase();
    let shown = 0;
    terms.forEach(t => {
      const hit = !needle || t.textContent.toLowerCase().includes(needle);
      t.hidden = !hit;
      if (hit) shown++;
    });
    secs.forEach(s => {
      s.hidden = ![...s.querySelectorAll('.term')].some(t => !t.hidden);
    });
    count.textContent = needle ? `${shown} of ${terms.length}` : `${terms.length} terms`;
    const none = el('#glossnone');
    if (none) none.hidden = !(needle && shown === 0);
  };
  q.oninput = paint;
  paint();

  // A glossary link from a note carries the term in the fragment.
  const frag = HH.fragment || '';
  if (frag) {
    const target = document.getElementById(frag.startsWith('term-') || frag.startsWith('letter-')
      ? frag : `term-${frag}`);
    if (target) {
      // render() has already scrolled; this only marks what was landed on.
      target.classList.add('landed');
      setTimeout(() => target.classList.remove('landed'), 2400);
    }
  }
}

/* ----------------------------------------------------------------- paths */

/* A hundred and twenty two units in one line answers "what is next" and never
 * answers "what do I need for this". A path answers the second: a named route
 * for one goal, in stages, each stage saying why it is where it is. The build
 * refuses a path that puts a unit before something it needs, so the order on
 * this page is a claim that has been checked. */
async function viewPaths(id) {
  const data = await getJSON('data/paths.json');
  const paths = data.paths || [];
  if (!paths.length) {
    return `<div class="wrap" style="padding:80px 0"><h1>Paths</h1>
      <p class="prose">No paths yet.</p></div>`;
  }
  if (!id) return pathsIndex(paths);
  const p = paths.find(x => x.id === id);
  if (!p) return viewNotFound(`#/paths/${id}`);
  return onePath(p, paths);
}

const hours = m => {
  const h = Math.round(m / 60);
  return h < 2 ? `${m} minutes` : `about ${h} hours`;
};

function pathsIndex(paths) {
  const cards = paths.map(p => `
    <a class="pathcard" href="#/paths/${esc(p.id)}">
      <h2>${esc(p.title)}</h2>
      <p class="pathblurb">${esc(p.blurb)}</p>
      <p class="pathwho"><span class="lbl">Who this is for</span>${esc(p.who)}</p>
      <p class="note">${p.unitCount} units. ${p.readyCount} written so
        far, ${hours(p.minutes)} of reading.</p>
    </a>`).join('');

  return `
  <div class="wrap" style="padding:48px 0" data-accent="slate">
    <p class="eyebrow">Paths</p>
    <h1>Routes through the track</h1>
    <p class="lede" style="max-width:var(--measure)">The track is one line
      because dependencies are one line. Most people arrive with a goal rather
      than a plan, so these are the routes that reach one goal each, in an
      order the build checks: no unit appears before something it needs.</p>
    <div class="pathgrid">${cards}</div>
    <p class="prose" style="max-width:var(--measure);margin-top:34px">None of
      these is the whole handbook, and a path that skips a prerequisite says
      which one it skipped rather than leaving you to find out inside a unit
      that assumed it. If none of them is your goal, the
      <a href="#/track">track</a> is every unit in order.</p>
  </div>`;
}

function onePath(p, all) {
  const bySlug = new Map(HH.manifest.units.map(u => [u.slug, u]));
  let n = 0;

  const stages = p.stages.map((st, i) => `
    <section class="pstage">
      <div class="pstage-head">
        <span class="pstage-n">${i + 1}</span>
        <div>
          <h2>${esc(st.title)}</h2>
          <p class="pstage-why">${esc(st.why)}</p>
        </div>
      </div>
      <ol class="punits">
        ${st.units.map(slug => {
          const u = bySlug.get(slug);
          n++;
          if (!u) return '';
          return `<li class="punit${u.ready ? '' : ' stub'}"
                      data-accent="${esc(u.accent)}">
            <span class="punit-n">${n}</span>
            ${u.ready
              ? `<a href="#/unit/${esc(u.slug)}">${esc(u.title)}</a>`
              : `<span class="punit-t">${esc(u.title)}</span>`}
            <span class="punit-part">Part ${esc(u.partRoman)}</span>
            ${u.ready ? '' : '<span class="punit-stub">not written yet</span>'}
          </li>`;
        }).join('')}
      </ol>
    </section>`).join('');

  const assumed = (p.assumes || []).map(slug => bySlug.get(slug)).filter(Boolean);

  const others = all.filter(x => x.id !== p.id).map(x =>
    `<a href="#/paths/${esc(x.id)}">${esc(x.title)}</a>`).join('');

  return `
  <div class="wrap" style="padding:48px 0" data-accent="slate">
    <p class="eyebrow"><a href="#/paths">Paths</a></p>
    <h1>${esc(p.title)}</h1>
    <p class="lede" style="max-width:var(--measure)">${esc(p.blurb)}</p>
    <p class="prose" style="max-width:var(--measure)"><span class="lbl">Who
      this is for</span>${esc(p.who)}</p>
    <p class="note" style="margin-top:14px">${p.unitCount} units across
      ${p.stages.length} stages. ${p.readyCount} are written, which is
      ${hours(p.minutes)} of reading; the rest are listed here in their place
      and are not written yet.</p>

    ${assumed.length ? `
      <div class="passumes">
        <h3>What this path skips</h3>
        <p>It does not start at the beginning, so it takes these as read. If a
          unit here refers to something you have not met, one of them is
          probably where it was introduced.</p>
        <ul>${assumed.map(u =>
          `<li><a href="#/unit/${esc(u.slug)}">${esc(u.title)}</a>
           <span class="note">Part ${esc(u.partRoman)}</span></li>`).join('')}</ul>
      </div>` : ''}

    <div class="pstages">${stages}</div>

    <p class="prose" style="max-width:var(--measure);margin-top:40px">Other
      routes: ${others}. Or the <a href="#/track">whole track</a>.</p>
  </div>`;
}

/* ----------------------------------------------------------------- atlas */

async function viewAtlas(id) {
  const data = await getJSON('data/atlas.json');
  const tables = data.tables || [];
  if (!tables.length) {
    return `<div class="wrap" style="padding:80px 0"><h1>Atlas</h1>
      <p class="prose">No tables yet.</p></div>`;
  }
  const t = tables.find(x => x.id === id) || tables[0];
  HH.atlas = t;

  const tabs = tables.map(x => `
    <a href="#/atlas/${esc(x.id)}" class="${x.id === t.id ? 'on' : ''}">
      ${esc(x.title)}</a>`).join('');

  const head = t.columns.map(c => `<th>${esc(c.label)}</th>`).join('');
  /* A row with a detail card gets a button in its first cell. A button
   * because it must be reachable from the keyboard, and the card carries
   * things a table cell has no room for: what the generation actually does,
   * which numeric formats it has in hardware, and what it costs to rent. */
  const body = t.rows.map((r, i) => {
    const cells = t.columns.map((c, j) => {
      const v = esc(r[c.key] || '');
      if (j === 0 && r.detail) {
        return `<td${c.mono ? ' class="mono"' : ''}>
          <button class="acard-open" type="button" data-row="${i}"
                  aria-expanded="false"
                  aria-label="Details for ${v}">${v}</button></td>`;
      }
      return `<td${c.mono ? ' class="mono"' : ''}>${v}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  /* The table is what the reader came for, so the table is what is above the
   * fold. Everything that qualifies it, what to know, what could not be
   * verified, where it came from, sits beside it on a wide screen and after
   * it on a narrow one. An earlier version put all three ahead of the table
   * and pushed the data itself off the bottom of the screen. */
  return `
  <div class="wrap" style="padding:48px 0" data-accent="slate">
    <p class="eyebrow">Atlas</p>
    <h1>${esc(t.title)}</h1>
    <p class="lede" style="max-width:var(--measure)">${esc(t.blurb)}</p>

    ${tables.length > 1 ? `<nav class="atlastabs">${tabs}</nav>` : ''}

    <div class="atlasgrid">
      <div class="atlasmain">
        <div class="wbbar">
          <input class="filter" id="atlasq" type="search" spellcheck="false"
                 placeholder="filter ${t.rows.length} rows"
                 aria-label="Filter rows">
          <span class="note" id="atlascount"></span>
        </div>
        <div class="tw">
          <table id="atlastable"><thead><tr>${head}</tr></thead>
          <tbody>${body}</tbody></table>
        </div>
      </div>

      <aside class="atlasside">
        ${t.note ? `<section><h3>Worth knowing</h3>
          <p>${esc(t.note)}</p></section>` : ''}
        ${t.unverified && t.unverified.length ? `
          <section class="atlasside-warn"><h3>Not verified</h3>
            <ul>${t.unverified.map(u => `<li>${esc(u)}</li>`).join('')}</ul>
          </section>` : ''}
        <section><h3>Sources</h3>
          <ul>${t.sources.map(x => `<li>${x.url
            ? `<a href="${esc(x.url)}" rel="noopener">${esc(x.title)}</a>`
            : esc(x.title)}</li>`).join('')}</ul>
          <p class="note">Checked ${esc(t.checked)}.</p>
        </section>
      </aside>
    </div>
  </div>`;
}

/* One popover node for the whole table, moved and refilled, rather than one
 * per row created and destroyed on every hover. Opens on pointer and on
 * focus, because a card that only answers to a mouse is a card some readers
 * never see, and closes on Escape, on scroll, and on the next open. */
function wirePopover({ openers, cardFor, cls }) {
  const pop = document.createElement('div');
  pop.className = cls;
  pop.setAttribute('role', 'dialog');
  pop.hidden = true;
  document.body.appendChild(pop);
  let current = null;

  const close = () => {
    if (!current) return;
    current.setAttribute('aria-expanded', 'false');
    current = null;
    pop.hidden = true;
  };

  const open = (el) => {
    const html = cardFor(el);
    if (!html) return;
    if (current === el) return;
    close();
    current = el;
    el.setAttribute('aria-expanded', 'true');
    pop.innerHTML = html;
    pop.hidden = false;
    // Measure after filling, then place: above if there is no room below, and
    // clamped to the viewport so a row at the right edge does not open a card
    // half off the screen.
    const r = el.getBoundingClientRect();
    const pr = pop.getBoundingClientRect();
    const margin = 10;
    let top = r.bottom + scrollY + 8;
    if (r.bottom + pr.height + 8 > innerHeight && r.top - pr.height - 8 > 0) {
      top = r.top + scrollY - pr.height - 8;
    }
    let left = r.left + scrollX;
    left = Math.max(margin + scrollX,
                    Math.min(left, scrollX + innerWidth - pr.width - margin));
    pop.style.top = `${top}px`;
    pop.style.left = `${left}px`;
  };

  /* Leaving the term does not close the card at once: the pointer has to
   * cross an 8px gap to reach the link inside it, and a card that closes on
   * the gap is a card no mouse can use. Re-entering either cancels the close.
   * (`cls` can be two class names, so it is not a selector; `contains` is.) */
  let leaving = null;
  const onOver = e => {
    clearTimeout(leaving);
    const el = e.target.closest(openers);
    if (el) return open(el);
    if (pop.contains(e.target)) return;
    leaving = setTimeout(close, 220);
  };
  const onFocus = e => {
    const el = e.target.closest(openers);
    if (el) open(el);
  };
  const onKey = e => { if (e.key === 'Escape') close(); };
  const onClick = e => {
    const el = e.target.closest(openers);
    if (el) { e.preventDefault(); current === el ? close() : open(el); }
    else if (!pop.contains(e.target)) close();
  };

  addEventListener('pointerover', onOver);
  addEventListener('focusin', onFocus);
  addEventListener('keydown', onKey);
  addEventListener('click', onClick);
  addEventListener('scroll', close, { passive: true });
  HH.teardown.push(() => {
    clearTimeout(leaving);
    removeEventListener('pointerover', onOver);
    removeEventListener('focusin', onFocus);
    removeEventListener('keydown', onKey);
    removeEventListener('click', onClick);
    removeEventListener('scroll', close);
    pop.remove();
  });
}

function wireAtlas() {
  if (HH.atlas) {
    wirePopover({
      openers: '.acard-open',
      cls: 'pop',
      cardFor: el => (HH.atlas.rows[+el.dataset.row] || {}).detail?.html,
    });
  }
  const q = el('#atlasq');
  if (!q) return;
  const rows = [...document.querySelectorAll('#atlastable tbody tr')];
  const count = el('#atlascount');
  const paint = () => {
    const needle = q.value.trim().toLowerCase();
    let shown = 0;
    rows.forEach(tr => {
      const hit = !needle || tr.textContent.toLowerCase().includes(needle);
      tr.hidden = !hit;
      if (hit) shown++;
    });
    count.textContent = needle
      ? `${shown} of ${rows.length}`
      : `${rows.length} rows`;
  };
  q.oninput = paint;
  paint();
}

/* --------------------------------------------------------------- drills */

async function viewDrills(slug) {
  const meta = HH.manifest.units.find(u => u.slug === slug);
  if (!meta || !meta.ready) return viewNotFound(`#/drills/${slug}`);
  const data = await getJSON(`data/drills/${slug}.json`);
  HH.drills = { slug, list: data.drills, meta };

  const best = Store.get(`drill.${slug}.best`, null);
  return `
  <div class="wrap" data-accent="${esc(meta.accent)}" style="padding:40px 0;max-width:var(--measure)">
    <div class="kicker" style="font:600 var(--t-micro)/1 var(--mono);color:var(--ink-4);
         text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">
      <a href="#/unit/${esc(slug)}">${esc(meta.title)}</a> &middot; drills
    </div>
    <h1>${esc(meta.title)}</h1>
    <p class="prose">${data.drills.length} questions. Nothing is timed and you
      can answer them in any order. Wrong answers explain themselves, which is
      the point of doing them at all.</p>
    ${best !== null ? `<p><span class="badge ok">best so far:
      ${best} of ${data.drills.length}</span></p>` : ''}
    <form id="drillform">${data.drills.map(drillCard).join('')}</form>
    <div class="wbbar" style="margin-top:24px">
      <button class="btn" id="marka">Mark</button>
      <button class="btn ghost" id="resetd">Start again</button>
      <span class="spacer"></span>
      <a class="btn ghost" href="#/work/${esc(slug)}/1">Exercises</a>
    </div>
    <div id="drillout" style="margin-top:18px" aria-live="polite"></div>
  </div>`;
}

function drillCard(d) {
  return `
    <fieldset class="drill" data-n="${d.n}">
      <legend>${d.n}. ${d.q}</legend>
      ${d.options.map((o, i) => `
        <label class="opt">
          <input type="radio" name="q${d.n}" value="${i}">
          <span>${o}</span>
        </label>`).join('')}
      <div class="why" hidden>${d.why}</div>
    </fieldset>`;
}

function wireDrills() {
  const st = HH.drills;
  if (!st) return;
  const form = el('#drillform');
  if (!form) return;

  el('#resetd').onclick = () => {
    form.reset();
    form.querySelectorAll('.drill').forEach(f => {
      f.removeAttribute('data-verdict');
      f.querySelector('.why').hidden = true;
    });
    el('#drillout').innerHTML = '';
    announce('Started again');
  };

  el('#marka').onclick = () => {
    let right = 0, answered = 0;
    const wrong = [];
    st.list.forEach(d => {
      const box = form.querySelector(`.drill[data-n="${d.n}"]`);
      const picked = form.querySelector(`input[name="q${d.n}"]:checked`);
      if (!picked) { box.removeAttribute('data-verdict'); return; }
      answered++;
      const ok = Number(picked.value) === d.correct;
      if (ok) right++; else wrong.push(d.n);
      box.dataset.verdict = ok ? 'ok' : 'bad';
      // The explanation appears either way. Being right for the wrong reason
      // is the failure this catches.
      box.querySelector('.why').hidden = false;
      box.querySelectorAll('.opt').forEach((l, i) => {
        l.dataset.mark = i === d.correct ? 'right'
                       : (Number(picked.value) === i ? 'chosen' : '');
      });
    });

    const prev = Store.get(`drill.${st.slug}.best`, 0);
    if (right > prev) Store.set(`drill.${st.slug}.best`, right);
    Store.set(`drill.${st.slug}.last`, { right, answered, at: Date.now() });
    Store.set(`drill.${st.slug}.attempts`,
              Store.get(`drill.${st.slug}.attempts`, 0) + 1);

    el('#drillout').innerHTML = `
      <div class="vrow" data-state="${right === st.list.length ? 'ok' : 'warn'}">
        <div class="who">${right} / ${st.list.length}</div>
        <div class="what">
          ${answered < st.list.length
            ? `${st.list.length - answered} unanswered. `
            : ''}
          ${wrong.length
            ? `Read the explanation under ${wrong.length === 1 ? 'question' : 'questions'}
               ${wrong.join(', ')}.`
            : 'Every one right.'}
        </div>
      </div>`;
    announce(`${right} of ${st.list.length}`);
    const first = form.querySelector('.drill[data-verdict="bad"]');
    if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
}

/* -------------------------------------------------------------- progress */

function viewProgress() {
  const units = HH.manifest.units;
  const rows = units.filter(u => u.ready).map(u => {
    const read = Store.get(`read.${u.slug}`, -1) + 1;
    const total = u.exercises || 0;
    let solved = 0;
    for (let i = 1; i <= total; i++) if (Store.get(`pass.${u.slug}.${i}`, false)) solved++;
    let hints = 0;
    for (let i = 1; i <= total; i++) hints += Store.get(`hints.${u.slug}.${i}`, 0);
    const best = Store.get(`drill.${u.slug}.best`, null);
    return { u, read, solved, total, hints, best };
  });

  const done = rows.reduce((a, r) => a + r.solved, 0);
  const all = rows.reduce((a, r) => a + r.total, 0);
  // Before anything has been done, a table of zeros tells the reader nothing
  // they did not already know, and hides the one useful link on the page.
  const untouched = rows.every(r => !r.read && !r.solved && r.best === null);
  const first = HH.manifest.units.find(u => u.ready);

  const table = rows.length ? `
    <div class="tw"><table>
      <thead><tr><th>Unit</th><th>Read</th><th>Solved</th><th>Hints</th><th>Drills</th></tr></thead>
      <tbody>${rows.map(r => `
        <tr>
          <td><a href="#/unit/${esc(r.u.slug)}">${esc(r.u.title)}</a></td>
          <td>${r.read ? r.read + ' sections' : 'not yet'}</td>
          <td>${r.solved} / ${r.total}</td>
          <td>${r.hints || ''}</td>
          <td>${r.best === null ? '' : r.best + ' / 15'}</td>
        </tr>`).join('')}</tbody>
    </table></div>` : '';

  return `
  <div class="wrap" style="padding:48px 0">
    <h1>Progress</h1>
    ${untouched ? `
    <div class="empty">
      <p>Nothing recorded yet. This page fills in as you read sections, solve
      exercises and mark drills, and all of it is kept in this browser rather
      than sent anywhere.</p>
      ${first ? `<p style="margin-top:10px">The first unit written so far is
        <a href="#/unit/${esc(first.slug)}">${esc(first.title)}</a>, unit
        ${unitNo(first)} of the track.</p>` : ''}
    </div>
    <p style="margin-top:28px">
      <a class="btn" href="#/track">See the track</a>
    </p>` : `
    <p class="prose">${done} of ${all} exercises solved, across
      ${rows.length} written ${rows.length === 1 ? 'unit' : 'units'}.
      ${units.length - rows.length} more are planned.</p>
    <p class="prose" style="color:var(--ink-4);font-size:var(--t-sm)">
      Hint counts are here because they are worth seeing, not because they
      count against you. A unit solved with hints is a unit solved.</p>
    ${table}
    <p style="margin-top:28px">
      <button class="btn ghost" id="erase">Erase everything</button>
    </p>
    <div id="eraseout" style="margin-top:12px"></div>`}
  </div>`;
}

function wireProgress() {
  const btn = el('#erase');
  if (!btn) return;
  let armed = false;
  btn.onclick = () => {
    if (!armed) {
      armed = true;
      btn.textContent = 'Erase everything, really';
      el('#eraseout').innerHTML =
        '<span class="badge bad">This cannot be undone. Press again.</span>';
      setTimeout(() => {
        if (!armed) return;
        armed = false;
        btn.textContent = 'Erase everything';
        el('#eraseout').innerHTML = '';
      }, 5000);
      return;
    }
    // Preferences are not progress, so they survive an erase. The theme, the
    // runner addresses, and whether the editor is modal.
    const theme = Store.get('theme');
    const modal = Store.get('modal', {});
    const vim = Store.get('vim', false);
    Store.write({ theme, modal, vim });
    announce('Everything erased');
    render();
  };
}

/* ---------------------------------------------------------------- search */

/* Real queries that hit written content. An example that returns nothing is
 * worse than no example, so these are checked by the build. */
const SEARCH_EXAMPLES = ['nand', 'overflow', 'latch', 'warp'];

/* Levenshtein, bounded. Only used to answer "did you mean", so it stops caring
 * once a candidate is clearly not a typo of the query. */
function editDistance(a, b, cap = 4) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1,
                        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, row[j]);
    }
    if (best > cap) return cap + 1;
    prev = row;
  }
  return prev[b.length];
}

/* The nearest indexed word to a query that found nothing, or '' if the query
 * is not a near miss for anything. Suggesting a wildly different word reads as
 * a non-sequitur, so the threshold is deliberately tight. */
function nearestTerm(idx, query) {
  const q = query.toLowerCase().trim();
  if (!q || /\s/.test(q) || q.length < 3) return '';
  let best = '', bestD = Math.min(3, Math.floor(q.length / 2) + 1);
  const seen = new Set();
  for (const doc of idx) {
    for (const w of (doc.title + ' ' + (doc.text || '')).toLowerCase()
                    .split(/[^a-z0-9']+/)) {
      if (w.length < 3 || seen.has(w)) continue;
      seen.add(w);
      const d = editDistance(q, w, bestD);
      if (d > 0 && d < bestD) { bestD = d; best = w; }
    }
  }
  return best;
}

async function viewSearch(q) {
  const query = decodeURIComponent(q || '').trim();
  const idx = await getJSON('data/search.json');
  HH.lastQuery = query;
  const hits = query ? rank(idx, query) : [];
  return `
  <div class="wrap" style="padding:48px 0;max-width:var(--measure)">
    <h1>Search</h1>
    <form id="searchform" style="margin-top:18px">
      <label class="fld"><span>Across notes, sections and exercises</span>
        <input name="q" type="search" spellcheck="false" autofocus
               value="${esc(query)}" placeholder="coalescing, two's complement, latch"></label>
    </form>
    ${query ? `<p style="color:var(--ink-3);margin-top:16px">
       ${hits.length} result${hits.length === 1 ? '' : 's'} for
       <strong>${esc(query)}</strong></p>` : ''}
    <div class="results">${hits.map(resultRow).join('')}</div>
    ${!query ? `<div class="empty">
      <p>This searches the body of every written note, section by section,
      along with exercise titles and their briefs. It does not search the
      planned units, because there is nothing in them yet.</p>
      <p style="margin-top:10px">Try ${SEARCH_EXAMPLES.map(s =>
        `<a href="#/search/${encodeURIComponent(s)}">${esc(s)}</a>`).join(', ')}.</p>
    </div>` : ''}
    ${query && !hits.length ? `<div class="empty">
      <p>Nothing matched <strong>${esc(query)}</strong>.${nearestTerm(idx, query)
        ? ` The closest thing indexed is <a href="#/search/${
            encodeURIComponent(nearestTerm(idx, query))}">${
            esc(nearestTerm(idx, query))}</a>.` : ''}</p>
      <p style="margin-top:10px">${HH.manifest.counts.ready} of
      ${HH.manifest.counts.units} units are written so far, so it may simply
      not be there yet. The <a href="#/track">track</a> lists all of them,
      written or not.</p>
    </div>` : ''}
  </div>`;
}

/* Ranked, and truncated after ranking rather than during traversal.
 *
 * The reference implementation scans for a substring and slices the first
 * sixty in document order, so a query matching many early units silently drops
 * every later one. With 122 units that stops being a detail. */
function rank(idx, query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = [];
  for (const row of idx) {
    const title = (row.title || '').toLowerCase();
    const text = (row.text || '').toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (title === t) score += 100;
      else if (title.startsWith(t)) score += 40;
      else if (title.includes(t)) score += 25;
      if (text.includes(t)) score += 8;
      if (!title.includes(t) && !text.includes(t)) { score = -1; break; }
    }
    if (score > 0) {
      if (row.t === 'unit') score += 6;          // the note before its parts
      scored.push({ row, score });
    }
  }
  scored.sort((a, b) => b.score - a.score || a.row.title.localeCompare(b.row.title));
  return scored.slice(0, 80).map(s => s.row);
}

/* Show the sentence the match is in, not the first 200 characters of the
 * section. A result you have to open to find out why it matched is not much
 * of a result. */
function snippet(text, query) {
  const t = String(text);
  if (!query) return t.slice(0, 180);
  const term = query.toLowerCase().split(/\s+/)[0];
  const at = t.toLowerCase().indexOf(term);
  if (at < 0) return t.slice(0, 180);
  const from = Math.max(0, at - 70);
  const cut = t.slice(from, from + 200);
  return (from ? '…' : '') + cut + (from + 200 < t.length ? '…' : '');
}

function resultRow(r) {
  const href = r.t === 'section' ? `#/unit/${r.slug}/${r.anchor}`
             : r.t === 'exercise' ? `#/work/${r.slug}/${r.n}`
             : r.t === 'drill' ? `#/drills/${r.slug}`
             : `#/unit/${r.slug}`;
  return `
    <a class="card" href="${esc(href)}" style="margin-top:10px">
      <div class="meta"><span>${esc(r.t)}</span><span>${esc(r.part)}</span></div>
      <h3 style="font-size:var(--t-lede)">${esc(r.title)}</h3>
      ${r.text ? `<p>${esc(snippet(r.text, HH.lastQuery))}</p>` : ''}
    </a>`;
}

function wireSearch() {
  const f = el('#searchform');
  if (!f) return;
  f.onsubmit = (ev) => {
    ev.preventDefault();
    const v = f.elements.q.value.trim();
    location.hash = v ? `#/search/${encodeURIComponent(v)}` : '#/search';
  };
}

/* ------------------------------------------------------------- settings */

function viewSettings() {
  const m = Store.get('modal', {}) || {};
  return `
  <div class="wrap" style="padding:48px 0;max-width:var(--measure)">
    <h1>Your GPU runner</h1>
    <p class="prose">Most of this handbook checks your work with tools that
      cost nothing: a simulator in this page, a public compiler service, and a
      synthesiser that runs in your browser. A few units need an actual GPU,
      and there is no honest way to give you one for free.</p>
    <p class="prose">So you rent it. Modal gives every account
      <strong>$30 of credit a month</strong>, which is about five hours of a
      B200 or fifty hours of a T4. You deploy a small runner to your own
      account, paste its two addresses here, and the GPU exercises become
      runnable. Your code goes to your account and nowhere else.</p>

    <h2 style="margin-top:32px">The editor</h2>
    <label class="opt vimopt">
      <input type="checkbox" id="vimtoggle" ${Store.get('vim', false) ? 'checked' : ''}>
      <span><strong>Vim mode</strong><br>
        <span class="note">Normal, insert and visual modes, with counts,
        operators, motions, registers, undo and search. It is off on a phone
        whatever this says, because a modal editor on a touch keyboard is a way
        to lose your work rather than a way to edit faster.</span></span>
    </label>
    <details class="vimhelp">
      <summary>What is bound</summary>
      <div class="prose">
        <p><strong>Modes.</strong> <code>i I a A o O</code> to insert,
        <code>v</code> and <code>V</code> to select, <code>R</code> to replace,
        <code>Escape</code> back to normal.</p>
        <p><strong>Motions.</strong> <code>h j k l w W b B e E 0 ^ $ gg G { }</code>,
        <code>f F t T</code> with <code>;</code> and <code>,</code>, and
        <code>%</code> to the matching bracket. Any of them takes a count.</p>
        <p><strong>Operators.</strong> <code>d c y</code> with any motion, plus
        <code>dd cc yy D C Y x X s S</code>. Then <code>p</code> and
        <code>P</code> to put it back.</p>
        <p><strong>The rest.</strong> <code>r</code> to replace one character,
        <code>J</code> to join, <code>u</code> and <code>Ctrl-r</code> for undo,
        <code>/</code> and <code>?</code> to search with <code>n</code> and
        <code>N</code>.</p>
        <p>Not bound, on purpose: marks, macros, named registers and text
        objects. Each is a real feature and none is the difference between
        editing comfortably and not.</p>
      </div>
    </details>

    <h2 style="margin-top:32px">Deploy it</h2>
    <pre class="cb"><code>pip install modal
modal setup
modal deploy runner/app.py</code></pre>
    <p class="prose">Open <code>runner/app.py</code> first and change
      <code>SHARED_SECRET</code>. Modal's URLs are built from your workspace
      name, so they are guessable, and that secret is what stops a stranger
      spending your credit.</p>

    <h2 style="margin-top:32px">Paste it here</h2>
    <form id="modalForm">
      <label class="fld"><span>Submit address</span>
        <input name="submit" type="url" spellcheck="false"
               placeholder="https://you--hh-runner-submit.modal.run"
               value="${esc(m.submit || '')}"></label>
      <label class="fld"><span>Poll address</span>
        <input name="poll" type="url" spellcheck="false"
               placeholder="https://you--hh-runner-poll.modal.run"
               value="${esc(m.poll || '')}"></label>
      <label class="fld"><span>Shared secret</span>
        <input name="token" type="password" spellcheck="false"
               autocomplete="off" value="${esc(m.token || '')}"></label>
      <p style="margin-top:14px">
        <button class="btn" type="submit">Save</button>
        <button class="btn ghost" type="button" id="testrunner">Test it</button>
        <button class="btn ghost" type="button" id="forget">Forget</button>
      </p>
    </form>
    <div id="settingsOut" style="margin-top:14px"></div>
    <p class="prose" style="color:var(--ink-4);font-size:var(--t-sm)">
      Stored in this browser only. Nothing is sent anywhere except to the
      address you entered.</p>
  </div>`;
}

function wireSettings() {
  const vt = el('#vimtoggle');
  if (vt) {
    vt.onchange = () => {
      Store.set('vim', vt.checked);
      announce(vt.checked
        ? 'Vim mode on. It applies the next time you open an exercise.'
        : 'Vim mode off.');
    };
  }
  const form = el('#modalForm');
  if (!form) return;
  const out = el('#settingsOut');
  const read = () => Object.fromEntries(
    [...new FormData(form).entries()].map(([k, v]) => [k, String(v).trim()]));

  form.onsubmit = (ev) => {
    ev.preventDefault();
    Store.set('modal', read());
    out.innerHTML = '<div class="vrow" data-state="ok"><div class="who">saved</div>' +
      '<div class="what">Stored in this browser.</div></div>';
    announce('Runner saved');
  };

  el('#forget').onclick = () => {
    Store.set('modal', {});
    form.reset();
    ['submit', 'poll', 'token'].forEach(n => { form.elements[n].value = ''; });
    out.innerHTML = '<div class="vrow" data-state="unavailable">' +
      '<div class="who">cleared</div><div class="what">Nothing stored.</div></div>';
  };

  el('#testrunner').onclick = async () => {
    const cfg = read();
    if (!cfg.submit || !cfg.poll || !cfg.token) {
      out.innerHTML = '<div class="vrow" data-state="bad"><div class="who">no</div>' +
        '<div class="what">All three fields are needed.</div></div>';
      return;
    }
    Store.set('modal', cfg);
    out.innerHTML = '<div class="vrow" data-state="running"><div class="who">gpu</div>' +
      '<div class="what">Sending a one-line kernel to a T4. A cold start takes about a minute.</div></div>';
    const ex = { backend: 'modal', lang: 'cuda', kind: 'output', flags: '',
                 gpu: 'sm_75', gpuChoice: 'T4', diagnose: [] };
    const src = '#include <cstdio>\n' +
      '__global__ void k(int* o){ o[threadIdx.x] = threadIdx.x * threadIdx.x; }\n' +
      'int main(){ int* o; cudaMallocManaged(&o, 128); k<<<1,32>>>(o);\n' +
      '  cudaDeviceSynchronize(); printf("%d %d %d\\n", o[3], o[10], o[31]); }\n';
    const res = await WB.run(ex, src, { judges: HH.judges, modal: cfg, gpu: 'T4' });
    const good = res.pass && /9 100 961/.test(
      res.verdicts.map(v => v.detail || '').join(' '));
    out.innerHTML = `<div class="vrow" data-state="${good ? 'ok' : 'bad'}">
      <div class="who">${good ? 'works' : 'no'}</div>
      <div class="what">${res.verdicts.map(v => esc(v.title)).join(' ')}
        ${good ? 'Your runner is ready.' : ''}</div></div>`;
    announce(good ? 'Runner works' : 'Runner did not answer correctly');
  };
}

/* ---------------------------------------------------------------- errors */

/* Every verdict every backend can report. The build refuses to ship a verdict
 * that is not here and an entry for a verdict no backend can emit, so this
 * page cannot drift away from what the workbench actually says. */
async function viewErrors() {
  const data = await getJSON('data/errors.json');
  const entries = data.entries || [];
  const label = {
    sim: 'The simulator, in this page',
    godbolt: 'Compiler Explorer',
    yosys: 'Yosys, in this page',
    modal: 'Your GPU runner',
  };

  const sections = data.backends.map(b => {
    const list = entries.filter(e => e.backend === b);
    if (!list.length) return '';
    return `
    <section class="ebackend" id="backend-${esc(b)}" data-backend="${esc(b)}">
      <h2>${esc(b)} <span class="note">${esc(label[b] || '')}</span></h2>
      ${list.map(e => `
        <article class="eentry" id="${esc(e.id)}" data-hay="${
          esc((e.verdict + ' ' + e.short).toLowerCase())}">
          <h3><code>${esc(e.verdict)}</code></h3>
          <p class="eshort">${e.short}</p>
          <div class="prose">${e.html}</div>
        </article>`).join('')}
    </section>`;
  }).join('');

  return `
  <div class="wrap errors" style="padding:48px 0" data-accent="slate">
    <h1>Errors</h1>
    <p class="prose" style="max-width:var(--measure)">Every verdict the four
      backends can report, and what each one usually means. A result row in the
      workbench links straight to its entry here.</p>
    <nav class="atlastabs" style="margin-top:18px">${
      data.backends.map(b => `<a href="#/errors#backend-${esc(b)}">${esc(b)}</a>`
      ).join('')}</nav>
    <div class="wbbar" style="margin-top:14px">
      <input class="filter" id="errq" type="search" spellcheck="false"
             placeholder="filter ${entries.length} verdicts"
             aria-label="Filter verdicts">
      <span class="note" id="errcount"></span>
    </div>
    <p id="errnone" class="empty" hidden>
      No verdict matches that. These are the only ones the backends can report,
      so if you saw something else on a result row it is a bug in this handbook
      rather than a verdict missing from this page.</p>
    ${sections}
  </div>`;
}

function wireErrors() {
  const q = el('#errq');
  if (!q) return;
  const entries = [...document.querySelectorAll('.eentry')];
  const secs = [...document.querySelectorAll('.ebackend')];
  const count = el('#errcount');
  const none = el('#errnone');
  const paint = () => {
    const needle = q.value.trim().toLowerCase();
    let shown = 0;
    entries.forEach(e => {
      const hit = !needle || e.dataset.hay.includes(needle);
      e.hidden = !hit;
      if (hit) shown++;
    });
    secs.forEach(s => {
      s.hidden = ![...s.querySelectorAll('.eentry')].some(e => !e.hidden);
    });
    count.textContent = needle
      ? `${shown} of ${entries.length}` : `${entries.length} verdicts`;
    none.hidden = !(needle && shown === 0);
  };
  q.oninput = paint;
  paint();
  HH.teardown.push(() => { q.value = ''; });
}

function viewNotFound(hash) {
  // A 404 here is usually a mistyped or renamed unit slug, so say which unit
  // was probably meant rather than only that this one does not exist.
  const tail = (hash.split('/').filter(Boolean).pop() || '').toLowerCase();
  let near = null;
  if (tail.length >= 3) {
    let bestD = 4;
    for (const u of HH.manifest.units) {
      const d = editDistance(tail, u.slug, bestD);
      if (d > 0 && d < bestD) { bestD = d; near = u; }
    }
  }
  return `<div class="wrap notfound" style="padding:80px 0">
    <img class="lost" src="assets/img/mascot-512.png" width="150" height="150"
         alt="The handbook mascot, an eagle in a hard hat, looking at a laptop">
    <h1>No such page</h1>
    <p class="prose">Nothing is routed at <code>${esc(hash)}</code>.</p>
    <div class="empty">
      ${near ? `<p>The closest unit in the track is
        <a href="#/unit/${esc(near.slug)}">${esc(near.title)}</a>
        (<code>${esc(near.slug)}</code>).</p>` : ''}
      <p${near ? ' style="margin-top:10px"' : ''}>Every page here lives under
      <code>#/track</code>, <code>#/unit/&lt;slug&gt;</code>,
      <code>#/work/&lt;slug&gt;/&lt;n&gt;</code> or
      <code>#/drills/&lt;slug&gt;</code>. The
      <a href="#/track">track</a> links all ${HH.manifest.counts.units} of them.</p>
    </div>
    <p style="margin-top:24px"><a class="btn" href="#/">Back to the start</a></p>
  </div>`;
}

function viewError(err) {
  return `<div class="wrap" style="padding:80px 0">
    <h1>That did not load</h1>
    <p class="prose">${esc(err.message || String(err))}</p>
    <p><button class="btn" id="retry">Try again</button></p>
  </div>`;
}

/* ---------------------------------------------------------------- routing */

const ROUTES = {
  '': viewHome,
  'track': viewTrack,
  'unit': viewUnit,
  'work': viewWork,
  'atlas': viewAtlas,
  'paths': viewPaths,
  'glossary': viewGlossary,
  'errors': viewErrors,
  'settings': viewSettings,
  'drills': viewDrills,
  'progress': viewProgress,
  'search': viewSearch,
};

let renderSeq = 0;

async function render() {
  // Views fetch, so two navigations can be in flight at once, and without
  // this they paint in the order they finish: a slow unit overwrites the
  // fast one the reader clicked to afterwards, wired to the wrong DOM.
  const seq = ++renderSeq;
  // A second '#' is a fragment within the view, as in #/glossary#nand or
  // #/track#physics. It must be split off before the route is parsed, or the
  // route becomes literally "glossary#nand" and matches nothing.
  const full = location.hash.replace(/^#\/?/, '');
  const hashAt = full.indexOf('#');
  const raw = hashAt >= 0 ? full.slice(0, hashAt) : full;
  HH.fragment = hashAt >= 0 ? full.slice(hashAt + 1) : '';
  const [route, a, b] = raw.split('/');
  const main = el('#main');

  HH.teardown.splice(0).forEach(fn => { try { fn(); } catch {} });

  document.querySelectorAll('nav.main a, nav.tabs a').forEach(a => {
    if (a.dataset.route === route) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  try {
    const fn = ROUTES[route];
    main.setAttribute('aria-busy', 'true');
    const html = fn ? await fn(a, b) : viewNotFound(location.hash || '#/');
    if (seq !== renderSeq) return;
    main.innerHTML = html;
    if (route === 'unit' && a) wireUnit(a);
    if (route === 'work') wireWork();
    if (route === 'settings') wireSettings();
    if (route === 'drills') wireDrills();
    if (route === 'progress') wireProgress();
    if (route === 'search') wireSearch();
    if (route === 'track') wireTrack();
    if (route === 'atlas') wireAtlas();
    if (route === 'glossary') wireGlossary();
    if (route === 'errors') wireErrors();
  } catch (err) {
    console.error(err);
    if (seq !== renderSeq) return;
    main.innerHTML = viewError(err);
    const r = el('#retry');
    if (r) r.onclick = () => { HH.cache.clear(); render(); };
  } finally {
    if (seq === renderSeq) main.removeAttribute('aria-busy');
  }

  // Focus the heading so a keyboard or screen-reader user lands in the content
  // rather than back at the top of the document.
  const h = main.querySelector('h1');
  if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  // Position the page exactly once, here, and never leave it where the last
  // view left it. A fragment is handled generically so any view gets it for
  // free: #/track#gpu works because the section carries that id, without the
  // track view knowing anything about fragments.
  if (route === 'unit' && b) {
    if (!land(b, 'instant')) window.scrollTo({ top: 0, behavior: 'instant' });
  } else if (HH.fragment) {
    const target = document.getElementById(HH.fragment)
      || document.getElementById(`term-${HH.fragment}`);
    if (target) target.scrollIntoView({ block: 'start', behavior: 'instant' });
    else window.scrollTo({ top: 0, behavior: 'instant' });
  } else {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  announce(h ? h.textContent.trim() : 'Page changed');
}

/* ----------------------------------------------------------------- theme */

/* The theme itself is chosen by the inline script in index.html, before the
 * stylesheet loads, so a light-preference reader never sees a dark frame.
 * This wires the button, names the theme it would switch to, and keeps the
 * browser chrome the colour of the page. */
function initTheme() {
  const btn = el('#theme');
  const meta = document.querySelector('meta[name="theme-color"]');
  const paint = () => {
    const cur = document.documentElement.dataset.theme;
    const label = `Switch to ${cur === 'dark' ? 'light' : 'dark'} theme`;
    btn.setAttribute('aria-label', label);
    btn.title = label;
    if (meta) meta.content =
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  };
  btn.onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    Store.set('theme', next);
    paint();
    announce(`${next} theme`);
  };
  paint();
}

/* ------------------------------------------------------------------ boot */

async function boot() {
  // This app positions the page itself: to the top on navigation, or to a
  // heading on a deep link. The browser's own restoration runs AFTER that and
  // silently undoes it, which lands a deep-linked heading exactly
  // scroll-margin-top too far down. Take the wheel.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  initTheme();
  // "#main" would otherwise reach the router as a route and render the 404.
  el('.skip').onclick = ev => { ev.preventDefault(); el('#main').focus(); };
  try {
    HH.manifest = await getJSON('data/manifest.json');
    // The backend configuration comes from the build, not from this file, so
    // the page cannot call a toolchain --validate has never checked.
    HH.judges = await getJSON('data/judges.json');
    HH.gpus = await getJSON('data/modal-gpus.json');
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
