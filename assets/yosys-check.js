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

/* Yosys prints "Longest topological path in m (length=15):". The length is a
 * count of cells on the deepest combinational path, which is the closest thing
 * a gate-level netlist has to a delay: real timing needs a cell library with
 * picoseconds in it, and depth is what is left when you do not have one.
 *
 * -noff stops the walk at flip-flops, so what is measured is one clock period's
 * worth of logic rather than a path through the whole design. */
const pathLength = (out) => {
  const m = out.match(/Longest topological path in .*?\(length=(\d+)\)/);
  return m ? Number(m[1]) : null;
};

/** Every size assertion a spec can make, applied to one cell tally.
 *
 * Shared by the plain path and the equivalence path so a budget means the same
 * thing whether or not the exercise also proves correctness. Returns a verdict
 * when something fails and null when everything holds.
 */
function budgetVerdict(cells, spec, out) {
  for (const bad of spec.forbid || []) {
    if (cells[bad]) {
      return {
        verdict: 'cell-budget',
        message: `The design contains ${cells[bad]} ${bad}, which this ` +
                 `exercise does not allow.`,
        cells, out,
      };
    }
  }
  for (const [name, want] of Object.entries(spec.cells || {})) {
    const got = cells[name] || 0;
    if (got !== want) {
      return {
        verdict: 'cell-budget',
        message: `Synthesised to ${got} ${name}, and this exercise wants ` +
                 `${want}.`,
        cells, out,
      };
    }
  }
  const total = Object.values(cells).reduce((a, b) => a + b, 0);
  if (spec.maxCells !== undefined && total > spec.maxCells) {
    return {
      verdict: 'cell-budget',
      message: `Correct, but ${total} cells against a budget of ${spec.maxCells}.`,
      cells, out,
    };
  }
  if (spec.maxDepth !== undefined) {
    const depth = pathLength(out);
    if (depth === null) {
      return {
        verdict: 'path-too-long',
        message: 'The depth of the longest path could not be measured.',
        cells, out,
      };
    }
    if (depth > spec.maxDepth) {
      return {
        verdict: 'path-too-long',
        message: `Correct, and its longest path is ${depth} cells deep ` +
                 `against a limit of ${spec.maxDepth}.`,
        cells, depth, out,
      };
    }
  }
  return null;
}

/** Synthesise for real and apply the spec's size assertions. Used after an
 *  equivalence proof, where the equivalence script's netlist is the wrong
 *  thing to count: it holds both designs and the miter between them. */
async function sizeCheck(files, spec, top, onProgress) {
  const r = await yosys(
    files,
    `read_verilog ${top}.v; synth -top ${top}; stat` +
      (spec.maxDepth !== undefined ? '; ltp -noff' : ''),
    onProgress);
  return budgetVerdict(allCells(r.out), spec, r.out);
}

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
    // `flatten` is not optional. Without it a design built from submodules
    // keeps its instances as opaque boxes, the solver cannot see through them,
    // and a correct ripple-carry adder is reported as not equivalent to `a+b`.
    // `opt_clean` afterwards keeps the equivalence problem to the size the
    // solver was going to need anyway.
    const script = spec.script ||
      `read_verilog gold.v; read_verilog ${top}.v; prep; flatten; opt_clean; ` +
      `equiv_make gold ${top} equiv; equiv_simple; equiv_induct; ` +
      `equiv_status -assert`;
    const r = await yosys(files, script, onProgress);
    if (/^ERROR:.*syntax|syntax error/im.test(r.out)) {
      return { verdict: 'syntax-error', message: firstLine(r.out, /error/i), out: r.out };
    }
    // A design with two drivers on one wire is wrong whatever it proves equal
    // to, and yosys warns about it during `prep`. This branch used to ignore
    // that line, so an exercise about the shared-bus rule reported `ok`.
    if (/multiple driver|conflicting drivers/i.test(r.out)) {
      return {
        verdict: 'multi-driver',
        message: firstLine(r.out, /driver/i),
        out: r.out,
      };
    }
    if (r.code !== 0) {
      const unproven = firstLine(r.out, /unproven|not equivalent|ERROR/i);
      return {
        verdict: 'sat-fail',
        message: unproven || 'The design is not equivalent to the reference.',
        out: r.out,
      };
    }
    // Proved correct. If the exercise also has something to say about size,
    // it gets said: a spec that carried both a gold and a budget used to have
    // the budget silently dropped, which is an assertion that looks like it
    // ran and never did.
    const sized_ = spec.cells || spec.forbid ||
                   spec.maxCells !== undefined || spec.maxDepth !== undefined;
    if (!sized_) {
      return { verdict: 'ok', message: 'Proved equivalent to the reference design.',
               out: r.out, proved: true };
    }
    const sized = await sizeCheck(files, spec, top, onProgress);
    return sized || {
      verdict: 'ok',
      message: 'Proved equivalent to the reference design, and within budget.',
      out: r.out, proved: true,
    };
  }

  const script = spec.script ||
    `read_verilog ${top}.v; synth -top ${top}; stat` +
    (spec.maxDepth !== undefined ? '; ltp -noff' : '');
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

  const budget = budgetVerdict(cells, spec, r.out);
  if (budget) return budget;

  const total = Object.values(cells).reduce((a, b) => a + b, 0);
  return {
    verdict: 'ok',
    message: total
      ? `Synthesised to ${total} cell${total === 1 ? '' : 's'}.`
      : 'Synthesised.',
    cells, out: r.out,
  };
}

export { check, yosys, allCells, firstLine, load, useRuntime, YOSYS_URL };
