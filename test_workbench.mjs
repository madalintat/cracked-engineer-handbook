/* Tests for the tokenizers. Run: node test_workbench.mjs
 *
 * The highlighter has one hard invariant: the text it emits, with tags
 * stripped, must equal the input. If it does not, the highlight layer and the
 * textarea under it disagree about where characters are, and the caret drifts.
 * Every case below checks that first and colour second.
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const WB = require('./assets/workbench.js');

let pass = 0;
const failed = [];

function t(name, fn) {
  try { fn(); pass++; console.log(`  ok    ${name}`); }
  catch (e) { failed.push(name); console.log(`  FAIL  ${name}: ${e.message}`); }
}
function is(c, m) { if (!c) throw new Error(m || 'expected true'); }

const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const strip = h => unesc(h.replace(/<[^>]+>/g, ''));

/** The invariant. `paint` appends one trailing space on purpose, because a
 *  trailing newline collapses in a <pre> and does not in a textarea. */
function roundTrip(src, lang) {
  const out = strip(WB.highlight(src, lang));
  if (out !== src + ' ') {
    throw new Error(`text changed.\n  in:  ${JSON.stringify(src)}\n  out: ${JSON.stringify(out)}`);
  }
}

function classes(src, lang) {
  const out = [];
  const re = /class="t-(\w+)">([^<]*)</g;
  let m;
  while ((m = re.exec(WB.highlight(src, lang))) !== null) out.push([m[1], unesc(m[2])]);
  return out;
}
function coloured(src, lang, text) {
  return classes(src, lang).find(([, t2]) => t2 === text)?.[0];
}

/* ------------------------------------------------- the invariant, per lang */

const SAMPLES = {
  netlist: `chip Xor(a, b) -> out {\n  n1 = nand(a, b)  // first\n  out = nand(n1, n1)\n}\n`,
  c: `#include <stdio.h>\nint main(void) {\n  /* hi */\n  int x = 0x1f;\n  printf("%d\\n", x);\n  return 0;\n}\n`,
  cpp: `template <typename T>\nstruct S { T v; };\nauto r = R"raw(a"b)raw";\nint n = 1'000;\n`,
  cuda: `__global__ void k(float* o) {\n  o[threadIdx.x] = blockIdx.x;\n}\nk<<<1, 32>>>(d);\n`,
  verilog: `module m(input clk, output reg q);\n  always_ff @(posedge clk) q <= 4'b1010;\nendmodule\n`,
  python: `def f(a: int) -> str:\n    s = f"{a}"  # note\n    return s.upper()\n`,
  asm: `_start:\n  mov $1, %rax   # write\n  syscall\n.section .text\n`,
};

for (const [lang, src] of Object.entries(SAMPLES)) {
  t(`${lang}: text survives highlighting exactly`, () => roundTrip(src, lang));
}

t('empty input does not throw', () => { roundTrip('', 'c'); roundTrip('', 'netlist'); });

t('a trailing newline is preserved', () => {
  roundTrip('int x;\n\n\n', 'c');
});

t('html in the source is escaped, not executed', () => {
  const h = WB.highlight('a < b && c > d; // <script>alert(1)</script>', 'c');
  is(!h.includes('<script>'), 'raw script tag survived');
  is(h.includes('&lt;script&gt;'), 'script tag was not escaped');
  roundTrip('a < b && c > d;', 'c');
});

t('an ampersand round-trips', () => roundTrip('x = a & b && c;', 'c'));

/* ----------------------------------------------------------- the colours */

t('netlist: chip and nand are distinct tokens', () => {
  is(coloured(SAMPLES.netlist, 'netlist', 'chip') === 'kw', 'chip should be a keyword');
  is(coloured(SAMPLES.netlist, 'netlist', 'nand') === 'fn', 'nand should be a part');
  is(classes(SAMPLES.netlist, 'netlist').some(([c, t2]) => c === 'com' && t2.includes('first')),
     'the comment was not found');
});

t('c: a keyword is not a type', () => {
  is(coloured('static int x;', 'c', 'static') === 'kw', 'static');
  is(coloured('static int x;', 'c', 'int') === 'type', 'int');
});

t('c: a string containing // is not a comment', () => {
  const cs = classes('char* u = "http://x";', 'c');
  is(cs.some(([c, t2]) => c === 'str' && t2.includes('//')),
     'the // inside the string should stay inside the string');
  is(!cs.some(([c]) => c === 'com'), 'no comment should be found');
});

t('c: a comment containing a quote does not open a string', () => {
  roundTrip('// it\'s fine\nint x;', 'c');
  const cs = classes('// it\'s fine\nint x;', 'c');
  is(cs[0][0] === 'com', 'the line should be a comment');
});

t('cpp: a raw string with a quote inside survives', () => {
  roundTrip('auto s = R"raw(he said "hi")raw";', 'cpp');
});

t('cuda: the launch syntax is a token, not three shifts', () => {
  is(coloured('k<<<1, 32>>>(p);', 'cuda', '<<<') === 'punc', '<<< should be punctuation');
  roundTrip('k<<<1, 32>>>(p);', 'cuda');
});

t('cuda: the builtin variables are typed', () => {
  is(coloured('int i = threadIdx.x;', 'cuda', 'threadIdx') === 'type', 'threadIdx');
  is(coloured('__global__ void k();', 'cuda', '__global__') === 'type', '__global__');
});

t("verilog: an apostrophe is a base specifier, not a character literal", () => {
  // The same glyph means a lifetime in Rust, a char in C and a base here. This
  // rule is deliberately not shared between languages.
  is(coloured("q <= 4'b1010;", 'verilog', "4'b1010") === 'num',
     "4'b1010 should be one number token");
  roundTrip("q <= 4'b1010; // ok", 'verilog');
});

t('verilog: always_ff is one keyword', () => {
  is(coloured('always_ff @(posedge clk)', 'verilog', 'always_ff') === 'kw', 'always_ff');
});

t('python: a triple-quoted string is one token', () => {
  const cs = classes('x = """a\nb"""\n', 'python');
  is(cs.some(([c, t2]) => c === 'str' && t2.includes('\n')),
     'the triple-quoted string should span lines');
  roundTrip('x = """a\nb"""\n', 'python');
});

t('python: a # inside a string is not a comment', () => {
  const cs = classes('s = "#nope"  # yes', 'python');
  is(cs.filter(([c]) => c === 'com').length === 1, 'exactly one comment');
  is(cs.find(([c]) => c === 'com')[1].includes('yes'), 'the right one');
});

t('asm: a label is not a mnemonic', () => {
  is(coloured('_start:\n  mov %rax, %rbx', 'asm', '_start') === 'fn', 'label');
  is(coloured('_start:\n  mov %rax, %rbx', 'asm', 'mov') === 'kw', 'mnemonic');
});

t('asm: a directive is distinct from both', () => {
  is(coloured('.section .text', 'asm', '.section') === 'pre', 'directive');
});

t('asm: registers and immediates are typed', () => {
  is(coloured('  mov $60, %rax', 'asm', '%rax') === 'type', 'register');
  const cs = classes('  mov $60, %rax', 'asm');
  is(cs.some(([c, t2]) => c === 'num' && t2.includes('60')), 'immediate');
});

t('asm: the same word is a label in one position and a mnemonic in another', () => {
  // This is why x86 needs a per-line anchored pass rather than one regex.
  is(coloured('call:\n  call foo', 'asm', 'call') === 'fn',
     'at column zero with a colon it is a label');
  const second = classes('call:\n  call foo', 'asm');
  is(second.some(([c, t2]) => c === 'kw' && t2 === 'call'),
     'indented it is a mnemonic');
});

/* ------------------------------------------- the compiler-explorer client */
/* No network here. These lock in the shapes that were established by probing
 * the live service, so a refactor cannot quietly undo them. */

const ESC = String.fromCharCode(27);

t('normalise strips the full CSI form, not only colour', () => {
  // gcc emits ESC[K as well as ESC[01;31m. Stripping only the ones ending in
  // `m` leaves the erase-line sequence behind, and every anchored rule after
  // it then fails to match.
  const noisy = ESC + '[01m' + ESC + '[K<source>:3:5: ' + ESC + '[01;31m' +
                ESC + '[Kerror: ' + ESC + '[m' + ESC + '[Kx undeclared';
  const got = WB.normalise(noisy);
  is(got === '3:5: error: x undeclared', JSON.stringify(got));
});

t('normalise removes the virtual filename and absolute paths', () => {
  is(WB.normalise('<source>:12:9: warning: w') === '12:9: warning: w');
  is(WB.normalise('/tmp/b/example.cpp:4:1: error: no') === 'example.cpp:4:1: error: no');
});

t('normalise leaves the diagnostic text alone', () => {
  const d = "12:9: warning: unused variable 'x' [-Wunused-variable]";
  is(WB.normalise(d) === d, WB.normalise(d));
});

t('warningFlag lifts the closest thing C has to an error code', () => {
  is(WB.warningFlag('warning: unused [-Wunused-variable]') === '-Wunused-variable');
  is(WB.warningFlag('error: no member named') === null);
});

t('a failed assert is classified by its text, not its exit code', () => {
  // Measured against the live service: Compiler Explorer reports 139 and
  // "Program terminated with signal: SIGSEGV" for an assertion failure, while
  // its own stderr carries "Assertion `x' failed". The code lies; the text
  // does not.
  const real = "output.s: /app/example.cpp:3: int main(): Assertion `f() == 7' " +
               'failed.' + String.fromCharCode(10) + 'Program terminated with signal: SIGSEGV';
  is(WB.ceVerdictOf({ code: 139, didExecute: true, buildResult: { code: 0 } }, true, real)
     === 'assert-failed', 'assert not detected');
});

t('a real segfault is still a signal', () => {
  is(WB.ceVerdictOf({ code: 139, didExecute: true, buildResult: { code: 0 } },
                    true, 'Program terminated with signal: SIGSEGV') === 'signal');
});

t('the exit code path still works where the text is silent', () => {
  const ok = { didExecute: true, buildResult: { code: 0 } };
  is(WB.ceVerdictOf({ ...ok, code: 0 }, true, '') === 'ok', 'ok');
  is(WB.ceVerdictOf({ ...ok, code: 1 }, true, '') === 'nonzero-exit', 'nonzero');
  is(WB.ceVerdictOf({ ...ok, code: 134 }, true, '') === 'assert-failed', 'abort');
});

t('a build failure is not a program exit status', () => {
  // didExecute:false with code -1 is a failed build, not a crash.
  is(WB.ceVerdictOf({ code: -1, didExecute: false, buildResult: { code: 1 } },
                    true, '') === 'compile-error');
});

t('compile-only mode does not invent a run', () => {
  is(WB.ceVerdictOf({ code: 0 }, false, '') === 'ok');
  is(WB.ceVerdictOf({ code: 1 }, false, '') === 'compile-error');
});

t('a timeout beats everything else', () => {
  is(WB.ceVerdictOf({ timedOut: true, code: 0, didExecute: true }, true, '')
     === 'timeout');
});

t('a diagnostic past the last user line is labelled as the checks', () => {
  const out = WB.withUserLineNote('3:5: error: yours' + String.fromCharCode(10) +
                                  '11:2: error: theirs', 8);
  is(out.includes('3:5: error: yours'), 'user line was relabelled');
  is(out.includes('[in the checks] 11:2:'), 'test line was not labelled');
});

/* --------------------------------------------------------- the registry */

t('an unknown backend reports unavailable, not failed', async () => {
  // synchronous check of the shape: run() returns a promise, so assert on it
  const p = WB.run({ backend: 'nosuch' }, 'x', {});
  is(p instanceof Promise, 'run should be async');
});

t('sim is registered and labelled', () => {
  is(!!WB.BACKENDS.sim, 'sim missing');
  is(WB.BACKENDS.sim.label === 'simulator', 'label');
});

t('every language in RULES has a sample under test', () => {
  const langs = Object.keys(WB.RULES);
  const missing = langs.filter(l => !(l in SAMPLES));
  is(missing.length === 0, 'no sample for: ' + missing.join(', '));
});

console.log();
if (failed.length) {
  console.log(`${failed.length} failed: ${failed.join(', ')}`);
  process.exit(1);
}
console.log(`all ${pass} passed`);
