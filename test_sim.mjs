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

console.log();
if (failed.length) {
  console.log(`${failed.length} failed: ${failed.join(', ')}`);
  process.exit(1);
}
console.log(`all ${pass} passed`);
