/* The Yosys checking logic, shared by the browser worker and the build-time
 * validator. Neither models the other: they run this exact code.
 *
 * Pure with respect to the DOM. The only I/O is the dynamic import of the
 * WebAssembly runtime.
 */

const YOSYS_URL = 'https://cdn.jsdelivr.net/npm/@yowasp/yosys@0.68.1207/+esm';

let mod = null;
let loading = null;

/* The browser imports the pinned CDN build. Node cannot: network imports were
 * removed, so the build-time validator caches the same version to disk and
 * passes its path here. Same version, same code, two ways in. */
function load(url) {
  if (mod) return Promise.resolve(mod);
  if (!loading) {
    loading = import(/* @vite-ignore */ url || YOSYS_URL)
      .then((m) => { mod = m; return m; });
  }
  return loading;
}

/** Point at a locally cached runtime. Must be called before the first check. */
function useRuntime(url) {
  if (mod || loading) throw new Error('the runtime is already loading');
  return load(url);
}

/** Run yosys once. Returns { code, out }.
 *
 * Never pass -q: it suppresses the `stat` output the checks read, which is a
 * silent way to make every cell-count assertion see zero.
 */
async function yosys(files, script, onProgress) {
  const m = await load();
  let out = '';
  const dec = new TextDecoder();
  const sink = (b) => { if (b) out += dec.decode(b); };
  let code = 0;
  try {
    await m.runYosys(['-p', script], files, {
      stdout: sink, stderr: sink,
      fetchProgress: onProgress || undefined,
    });
  } catch (e) {
    code = (e && typeof e.code === 'number') ? e.code : -1;
    if (e && e.message && code === -1) out += '\n' + e.message;
  }
  return { code, out };
}

const cellCount = (out, name) => {
  const m = out.match(new RegExp('(\\d+)\\s+\\' + name + '(?:\\s|$)', 'm'));
  return m ? Number(m[1]) : 0;
};

const allCells = (out) => {
  const cells = {};
  const section = out.split(/\n\s*\d+\s+cells\s*\n/).pop() || out;
  for (const m of section.matchAll(/^\s*(\d+)\s+(\$[\w$]+)\s*$/gm)) {
    cells[m[2]] = Number(m[1]);
  }
  return cells;
};

const firstLine = (out, re) =>
  (out.split('\n').find(l => re.test(l)) || '').trim();

/**
 * spec: {
 *   top:    "m",
 *   files:  { "extra.v": "..." },       optional support files
 *   script: "read_verilog m.v; synth -top m; stat",   optional override
 *   cells:  { "$_DFF_P_": 2 },          exact counts the design must have
 *   forbid: ["$_DLATCH_"],              cells that must not appear at all
 *   gold:   "module gold(...) ... ",    prove equivalence against this
 *   maxCells: 12,
 * }
 */
async function check(src, spec, onProgress) {
  const top = spec.top || 'top';
  const files = { [`${top}.v`]: src, ...(spec.files || {}) };

  // Equivalence is its own script and its own verdict.
  if (spec.gold) {
    files['gold.v'] = spec.gold;
    const script = spec.script ||
      `read_verilog gold.v; read_verilog ${top}.v; prep; ` +
      `equiv_make gold ${top} equiv; equiv_simple; equiv_induct; ` +
      `equiv_status -assert`;
    const r = await yosys(files, script, onProgress);
    if (/^ERROR:.*syntax|syntax error/im.test(r.out)) {
      return { verdict: 'syntax-error', message: firstLine(r.out, /error/i), out: r.out };
    }
    if (r.code === 0) {
      return { verdict: 'ok', message: 'Proved equivalent to the reference design.',
               out: r.out, proved: true };
    }
    const unproven = firstLine(r.out, /unproven|not equivalent|ERROR/i);
    return {
      verdict: 'sat-fail',
      message: unproven || 'The design is not equivalent to the reference.',
      out: r.out,
    };
  }

  const script = spec.script || `read_verilog ${top}.v; synth -top ${top}; stat`;
  const r = await yosys(files, script, onProgress);

  if (/syntax error|^ERROR: Parser error/im.test(r.out)) {
    return { verdict: 'syntax-error', message: firstLine(r.out, /error/i), out: r.out };
  }
  if (r.code !== 0 && !/\bstat\b/.test(r.out)) {
    return {
      verdict: 'syntax-error',
      message: firstLine(r.out, /error/i) || `yosys exited with ${r.code}`,
      out: r.out,
    };
  }

  const cells = allCells(r.out);

  // A latch where the author meant combinational logic is the classic
  // Verilog bug, and yosys names it precisely.
  //
  // The cell decides, not the message. yosys prints "No latch inferred for
  // signal ..." on the happy path, and a naive /Latch inferred/i matches that
  // sentence too, which reported a latch on every correct design.
  const latched = Object.keys(cells).some(c => /^\$_DLATCH/.test(c)) ||
                  cells['$dlatch'] > 0;
  const latchLine = firstLine(r.out, /(?:^|[^o])\bLatch inferred/i);
  if (latched) {
    return {
      verdict: 'latch-inferred',
      message: latchLine || 'The design infers a latch.',
      cells, out: r.out,
    };
  }

  if (/multiple driver|conflicting drivers/i.test(r.out)) {
    return {
      verdict: 'multi-driver',
      message: firstLine(r.out, /driver/i),
      cells, out: r.out,
    };
  }

  for (const bad of spec.forbid || []) {
    if (cells[bad]) {
      return {
        verdict: 'cell-budget',
        message: `The design contains ${cells[bad]} ${bad}, which this ` +
                 `exercise does not allow.`,
        cells, out: r.out,
      };
    }
  }

  const wantCells = spec.cells || {};
  for (const [name, want] of Object.entries(wantCells)) {
    const got = cells[name] || 0;
    if (got !== want) {
      return {
        verdict: 'cell-budget',
        message: `Synthesised to ${got} ${name}, and this exercise wants ` +
                 `${want}.`,
        cells, out: r.out,
      };
    }
  }

  const total = Object.values(cells).reduce((a, b) => a + b, 0);
  if (spec.maxCells && total > spec.maxCells) {
    return {
      verdict: 'cell-budget',
      message: `Correct, but ${total} cells against a budget of ${spec.maxCells}.`,
      cells, out: r.out,
    };
  }

  return {
    verdict: 'ok',
    message: total
      ? `Synthesised to ${total} cell${total === 1 ? '' : 's'}.`
      : 'Synthesised.',
    cells, out: r.out,
  };
}

export { check, yosys, allCells, firstLine, load, useRuntime, YOSYS_URL };
