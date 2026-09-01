/* The logic simulator: the checking backend for Part II.
 *
 * No network, no account, no server. Standing up a service to check that
 * someone wired an XOR correctly would be building a server to do arithmetic.
 *
 * Learners write a netlist, not a program. The language is deliberately tiny
 * and deliberately not sequential, because "your code is not executed, it is
 * built" is the idea Part III depends on and this is where it starts:
 *
 *     chip Xor(a, b) -> out {
 *       n1  = nand(a, b)
 *       n2  = nand(a, n1)
 *       n3  = nand(b, n1)
 *       out = nand(n2, n3)
 *     }
 *
 * Order of lines carries no meaning. `out = nand(n2, n3)` could be written
 * first. What matters is the graph.
 *
 * The five verdicts this emits are the `sim` vocabulary in build.py, and the
 * build rejects any exercise that expects a verdict not in that list:
 *
 *     ok               everything matched
 *     table-mismatch   a row disagreed with the specification
 *     non-nand-part    used a gate that was not built from nand
 *     cycle            a combinational loop, illegal without a clock
 *     floating-input   an input was never connected
 *     gate-budget      correct, but over the allowed gate count
 *
 * There is a second primitive, `dff`, and it is an axiom rather than something
 * built from nand. Its output this cycle is its input from the previous one.
 * That single part is what makes a loop legal: a value may depend on itself if
 * the dependency passes through a clock edge, and may not otherwise. Part II
 * builds every register, counter and memory in the machine from nand and dff
 * and nothing else.
 *
 * Runs in a Worker in the browser and directly under Node for the tests, so it
 * takes no dependency on either.
 */

'use strict';

/* --------------------------------------------------------------- parsing */

const RE_CHIP = /^chip\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*->\s*([^{]+)\{$/;
const RE_ASSIGN = /^([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\s*\(([^)]*)\)$/;

/* Layout is not meaning. A learner may write a chip on one line, or put the
 * brace anywhere, and the netlist is the same graph either way. Normalise
 * before parsing rather than rejecting formatting. Line numbers are carried
 * through so an error still points at the line the learner wrote. */
function normalise(src) {
  const out = [];
  src.split('\n').forEach((raw, i) => {
    const text = raw.replace(/\/\/.*$/, '');
    let rest = text;
    // break after `{`, before `}`, and between `)` and the next assignment
    rest = rest
      .replace(/\{/g, '{\u0000')
      .replace(/\}/g, '\u0000}\u0000')
      .replace(/\)\s+(?=[A-Za-z_]\w*\s*=)/g, ')\u0000');
    rest.split('\u0000').forEach(piece => {
      if (piece.trim()) out.push({ text: piece.trim(), line: i + 1 });
    });
  });
  return out;
}

function parse(src) {
  const lines = normalise(src);
  const chips = [];
  let cur = null;

  for (let k = 0; k < lines.length; k++) {
    const { text: line, line: ln1 } = lines[k];
    const ln = ln1 - 1;   // the loop below reports ln + 1
    if (!line) continue;

    if (line === '}') {
      if (!cur) throw new SimError('stray `}`', ln + 1);
      chips.push(cur);
      cur = null;
      continue;
    }

    const chip = RE_CHIP.exec(line);
    if (chip) {
      if (cur) throw new SimError(`chip ${cur.name} was never closed`, ln + 1);
      const [, name, ins, outs] = chip;
      cur = {
        name,
        inputs: splitNames(ins, ln + 1),
        outputs: splitNames(outs, ln + 1),
        stmts: [],
        line: ln + 1,
      };
      if (!cur.inputs.length) throw new SimError(`chip ${name} has no inputs`, ln + 1);
      if (!cur.outputs.length) throw new SimError(`chip ${name} has no outputs`, ln + 1);
      continue;
    }

    const asn = RE_ASSIGN.exec(line);
    if (asn) {
      if (!cur) throw new SimError('assignment outside a chip', ln + 1);
      const [, target, part, args] = asn;
      cur.stmts.push({
        target, part,
        args: splitNames(args, ln + 1),
        line: ln + 1,
      });
      continue;
    }

    throw new SimError(`cannot read this line: ${line}`, ln + 1);
  }

  if (cur) throw new SimError(`chip ${cur.name} was never closed`, cur.line);
  if (!chips.length) throw new SimError('no chip defined', 1);
  return chips;
}

function splitNames(s, line) {
  const names = s.split(',').map(x => x.trim()).filter(Boolean);
  for (const n of names) {
    if (!/^[A-Za-z_]\w*$/.test(n)) throw new SimError(`bad name: ${n}`, line);
  }
  return names;
}

class SimError extends Error {
  constructor(msg, line) { super(msg); this.line = line; }
}

/* ------------------------------------------------------------- analysis */

/** Walk to the leaves. The only leaves allowed are `nand` and `dff`.
 *  Using a built-in xor to build xor is not an answer. */
const PRIMITIVES = new Set(['nand', 'dff']);

function checkParts(chip, library) {
  const bad = [];
  for (const s of chip.stmts) {
    if (PRIMITIVES.has(s.part)) continue;
    if (library[s.part]) continue;
    bad.push({ part: s.part, line: s.line });
  }
  return bad;
}

/** A combinational loop is not a clever trick: a value that depends on its own
 *  present value is not a function of the inputs and cannot be defined.
 *
 *  A loop through a `dff` is a different thing entirely and is legal, because
 *  the dependency is on the previous cycle rather than on this one. So the
 *  walk does not follow a dff's inputs, and whatever cycles remain after that
 *  are the genuinely undefined ones. */
function findCycle(chip) {
  const producer = new Map();
  chip.stmts.forEach(s => producer.set(s.target, s));

  const WHITE = 0, GREY = 1, BLACK = 2;
  const colour = new Map();
  const stack = [];

  const visit = (wire) => {
    const s = producer.get(wire);
    if (!s) return null;                 // an input, or floating: not our job
    const c = colour.get(wire) || WHITE;
    if (c === BLACK) return null;
    if (c === GREY) return [...stack.slice(stack.indexOf(wire)), wire];
    colour.set(wire, GREY);
    stack.push(wire);
    // A dff ends the combinational path. What feeds it is last cycle's problem.
    if (s.part !== 'dff') {
      for (const a of s.args) {
        const loop = visit(a);
        if (loop) return loop;
      }
    }
    stack.pop();
    colour.set(wire, BLACK);
    return null;
  };

  for (const s of chip.stmts) {
    const loop = visit(s.target);
    if (loop) return loop;
  }
  return null;
}

/** An unconnected wire is not 0. It has no value, and a simulator that
 *  quietly treated it as 0 would let a design ship that fails on silicon. */
function findFloating(chip) {
  const defined = new Set([...chip.inputs, ...chip.stmts.map(s => s.target)]);
  const out = [];
  for (const s of chip.stmts) {
    for (const a of s.args) {
      if (!defined.has(a)) out.push({ wire: a, line: s.line, part: s.part });
    }
  }
  for (const o of chip.outputs) {
    if (!defined.has(o)) out.push({ wire: o, line: chip.line, part: chip.name });
  }
  return out;
}

/* ----------------------------------------------------------- evaluation */

/* One combinational settle.
 *
 * `state` holds every dff's output, keyed by a path that names the instance
 * rather than the wire, so two copies of the same sub-chip do not share a bit.
 * `pending` collects what each dff will hold next. Nothing in `pending` is
 * visible during this pass, which is the two-phase discipline: every dff reads
 * pre-edge values and every dff writes post-edge values, so the order in which
 * they are evaluated cannot change the result.
 */
function evaluate(chip, inputs, library, state, pending, path = '') {
  const wires = new Map();
  chip.inputs.forEach((n, i) => wires.set(n, inputs[i] ? 1 : 0));

  const producer = new Map();
  chip.stmts.forEach(s => producer.set(s.target, s));

  const resolve = (wire, depth) => {
    if (wires.has(wire)) return wires.get(wire);
    if (depth > 5000) throw new SimError('circuit too deep to evaluate', 0);
    const s = producer.get(wire);
    if (!s) throw new SimError(`wire ${wire} has no source`, 0);
    let v;
    if (s.part === 'dff') {
      if (s.args.length !== 1) {
        throw new SimError(`dff takes 1 input, got ${s.args.length}`, s.line);
      }
      const key = path + '/' + wire;
      // Publish the stored bit before resolving what feeds it. That ordering
      // is the whole difference between a flip-flop and a wire: the feedback
      // path from this output back to this input terminates here, at last
      // cycle's value, instead of recursing forever.
      v = state && state.has(key) ? state.get(key) : 0;
      wires.set(wire, v);
      if (pending) pending.set(key, resolve(s.args[0], depth + 1));
      return v;
    } else if (s.part === 'nand') {
      const args = s.args.map(a => resolve(a, depth + 1));
      if (args.length !== 2) {
        throw new SimError(`nand takes 2 inputs, got ${args.length}`, s.line);
      }
      v = args[0] && args[1] ? 0 : 1;
    } else {
      const sub = library[s.part];
      if (!sub) throw new SimError(`unknown part ${s.part}`, s.line);
      const args = s.args.map(a => resolve(a, depth + 1));
      v = evaluate(sub, args, library, state, pending,
                   path + '/' + wire + ':' + s.part)[0];
    }
    wires.set(wire, v);
    return v;
  };

  return chip.outputs.map(o => resolve(o, 0));
}

/** Run a design for several cycles, one row of the trace per cycle.
 *
 * Returns what the outputs were on each cycle. The state carries forward; the
 * caller starts it empty, so every dff begins at 0 the way a real one does
 * after reset. */
function simulateTrace(chip, rows, library) {
  const state = new Map();
  const out = [];
  for (const inputs of rows) {
    const pending = new Map();
    out.push(evaluate(chip, inputs, library, state, pending));
    // Commit every dff at once, after the whole circuit has settled.
    for (const [k, v] of pending) state.set(k, v);
  }
  return out;
}

/** Every nand in the design, following sub-chips. This is what a gate count
 *  actually means: the primitives, not the lines you wrote. */
function countGates(chip, library, seen = new Set()) {
  let n = 0;
  for (const s of chip.stmts) {
    if (s.part === 'nand') { n += 1; continue; }
    if (s.part === 'dff') continue;      // an axiom, not a gate
    const sub = library[s.part];
    if (sub) n += countGates(sub, library, seen);
  }
  return n;
}

/** Flip-flops, counted separately. A gate budget is about combinational cost
 *  and a flop budget is about how much state a design carries, which are two
 *  different mistakes to make. */
function countFlops(chip, library) {
  let n = 0;
  for (const s of chip.stmts) {
    if (s.part === 'dff') { n += 1; continue; }
    const sub = library[s.part];
    if (sub) n += countFlops(sub, library);
  }
  return n;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;

/* ---------------------------------------------------------------- check */

/**
 * spec: {
 *   chip:    "Xor",                  the chip the exercise asks for
 *   inputs:  ["a","b"],              names are the learner's; arity is ours
 *   outputs: ["out"],
 *   table:   [[0,0,0],[0,1,1],...]   inputs then outputs, one row per case
 *   minGates: 4,                     reported, never failed on
 *   maxGates: 12,                    optional hard budget
 * }
 */
function check(src, spec) {
  let chips;
  try {
    chips = parse(src);
  } catch (e) {
    return { verdict: 'parse-error', line: e.line, message: e.message };
  }

  const library = {};
  chips.forEach(c => { library[c.name] = c; });

  const chip = library[spec.chip];
  if (!chip) {
    return {
      verdict: 'parse-error', line: 1,
      message: `no chip named ${spec.chip}. You defined: ` +
               (chips.map(c => c.name).join(', ') || 'nothing'),
    };
  }

  if (chip.inputs.length !== spec.inputs.length) {
    return {
      verdict: 'parse-error', line: chip.line,
      message: `${spec.chip} takes ${spec.inputs.length} inputs, ` +
               `yours takes ${chip.inputs.length}`,
    };
  }
  if (chip.outputs.length !== spec.outputs.length) {
    return {
      verdict: 'parse-error', line: chip.line,
      message: `${spec.chip} has ${spec.outputs.length} outputs, ` +
               `yours has ${chip.outputs.length}`,
    };
  }

  // order matters: a floating wire or a cycle makes evaluation meaningless
  for (const c of Object.values(library)) {
    const bad = checkParts(c, library);
    if (bad.length) {
      return {
        verdict: 'non-nand-part', line: bad[0].line, part: bad[0].part,
        message: `${bad[0].part} is not a part you have built. ` +
                 `The only primitive is nand.`,
      };
    }
  }

  for (const c of Object.values(library)) {
    const floating = findFloating(c);
    if (floating.length) {
      const f = floating[0];
      return {
        verdict: 'floating-input', line: f.line, wire: f.wire,
        message: `${f.wire} is never driven by anything. An unconnected wire ` +
                 `has no value; it is not 0.`,
      };
    }
  }

  for (const c of Object.values(library)) {
    const loop = findCycle(c);
    if (loop) {
      return {
        verdict: 'cycle', loop,
        message: `these wires form a loop with no clock in it: ` +
                 `${loop.join(' -> ')}. A value may depend on itself only ` +
                 `through a dff, where the dependency is on the previous ` +
                 `cycle rather than on this one.`,
      };
    }
  }

  const gatesN = countGates(chip, library);
  const flops = countFlops(chip, library);

  // A trace is a table over time: one row per cycle, evaluated in order with
  // the state carried forward. Anything with a dff in it needs one, because a
  // truth table cannot express "what it held last cycle".
  if (spec.trace) {
    const nI = spec.inputs.length;
    let got;
    try {
      got = simulateTrace(chip, spec.trace.map(r => r.slice(0, nI)), library);
    } catch (e) {
      return { verdict: 'parse-error', line: e.line || chip.line,
               message: e.message };
    }
    const cycles = [];
    let bad = null;
    spec.trace.forEach((row, i) => {
      const want = row.slice(nI);
      const ok = want.every((w, j) => (w ? 1 : 0) === got[i][j]);
      cycles.push({ cycle: i, ins: row.slice(0, nI), want, got: got[i], ok });
      if (!ok && bad === null) bad = cycles[i];
    });
    if (bad) {
      const names = spec.inputs.map((n, i) => `${n}=${bad.ins[i]}`).join(' ');
      return {
        verdict: 'table-mismatch', row: bad, rows: cycles,
        gates: gatesN, flops,
        message: `on cycle ${bad.cycle} with ${names} the specification says ` +
                 `${bad.want.join(',')} and yours gives ${bad.got.join(',')}.`,
      };
    }
    if (spec.maxGates && gatesN > spec.maxGates) {
      return { verdict: 'gate-budget', gates: gatesN, flops, rows: cycles,
               message: `correct, but ${plural(gatesN, 'nand gate')} against ` +
                        `a budget of ${spec.maxGates}.` };
    }
    return { verdict: 'ok', gates: gatesN, flops, rows: cycles,
             message: `every cycle matches, in ` +
                      `${plural(gatesN, 'nand gate')} and ` +
                      `${plural(flops, 'flip-flop')}.` };
  }

  const nIn = spec.inputs.length;
  const rows = [];
  let firstBad = null;
  for (const row of spec.table) {
    const ins = row.slice(0, nIn);
    const want = row.slice(nIn);
    let got;
    try {
      got = evaluate(chip, ins, library);
    } catch (e) {
      return { verdict: 'parse-error', line: e.line || chip.line, message: e.message };
    }
    const ok = want.every((w, i) => (w ? 1 : 0) === got[i]);
    rows.push({ ins, want, got, ok });
    if (!ok && !firstBad) firstBad = { ins, want, got };
  }

  const gates = gatesN;

  if (firstBad) {
    const names = spec.inputs.map((n, i) => `${n}=${firstBad.ins[i]}`).join(' ');
    return {
      verdict: 'table-mismatch',
      row: firstBad, rows, gates,
      message: `with ${names} the specification says ` +
               `${firstBad.want.join(',')} and yours gives ${firstBad.got.join(',')}.`,
    };
  }

  if (spec.maxGates && gates > spec.maxGates) {
    return {
      verdict: 'gate-budget', gates, rows,
      message: `correct, but ${plural(gates, 'nand gate')} against a budget ` +
               `of ${spec.maxGates}.`,
    };
  }

  return {
    verdict: 'ok', gates, rows,
    minGates: spec.minGates,
    message: spec.minGates && gates > spec.minGates
      ? `correct, in ${plural(gates, 'gate')}. ` +
        `A known solution uses ${spec.minGates}.`
      : `correct, in ${plural(gates, 'gate')}.`,
  };
}

/* Truth table for a chip, so an exercise can show what a learner built rather
 * than only whether it matched. */
function tableOf(src, chipName) {
  const chips = parse(src);
  const library = {};
  chips.forEach(c => { library[c.name] = c; });
  const chip = library[chipName];
  if (!chip) return null;
  const n = chip.inputs.length;
  const out = [];
  for (let i = 0; i < (1 << n); i++) {
    const ins = [];
    for (let b = n - 1; b >= 0; b--) ins.push((i >> b) & 1);
    out.push({ ins, outs: evaluate(chip, ins, library) });
  }
  return out;
}

const SIM = { parse, check, tableOf, countGates, countFlops,
              simulateTrace, SimError };

if (typeof module !== 'undefined' && module.exports) module.exports = SIM;
if (typeof self !== 'undefined' && typeof window === 'undefined') {
  // Worker: a learner's while(true) must not freeze the page, so the whole
  // simulator lives off the main thread.
  self.onmessage = (ev) => {
    const { id, src, spec } = ev.data;
    let result;
    try {
      result = check(src, spec);
    } catch (e) {
      result = { verdict: 'parse-error', line: 0, message: String(e && e.message || e) };
    }
    self.postMessage({ id, result });
  };
}
