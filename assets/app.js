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

      ${ex.backend === 'modal' ? gpuPicker(ex) : ''}

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
  const body = t.rows.map(r => `<tr>${t.columns.map(c =>
    `<td${c.mono ? ' class="mono"' : ''}>${esc(r[c.key] || '')}</td>`
  ).join('')}</tr>`).join('');

  return `
  <div class="wrap" style="padding:48px 0" data-accent="slate">
    <h1>Atlas</h1>
    <p class="prose" style="max-width:var(--measure)">Reference tables. The
      units teach the depth; these hold the map. Every table says where it came
      from, when it was checked, and what could not be verified.</p>

    ${tables.length > 1 ? `<nav class="atlastabs">${tabs}</nav>` : ''}

    <h2 style="margin-top:32px">${esc(t.title)}</h2>
    <p class="prose" style="max-width:var(--measure)">${esc(t.blurb)}</p>
    ${t.note ? `<p class="idea" style="max-width:var(--measure)">
      <span class="lbl">Worth knowing</span>${esc(t.note)}</p>` : ''}

    <div class="wbbar" style="margin-top:18px">
      <input class="filter" id="atlasq" type="search" spellcheck="false"
             placeholder="filter ${t.rows.length} rows" aria-label="Filter rows">
      <span class="note" id="atlascount"></span>
    </div>

    <div class="tw" style="margin-top:12px">
      <table id="atlastable"><thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody></table>
    </div>

    ${t.unverified && t.unverified.length ? `
      <div class="unverified">
        <h3>Not verified</h3>
        <ul>${t.unverified.map(u => `<li>${esc(u)}</li>`).join('')}</ul>
      </div>` : ''}

    <div class="sources">
      <h3>Sources</h3>
      <ul>${t.sources.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      <p>Checked ${esc(t.checked)}.</p>
    </div>
  </div>`;
}

function wireAtlas() {
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
      <legend>${d.n}. ${esc(d.q)}</legend>
      ${d.options.map((o, i) => `
        <label class="opt">
          <input type="radio" name="q${d.n}" value="${i}">
          <span>${esc(o)}</span>
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
    <div id="eraseout" style="margin-top:12px"></div>
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
    // The theme is a preference, not progress, so it survives.
    const theme = Store.get('theme');
    const modal = Store.get('modal', {});
    Store.write({ theme, modal });
    announce('Everything erased');
    render();
  };
}

/* ---------------------------------------------------------------- search */

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
    ${query && !hits.length ? `<p class="prose">Nothing matched. The track is
      ${HH.manifest.counts.units} units, of which ${HH.manifest.counts.ready}
      are written so far, so it may simply not exist yet.</p>` : ''}
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
  'atlas': viewAtlas,
  'glossary': viewGlossary,
  'settings': viewSettings,
  'drills': viewDrills,
  'progress': viewProgress,
  'search': viewSearch,
};

async function render() {
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
    main.innerHTML = fn ? await fn(a, b) : viewNotFound(location.hash || '#/');
    if (route === 'unit' && a) wireUnit(a);
    if (route === 'work') wireWork();
    if (route === 'settings') wireSettings();
    if (route === 'drills') wireDrills();
    if (route === 'progress') wireProgress();
    if (route === 'search') wireSearch();
    if (route === 'atlas') wireAtlas();
    if (route === 'glossary') wireGlossary();
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
