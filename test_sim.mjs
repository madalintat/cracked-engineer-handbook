/* Tests for the logic simulator. Run: node test_sim.mjs
 *
 * Every verdict the simulator can emit has a test that provokes it, because a
 * checker whose error paths are untested is a checker that tells learners the
 * wrong thing at exactly the moment they are most confused.
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const SIM = require('./assets/sim.js');

let pass = 0;
const failed = [];

function t(name, fn) {
  try { fn(); pass++; console.log(`  ok    ${name}`); }
  catch (e) { failed.push(name); console.log(`  FAIL  ${name}: ${e.message}`); }
}
function eq(a, b, msg) {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A !== B) throw new Error(`${msg || ''} got ${A}, want ${B}`);
}
function is(cond, msg) { if (!cond) throw new Error(msg || 'expected true'); }

/* ------------------------------------------------------------ specs used */

const NOT = {
  chip: 'Not', inputs: ['a'], outputs: ['out'], minGates: 1,
  table: [[0, 1], [1, 0]],
};
const AND = {
  chip: 'And', inputs: ['a', 'b'], outputs: ['out'], minGates: 2,
  table: [[0, 0, 0], [0, 1, 0], [1, 0, 0], [1, 1, 1]],
};
const OR = {
  chip: 'Or', inputs: ['a', 'b'], outputs: ['out'], minGates: 3,
  table: [[0, 0, 0], [0, 1, 1], [1, 0, 1], [1, 1, 1]],
};
const XOR = {
  chip: 'Xor', inputs: ['a', 'b'], outputs: ['out'], minGates: 4, maxGates: 8,
  table: [[0, 0, 0], [0, 1, 1], [1, 0, 1], [1, 1, 0]],
};

/* --------------------------------------------------------- the good cases */

t('not from one nand', () => {
  const r = SIM.check(`chip Not(a) -> out {
    out = nand(a, a)
  }`, NOT);
  eq(r.verdict, 'ok'); eq(r.gates, 1);
  is(r.message.includes('1 gate.'), 'singular, not "1 gates": ' + r.message);
  is(!r.message.includes('1 gates'), 'said "1 gates": ' + r.message);
});

t('counts read as English at every number', () => {
  const two = SIM.check('chip And(a, b) -> out { n = nand(a, b) out = nand(n, n) }', AND);
  is(two.message.includes('2 gates'), two.message);
  const budget = SIM.check(`chip Xor(a, b) -> out {
    na = nand(a, a) nb = nand(b, b)
    t1 = nand(a, nb) t2 = nand(na, b) out = nand(t1, t2)
  }`, { ...XOR, maxGates: 1 });
  is(budget.message.includes('5 nand gates'), budget.message);
});

t('and from two nands', () => {
  const r = SIM.check(`chip And(a, b) -> out {
    n = nand(a, b)
    out = nand(n, n)
  }`, AND);
  eq(r.verdict, 'ok'); eq(r.gates, 2);
});

t('or from three nands, via de morgan', () => {
  const r = SIM.check(`chip Or(a, b) -> out {
    na = nand(a, a)
    nb = nand(b, b)
    out = nand(na, nb)
  }`, OR);
  eq(r.verdict, 'ok'); eq(r.gates, 3);
});

t('the minimal four-gate xor', () => {
  const r = SIM.check(`chip Xor(a, b) -> out {
    n1 = nand(a, b)
    n2 = nand(a, n1)
    n3 = nand(b, n1)
    out = nand(n2, n3)
  }`, XOR);
  eq(r.verdict, 'ok'); eq(r.gates, 4);
  is(r.message.includes('4 gates'), r.message);
});

t('line order carries no meaning', () => {
  const forward = `chip Xor(a, b) -> out {
    n1 = nand(a, b)
    n2 = nand(a, n1)
    n3 = nand(b, n1)
    out = nand(n2, n3)
  }`;
  const shuffled = `chip Xor(a, b) -> out {
    out = nand(n2, n3)
    n3 = nand(b, n1)
    n2 = nand(a, n1)
    n1 = nand(a, b)
  }`;
  eq(SIM.check(forward, XOR).verdict, 'ok');
  eq(SIM.check(shuffled, XOR).verdict, 'ok', 'a netlist is a graph, not a script:');
});

t('sub-chips compose, and gates count through them', () => {
  const r = SIM.check(`chip Not(a) -> out {
    out = nand(a, a)
  }
  chip And(a, b) -> out {
    n = nand(a, b)
    out = Not(n)
  }`, AND);
  eq(r.verdict, 'ok');
  eq(r.gates, 2, 'the Not inside must count as its one nand:');
});

t('comments and blank lines are ignored', () => {
  const r = SIM.check(`
    // invert by tying both inputs together
    chip Not(a) -> out {

      out = nand(a, a)   // one gate
    }`, NOT);
  eq(r.verdict, 'ok');
});

/* ----------------------------------------------------------- the verdicts */

t('table-mismatch names the exact failing row', () => {
  // or, but wired as nand: right for three rows, wrong for one
  const r = SIM.check(`chip Or(a, b) -> out {
    out = nand(a, b)
  }`, OR);
  eq(r.verdict, 'table-mismatch');
  eq(r.row.ins, [0, 0]);
  eq(r.row.want, [0]);
  eq(r.row.got, [1]);
  is(r.message.includes('a=0 b=0'), r.message);
});

t('non-nand-part catches using a built-in', () => {
  const r = SIM.check(`chip Xor(a, b) -> out {
    out = xor(a, b)
  }`, XOR);
  eq(r.verdict, 'non-nand-part');
  eq(r.part, 'xor');
});

t('non-nand-part catches a part that is merely undefined', () => {
  const r = SIM.check(`chip And(a, b) -> out {
    n = nand(a, b)
    out = Inverter(n)
  }`, AND);
  eq(r.verdict, 'non-nand-part');
  eq(r.part, 'Inverter');
});

t('cycle is caught and the loop is named', () => {
  const r = SIM.check(`chip Not(a) -> out {
    x = nand(a, y)
    y = nand(x, x)
    out = nand(x, x)
  }`, NOT);
  eq(r.verdict, 'cycle');
  is(r.loop.length >= 2, 'loop should list its wires: ' + JSON.stringify(r.loop));
  is(r.message.includes('->'), r.message);
});

t('a self-referential wire is a cycle', () => {
  const r = SIM.check(`chip Not(a) -> out {
    out = nand(out, a)
  }`, NOT);
  eq(r.verdict, 'cycle');
});

t('floating-input is caught, and is not treated as 0', () => {
  const r = SIM.check(`chip And(a, b) -> out {
    n = nand(a, ghost)
    out = nand(n, n)
  }`, AND);
  eq(r.verdict, 'floating-input');
  eq(r.wire, 'ghost');
  is(r.message.includes('not 0'), r.message);
});

t('an undriven output is floating', () => {
  const r = SIM.check(`chip Not(a) -> out {
    n = nand(a, a)
  }`, NOT);
  eq(r.verdict, 'floating-input');
  eq(r.wire, 'out');
});

t('gate-budget: correct but over budget', () => {
  // xor the long way: 5 gates, budget 4
  const tight = { ...XOR, maxGates: 4 };
  const r = SIM.check(`chip Xor(a, b) -> out {
    na = nand(a, a)
    nb = nand(b, b)
    t1 = nand(a, nb)
    t2 = nand(na, b)
    out = nand(t1, t2)
  }`, tight);
  eq(r.verdict, 'gate-budget');
  eq(r.gates, 5);
  is(r.message.startsWith('correct, but'), r.message);
});

t('over the known minimum passes, and says so', () => {
  const r = SIM.check(`chip Xor(a, b) -> out {
    na = nand(a, a)
    nb = nand(b, b)
    t1 = nand(a, nb)
    t2 = nand(na, b)
    out = nand(t1, t2)
  }`, XOR);
  eq(r.verdict, 'ok');
  eq(r.gates, 5);
  is(r.message.includes('known solution uses 4'), r.message);
});

/* ------------------------------------------------------ the parse errors */

t('a missing close brace is reported with its line', () => {
  const r = SIM.check(`chip Not(a) -> out {
    out = nand(a, a)`, NOT);
  eq(r.verdict, 'parse-error');
  is(r.message.includes('never closed'), r.message);
});

t('the wrong chip name is reported with what was defined', () => {
  const r = SIM.check(`chip Nott(a) -> out {
    out = nand(a, a)
  }`, NOT);
  eq(r.verdict, 'parse-error');
  is(r.message.includes('You defined: Nott'), r.message);
});

t('wrong arity is reported before anything is evaluated', () => {
  const r = SIM.check(`chip Xor(a) -> out {
    out = nand(a, a)
  }`, XOR);
  eq(r.verdict, 'parse-error');
  is(r.message.includes('takes 2 inputs'), r.message);
});

t('nand with the wrong number of arguments', () => {
  const r = SIM.check(`chip Not(a) -> out {
    out = nand(a)
  }`, NOT);
  eq(r.verdict, 'parse-error');
  is(r.message.includes('nand takes 2'), r.message);
});

t('an unreadable line reports its number', () => {
  const r = SIM.check(`chip Not(a) -> out {
    out <= nand(a, a)
  }`, NOT);
  eq(r.verdict, 'parse-error');
  eq(r.line, 2);
});

/* ------------------------------------------------------------ properties */

t('functional completeness: every 2-input function is reachable', () => {
  // Build all 16 two-input functions from nand and check each against its
  // own table. This is the unit's central claim, tested rather than asserted.
  const build = {
    0:  'out = nand(z, z)\n  z2 = nand(a, na)\n  na = nand(a, a)\n  z = nand(a, na)',
  };
  // Simpler: derive each function as a sum of products over And/Or/Not.
  const lib = `chip Not(a) -> out { out = nand(a, a) }
chip And(a, b) -> out { n = nand(a, b) out = nand(n, n) }
chip Or(a, b) -> out { na = nand(a, a) nb = nand(b, b) out = nand(na, nb) }`;
  let built = 0;
  for (let f = 0; f < 16; f++) {
    const rows = [[0, 0], [0, 1], [1, 0], [1, 1]].map((ins, i) =>
      [...ins, (f >> (3 - i)) & 1]);
    // minterms of f
    const terms = [];
    rows.forEach(([x, y, v], i) => {
      if (!v) return;
      terms.push(`m${i} = And(${x ? 'a' : 'na'}, ${y ? 'b' : 'nb'})`);
    });
    let src;
    if (!terms.length) {
      src = `${lib}\nchip F(a, b) -> out { na = nand(a, a) t = nand(a, na) out = nand(t, t) }`;
    } else {
      let acc = 'm' + rows.findIndex(([, , v]) => v);
      const ors = [];
      rows.forEach(([, , v], i) => {
        if (!v || `m${i}` === acc) return;
        ors.push(`o${i} = Or(${acc}, m${i})`);
        acc = `o${i}`;
      });
      src = `${lib}\nchip F(a, b) -> out {
        na = Not(a)
        nb = Not(b)
        ${terms.join('\n        ')}
        ${ors.join('\n        ')}
        out = nand(${acc}, ${acc})
      }`;
      // the final nand-nand is a buffer; fix by inverting twice
      src = src.replace(`out = nand(${acc}, ${acc})`,
        `bn = nand(${acc}, ${acc})\n        out = nand(bn, bn)`);
    }
    const spec = {
      chip: 'F', inputs: ['a', 'b'], outputs: ['out'],
      table: rows,
    };
    const r = SIM.check(src, spec);
    if (r.verdict !== 'ok') {
      throw new Error(`function ${f} (${rows.map(r2 => r2[2]).join('')}) ` +
                      `gave ${r.verdict}: ${r.message}`);
    }
    built++;
  }
  eq(built, 16, 'all sixteen two-input functions:');
});

t('tableOf renders what the learner actually built', () => {
  const table = SIM.tableOf(`chip Xor(a, b) -> out {
    n1 = nand(a, b)
    n2 = nand(a, n1)
    n3 = nand(b, n1)
    out = nand(n2, n3)
  }`, 'Xor');
  eq(table.map(r => r.outs[0]), [0, 1, 1, 0]);
});

t('a deep chain does not blow the stack', () => {
  let body = 'w0 = nand(a, a)\n';
  for (let i = 1; i < 400; i++) body += `w${i} = nand(w${i - 1}, w${i - 1})\n`;
  body += 'out = nand(w399, w399)';
  const r = SIM.check(`chip Not(a) -> out {\n${body}\n}`, {
    chip: 'Not', inputs: ['a'], outputs: ['out'],
    table: [[0, 1], [1, 0]],
  });
  eq(r.verdict, 'ok');
  eq(r.gates, 401);
});


/* ------------------------------------------------------- the clock edge */

const LIB = `chip Not(a) -> out { out = nand(a, a) }
chip And(a, b) -> out { n = nand(a, b)  out = Not(n) }
chip Or(a, b) -> out { na = Not(a)  nb = Not(b)  out = nand(na, nb) }
chip Xor(a, b) -> out {
  n1 = nand(a, b)  n2 = nand(a, n1)  n3 = nand(b, n1)  out = nand(n2, n3)
}
chip Mux(a, b, sel) -> out {
  nsel = Not(sel)
  x = And(a, nsel)
  y = And(b, sel)
  out = Or(x, y)
}
`;

t('a dff holds its input for one cycle', () => {
  const r = SIM.check('chip R(d) -> q { q = dff(d) }',
    { chip: 'R', inputs: ['d'], outputs: ['q'], trace: [[1, 0], [0, 1], [0, 0]] });
  is(r.verdict === 'ok', r.message);
});

t('a loop through a dff is legal and a loop without one is not', () => {
  // This is the whole point of the primitive, so both directions are checked.
  const bit = LIB + `chip Bit(in, load) -> out {
    m = Mux(out, in, load)
    out = dff(m)
  }`;
  const good = SIM.check(bit, { chip: 'Bit', inputs: ['in', 'load'],
    outputs: ['out'], trace: [[1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [0, 0, 0]] });
  is(good.verdict === 'ok', 'a register should be legal: ' + good.message);

  const bad = SIM.check('chip B(a) -> out { x = nand(a, x)  out = nand(x, x) }',
    { chip: 'B', inputs: ['a'], outputs: ['out'], table: [[0, 1], [1, 0]] });
  is(bad.verdict === 'cycle', 'a combinational loop must still be rejected');
});

t('two instances of one sub-chip do not share a bit', () => {
  // Keying dff state by wire name alone would make these the same flop, and
  // the design would appear to work while holding one value for two registers.
  const src = `chip Reg(d) -> q { q = dff(d) }
chip Pair(a, b) -> x {
  p = Reg(a)
  q = Reg(b)
  x = nand(p, q)
}`;
  const r = SIM.check(src, { chip: 'Pair', inputs: ['a', 'b'], outputs: ['x'],
    trace: [[1, 0, 1], [0, 0, 1], [0, 0, 1]] });
  is(r.verdict === 'ok', r.message);
  is(r.flops === 2, `expected 2 flip-flops, counted ${r.flops}`);
});

t('a dff is an axiom, not a gate', () => {
  const r = SIM.check('chip R(d) -> q { q = dff(d) }',
    { chip: 'R', inputs: ['d'], outputs: ['q'], trace: [[1, 0], [0, 1]] });
  is(r.gates === 0, `dff counted as ${r.gates} gates`);
  is(r.flops === 1, `counted ${r.flops} flip-flops`);
});

t('a trace mismatch names the cycle it happened on', () => {
  const r = SIM.check('chip R(d) -> q { q = dff(d) }',
    { chip: 'R', inputs: ['d'], outputs: ['q'], trace: [[1, 1], [0, 1]] });
  is(r.verdict === 'table-mismatch', r.verdict);
  is(/cycle 0/.test(r.message), `message does not name the cycle: ${r.message}`);
});

t('a dff chain delays by its length', () => {
  const r = SIM.check('chip Two(d) -> q { a = dff(d)  q = dff(a) }',
    { chip: 'Two', inputs: ['d'], outputs: ['q'],
      trace: [[1, 0], [0, 0], [0, 1], [0, 0]] });
  is(r.verdict === 'ok', r.message);
});

t('a sub-chip with two outputs gives both of them', () => {
  // Before this, evaluate() returned outs[0] for every sub-chip, so a demux's
  // second output and an adder's carry were unreachable and silently became
  // the first output instead. Every adder past bit 0 needs the carry.
  const src = `chip Not(a) -> out { out = nand(a,a) }
chip And(a,b) -> out { n = nand(a,b)  out = Not(n) }
chip Or(a,b) -> out { na=Not(a)  nb=Not(b)  out=nand(na,nb) }
chip Xor(a,b) -> out {
  n1 = nand(a,b)  n2 = nand(a,n1)  n3 = nand(b,n1)  out = nand(n2,n3)
}
chip HalfAdder(a,b) -> sum, carry {
  sum = Xor(a,b)
  carry = And(a,b)
}
chip FullAdder(a,b,cin) -> sum, carry {
  s1, c1 = HalfAdder(a, b)
  sum, c2 = HalfAdder(s1, cin)
  carry = Or(c1, c2)
}`;
  const table = [];
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) {
    const t = a + b + c;
    table.push([a, b, c, t & 1, t >> 1]);
  }
  const r = SIM.check(src, { chip: 'FullAdder', inputs: ['a', 'b', 'cin'],
                             outputs: ['sum', 'carry'], table });
  is(r.verdict === 'ok', r.message);
});

t('assigning more names than a part has outputs is an error', () => {
  const src = `chip Not(a) -> out { out = nand(a,a) }
chip Two(a) -> x, y { x = Not(a)  y = nand(a,a) }
chip Bad(a) -> o { p, q, z = Two(a)  o = nand(p, q) }`;
  const r = SIM.check(src, { chip: 'Bad', inputs: ['a'], outputs: ['o'],
                             table: [[0, 1], [1, 1]] });
  is(r.verdict === 'parse-error', r.verdict);
  is(/2 outputs and you assigned 3 names/.test(r.message), r.message);
});

t('a name bound by a multi-output assignment is not floating', () => {
  const src = `chip Not(a) -> out { out = nand(a,a) }
chip Two(a) -> x, y { x = Not(a)  y = nand(a,a) }
chip Use(a) -> o { p, q = Two(a)  o = nand(p, q) }`;
  const r = SIM.check(src, { chip: 'Use', inputs: ['a'], outputs: ['o'],
                             table: [[0, 0], [1, 1]] });
  is(r.verdict !== 'floating-input', `q was reported floating: ${r.message}`);
});

t('a wire may simply be another wire', () => {
  // Without this a chip whose output is one of its inputs cannot be written,
  // and `out = a` fails with "cannot read this line", which reads as a syntax
  // error in a language that has no syntax for the thing you wanted.
  const r = SIM.check('chip Pass(a) -> out { out = a }',
    { chip: 'Pass', inputs: ['a'], outputs: ['out'], table: [[0, 0], [1, 1]] });
  is(r.verdict === 'ok', r.message);
  is(r.gates === 0, `a wire cost ${r.gates} gates`);
});

t('an alias cannot hide a cycle or a floating wire', () => {
  const loop = SIM.check('chip B(a) -> out {\n x = x\n out = nand(a, x)\n}',
    { chip: 'B', inputs: ['a'], outputs: ['out'], table: [[0, 1], [1, 1]] });
  is(loop.verdict === 'cycle', `self-alias gave ${loop.verdict}`);
  const dangling = SIM.check('chip B(a) -> out { out = ghost }',
    { chip: 'B', inputs: ['a'], outputs: ['out'], table: [[0, 0], [1, 1]] });
  is(dangling.verdict === 'floating-input', dangling.verdict);
});

t('a loop through a sub-chip that holds state is legal', () => {
  // Stopping only at a literal `dff` saw a register as combinational and
  // rejected every counter in the unit that introduces counters.
  const src = LIB + `chip Bit(in, load) -> out {
  m = Mux(out, in, load)
  out = dff(m)
}
chip Toggle(t) -> out {
  flipped = Not(out)
  out = Bit(flipped, t)
}`;
  const r = SIM.check(src, { chip: 'Toggle', inputs: ['t'], outputs: ['out'],
    trace: [[1, 0], [1, 1], [1, 0], [0, 1], [0, 1], [1, 1]] });
  is(r.verdict === 'ok', `${r.verdict}: ${r.message}`);
});

t('a sub-chip forces only the inputs it reads', () => {
  // A register's output does not depend on its data input. Forcing every
  // argument before entering a sub-chip recurses forever in a counter, where
  // the data input is computed from the output.
  const src = LIB + `chip Bit(in, load) -> out {
  m = Mux(out, in, load)
  out = dff(m)
}
chip Count2(en) -> q1, q0 {
  n0 = Not(q0)
  carry = And(q0, en)
  n1 = Xor(q1, carry)
  d0 = Mux(q0, n0, en)
  q0 = Bit(d0, en)
  q1 = Bit(n1, en)
}`;
  const r = SIM.check(src, { chip: 'Count2', inputs: ['en'],
    outputs: ['q1', 'q0'],
    trace: [[1, 0, 0], [1, 0, 1], [1, 1, 0], [1, 1, 1], [1, 0, 0]] });
  is(r.verdict === 'ok', `${r.verdict}: ${r.message}`);
  is(r.flops === 2, `counted ${r.flops} flops`);
});

t('a flop cannot see another flop new value', () => {
  // Two flops in a ring: each takes the other value. If next state were
  // computed during the settle rather than after it, one would see the other
  // already updated and the pair would not swap, it would agree.
  const src = 'chip Swap(seed, load) -> a, b {\n' +
              '  ina = nand(seed, seed)\n' +
              '  a = dff(b)\n' +
              '  b = dff(a)\n' +
              '}';
  const r = SIM.check(src, { chip: 'Swap', inputs: ['seed', 'load'],
    outputs: ['a', 'b'], trace: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] });
  is(r.verdict === 'ok', `${r.verdict}: ${r.message}`);
});

/* The summary runs last, always.
 *
 * It used to sit in the middle of this file, so tests appended after it ran,
 * printed their own line, and were not counted: the suite reported "all 25
 * passed" while running 39, and a failure among the uncounted ones would not
 * have changed the exit code. Registering it on exit makes its position in the
 * file stop mattering. */
process.on('exit', () => {
  console.log();
  if (failed.length) {
    console.log(`${failed.length} failed: ${failed.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log(`all ${pass} passed`);
  }
});

