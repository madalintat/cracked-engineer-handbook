/* Vim mode, tested against a stub textarea.
 *
 * No browser: the module only needs `value`, `selectionStart/End`,
 * `setSelectionRange`, `dataset` and `addEventListener`, so a small object
 * supplies all five and the tests drive real key events through the real
 * handler. A test that reimplements the logic it is testing proves nothing,
 * so nothing here reimplements a motion.
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const VIM = require('./assets/vim.js');

let pass = 0;
const failed = [];
const t = (name, fn) => {
  try { fn(); console.log(`  ok    ${name}`); pass++; }
  catch (e) { failed.push(name); console.log(`  FAIL  ${name}: ${e.message}`); }
};
const is = (c, m) => { if (!c) throw new Error(m || 'expected true'); };
const eq = (a, b, m) => {
  if (a !== b) throw new Error(`${m || ''} got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
};

function editor(text) {
  const listeners = [];
  const ta = {
    value: text,
    selectionStart: 0,
    selectionEnd: 0,
    dataset: {},
    setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; },
    addEventListener(_, fn) { listeners.push(fn); },
    removeEventListener(_, fn) { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
  };
  const vim = VIM.attach(ta, { onChange: () => {} });
  vim.enable(true);
  const key = (k, mods = {}) => {
    const ev = {
      key: k, ctrlKey: !!mods.ctrl, metaKey: !!mods.meta,
      altKey: !!mods.alt, shiftKey: !!mods.shift,
      preventDefault() { this.defaultPrevented = true; },
    };
    listeners.forEach(fn => fn(ev));
    return ev;
  };
  const type = (s) => { for (const c of s) key(c); };
  return { ta, vim, key, type, text: () => ta.value, pos: () => ta.selectionStart };
}

console.log('vim mode');

t('starts in normal mode and does not type', () => {
  const e = editor('hello\n');
  eq(e.ta.dataset.vimMode, 'normal');
  const ev = e.key('i');
  is(ev.defaultPrevented, 'normal mode must consume the key');
  eq(e.text(), 'hello\n', 'i must not insert an i:');
  eq(e.ta.dataset.vimMode, 'insert');
});

t('insert mode leaves typing to the browser', () => {
  const e = editor('hello\n');
  e.key('i');
  const ev = e.key('x');
  is(!ev.defaultPrevented, 'insert mode must not consume ordinary keys');
});

t('escape returns to normal and steps left', () => {
  const e = editor('hello\n');
  e.ta.setSelectionRange(3, 3);
  e.key('i'); e.key('Escape');
  eq(e.ta.dataset.vimMode, 'normal');
  eq(e.pos(), 2, 'the caret should step back onto a character:');
});

t('word motions', () => {
  const e = editor('alpha beta gamma\n');
  e.key('w'); eq(e.pos(), 6, 'w:');
  e.key('w'); eq(e.pos(), 11, 'w again:');
  e.key('b'); eq(e.pos(), 6, 'b:');
  e.key('e'); eq(e.pos(), 9, 'e:');
  e.key('0'); eq(e.pos(), 0, '0:');
  e.key('$'); eq(e.pos(), 15, '$:');
});

t('counts apply to motions', () => {
  const e = editor('alpha beta gamma\n');
  e.key('2'); e.key('w');
  eq(e.pos(), 11, '2w:');
});

t('dw deletes to the next word', () => {
  const e = editor('alpha beta gamma\n');
  e.key('d'); e.key('w');
  eq(e.text(), 'beta gamma\n');
});

t('dd deletes a line and 2dd deletes two', () => {
  const one = editor('a\nb\nc\n');
  one.key('d'); one.key('d');
  eq(one.text(), 'b\nc\n');
  const two = editor('a\nb\nc\n');
  two.key('2'); two.key('d'); two.key('d');
  eq(two.text(), 'c\n');
});

t('a trailing newline does not make an extra line', () => {
  // Vim treats it as terminating the last line. Counting it as a line puts G
  // on a phantom empty row where dd deletes nothing.
  const e = editor('a\nb\nc\n');
  e.key('G');
  eq(e.pos(), 4, 'G should land on the last real line:');
  e.key('d'); e.key('d');
  eq(e.text(), 'a\nb\n');
});

t('yy and p round-trip a line', () => {
  const e = editor('a\nb\n');
  e.key('y'); e.key('y'); e.key('p');
  eq(e.text(), 'a\na\nb\n');
});

t('x deletes forward and never past the end of the line', () => {
  const e = editor('ab\ncd\n');
  e.key('$'); e.key('x');
  eq(e.text(), 'a\ncd\n');
  e.key('x');
  eq(e.text(), '\ncd\n', 'x on the last character of a line:');
});

t('f and t land in the right places', () => {
  const f = editor('alpha beta\n');
  f.key('f'); f.key('b');
  eq(f.pos(), 6, 'f b:');
  const tt = editor('alpha beta\n');
  tt.key('t'); tt.key('b');
  eq(tt.pos(), 5, 't b:');
});

t('an operator takes a find as its motion', () => {
  const e = editor('alpha beta\n');
  e.key('d'); e.key('f'); e.key('a');
  eq(e.text(), ' beta\n', 'dfa should delete through the first a:');
});

t('visual selects and deletes', () => {
  const e = editor('abcdef\n');
  e.key('v'); e.key('l'); e.key('l'); e.key('d');
  eq(e.text(), 'def\n');
});

t('visual line takes whole lines', () => {
  const e = editor('a\nb\nc\n');
  e.key('V'); e.key('j'); e.key('d');
  eq(e.text(), 'c\n');
});

t('undo and redo', () => {
  const e = editor('a\nb\n');
  e.key('d'); e.key('d');
  eq(e.text(), 'b\n');
  e.key('u');
  eq(e.text(), 'a\nb\n', 'undo:');
  e.key('r', { ctrl: true });
  eq(e.text(), 'b\n', 'redo:');
});

t('one undo step covers a counted delete', () => {
  const e = editor('a\nb\nc\nd\n');
  e.key('3'); e.key('d'); e.key('d');
  eq(e.text(), 'd\n');
  e.key('u');
  eq(e.text(), 'a\nb\nc\nd\n', '3dd must undo in one step:');
});

t('r replaces one character and stays in normal mode', () => {
  const e = editor('abc\n');
  e.key('r'); e.key('Z');
  eq(e.text(), 'Zbc\n');
  eq(e.ta.dataset.vimMode, 'normal');
});

t('J joins the next line', () => {
  const e = editor('one\n   two\n');
  e.key('J');
  eq(e.text(), 'one two\n');
});

t('search moves the caret and n repeats it', () => {
  const e = editor('alpha\nbeta\nalpha\n');
  e.key('/'); e.type('alpha'); e.key('Enter');
  eq(e.pos(), 11, '/alpha from 0 should find the second one:');
  e.key('n');
  eq(e.pos(), 0, 'n should wrap to the first:');
});

t('o opens a line below and keeps the indent', () => {
  const e = editor('  hello\n');
  e.key('o');
  eq(e.text(), '  hello\n  \n');
  eq(e.ta.dataset.vimMode, 'insert');
});

t('browser shortcuts are left alone', () => {
  const e = editor('abc\n');
  const ev = e.key('Enter', { ctrl: true });
  is(!ev.defaultPrevented, 'ctrl-enter is the run shortcut and must pass through');
  const meta = e.key('c', { meta: true });
  is(!meta.defaultPrevented, 'cmd-c must pass through');
});

t('disabling it hands the keyboard back', () => {
  const e = editor('abc\n');
  e.vim.enable(false);
  const ev = e.key('d');
  is(!ev.defaultPrevented, 'a disabled vim must consume nothing');
  eq(e.text(), 'abc\n');
});

process.on('exit', () => {
  console.log();
  if (failed.length) {
    console.log(`${failed.length} failed: ${failed.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log(`all ${pass} passed`);
  }
});
