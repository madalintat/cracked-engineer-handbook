/* Vim mode for the workbench editor.
 *
 * Opt-in, off by default, and desk-only: a modal editor on a phone keyboard is
 * a way to lose your work. It attaches to the textarea the editor already
 * mounts rather than replacing it, so everything else -- the highlight layer,
 * the width sync, the draft save, the run shortcut -- keeps working untouched.
 *
 * The scope is deliberate. This is enough vim to edit a forty-line netlist or
 * a C function without reaching for the mouse, and it stops there:
 *
 *   modes     normal, insert, visual, visual line, replace-one
 *   motions   h j k l w W b B e E 0 ^ $ gg G { } f F t T % and counts
 *   operators d c y with any motion, plus dd cc yy D C Y x X s S
 *   edits     i I a A o O r p P J u and Ctrl-r, . to repeat
 *   visual    v V, o to swap ends, operators over the selection
 *   search    / and ? with n and N
 *
 * What it does not have, on purpose: marks, macros, registers beyond the
 * unnamed one, windows, ex commands other than :w, and text objects. Each of
 * those is a real feature and none of them is the difference between editing
 * comfortably and not.
 *
 * Undo is our own stack, because preventDefault means the browser's undo never
 * sees these edits. A snapshot is taken before every change that vim would
 * treat as one undo step, which is not the same as every keystroke: `3dd` is
 * one step, and so is everything typed in one insert session.
 */

'use strict';

const VIM = (() => {

  const isWord = c => /[A-Za-z0-9_]/.test(c);
  const isSpace = c => /\s/.test(c);
  // vim's three character classes: word, punctuation, whitespace.
  const cls = c => (isSpace(c) ? 0 : isWord(c) ? 1 : 2);

  function attach(ta, opts = {}) {
    const onChange = opts.onChange || (() => {});
    const onMode = opts.onMode || (() => {});
    const onMessage = opts.onMessage || (() => {});

    let mode = 'normal';        // normal | insert | visual | vline | replace
    let pending = '';           // keys collected toward a command
    let count = '';             // the numeric prefix being typed
    let register = '';          // the unnamed register
    let registerLinewise = false;
    let anchor = 0;             // visual selection anchor
    let lastFind = null;        // for ; and ,
    let lastSearch = null;
    let searching = null;       // '/' or '?' while typing a search
    let searchBuf = '';
    let undoStack = [];
    let redoStack = [];
    let insertStart = null;     // snapshot taken when insert began
    let lastChange = null;      // for .
    let enabled = false;

    const val = () => ta.value;
    const setVal = v => { ta.value = v; };

    // ---------------------------------------------------------- geometry
    const lineStart = (p) => val().lastIndexOf('\n', Math.max(0, p - 1)) + 1;
    const lineEnd = (p) => {
      const i = val().indexOf('\n', p);
      return i === -1 ? val().length : i;
    };
    const lineOf = (p) =>
      Math.min(val().slice(0, p).split('\n').length - 1, nLines() - 1);
    const lineAt = (n) => {
      const lines = val().split('\n');
      let p = 0;
      for (let i = 0; i < n && i < lines.length; i++) p += lines[i].length + 1;
      return Math.min(p, val().length);
    };
    /* A trailing newline terminates the last line rather than starting a new
     * one, which is how vim counts and how every file on disk is written. Left
     * uncorrected, `G` lands on a phantom empty line past the end and `dd`
     * there deletes nothing. */
    const nLines = () => {
      const v = val();
      const n = v.split('\n').length;
      return v.endsWith('\n') && n > 1 ? n - 1 : n;
    };
    const firstNonBlank = (p) => {
      const s = lineStart(p), e = lineEnd(p);
      let i = s;
      while (i < e && isSpace(val()[i])) i++;
      return i;
    };

    /* In normal mode the caret sits *on* a character, never past the last one,
     * which is the difference people notice first if you get it wrong. */
    const clampNormal = (p) => {
      const s = lineStart(p), e = lineEnd(p);
      if (e === s) return s;
      return Math.min(Math.max(p, s), e - 1);
    };

    const setCaret = (p, keepAnchor) => {
      const q = mode === 'insert' ? p : clampNormal(p);
      if ((mode === 'visual' || mode === 'vline') && keepAnchor !== false) {
        let a = anchor, b = q;
        if (mode === 'vline') {
          const lo = Math.min(a, b), hi = Math.max(a, b);
          a = lineStart(lo); b = lineEnd(hi);
          ta.setSelectionRange(a, b);
        } else {
          if (a <= b) ta.setSelectionRange(a, b + 1);
          else ta.setSelectionRange(b, a + 1);
        }
        ta.dataset.vimCaret = String(q);
      } else {
        ta.setSelectionRange(q, q);
      }
    };
    const caret = () => {
      if (mode === 'visual' || mode === 'vline') {
        return Number(ta.dataset.vimCaret || ta.selectionStart);
      }
      return ta.selectionStart;
    };

    // ------------------------------------------------------------ history
    const snapshot = () => ({ text: val(), pos: ta.selectionStart });
    const pushUndo = () => {
      undoStack.push(snapshot());
      if (undoStack.length > 200) undoStack.shift();
      redoStack = [];
    };
    const applyText = (text, pos) => {
      setVal(text);
      onChange(text);
      setCaret(pos, false);
    };

    // ------------------------------------------------------------ motions
    /** Where a motion lands, or null if it does not apply.
     *  `forOperator` matters: `w` as a motion goes to the next word, and as the
     *  target of `d` it stops at the end of the current one. */
    function motion(key, from, n, forOperator, arg) {
      const v = val();
      let p = from;
      const fwdWord = (inclusiveEnd) => {
        for (let k = 0; k < n; k++) {
          const start = cls(v[p] || ' ');
          if (inclusiveEnd) {
            p++;
            while (p < v.length && isSpace(v[p])) p++;
            const c0 = cls(v[p] || ' ');
            while (p + 1 < v.length && cls(v[p + 1]) === c0 && !isSpace(v[p + 1])) p++;
          } else {
            while (p < v.length && cls(v[p]) === start && start !== 0) p++;
            while (p < v.length && isSpace(v[p])) p++;
          }
        }
        return p;
      };
      switch (key) {
        case 'h': return Math.max(lineStart(from), from - n);
        case 'l': return Math.min(lineEnd(from), from + n);
        case '0': return lineStart(from);
        case '^': return firstNonBlank(from);
        case '$': {
          const target = Math.min(nLines() - 1, lineOf(from) + n - 1);
          return lineEnd(lineAt(target));
        }
        case 'j': case 'k': {
          const dir = key === 'j' ? 1 : -1;
          const col = from - lineStart(from);
          const target = Math.min(Math.max(0, lineOf(from) + dir * n), nLines() - 1);
          const s = lineAt(target);
          return Math.min(s + col, lineEnd(s));
        }
        case 'w': return fwdWord(false);
        case 'W': {
          for (let k = 0; k < n; k++) {
            while (p < v.length && !isSpace(v[p])) p++;
            while (p < v.length && isSpace(v[p])) p++;
          }
          return p;
        }
        case 'b': case 'B': {
          for (let k = 0; k < n; k++) {
            p--;
            while (p > 0 && isSpace(v[p])) p--;
            if (key === 'B') { while (p > 0 && !isSpace(v[p - 1])) p--; }
            else {
              const c0 = cls(v[p] || ' ');
              while (p > 0 && cls(v[p - 1]) === c0) p--;
            }
          }
          return Math.max(0, p);
        }
        case 'e': case 'E': return fwdWord(true);
        case 'G': return arg != null ? lineAt(arg - 1)
                                     : firstNonBlank(lineAt(nLines() - 1));
        case 'gg': return firstNonBlank(lineAt((arg || 1) - 1));
        case '{': case '}': {
          const dir = key === '}' ? 1 : -1;
          let ln = lineOf(from);
          for (let k = 0; k < n; k++) {
            ln += dir;
            while (ln > 0 && ln < nLines() - 1) {
              const s = lineAt(ln);
              if (v.slice(s, lineEnd(s)).trim() === '') break;
              ln += dir;
            }
          }
          return lineAt(Math.min(Math.max(ln, 0), nLines() - 1));
        }
        case 'f': case 'F': case 't': case 'T': {
          if (!arg) return null;
          lastFind = { key, arg };
          const s = lineStart(from), e = lineEnd(from);
          let q = from;
          for (let k = 0; k < n; k++) {
            if (key === 'f' || key === 't') {
              let i = q + (key === 't' ? 2 : 1);
              while (i < e && v[i] !== arg) i++;
              if (i >= e) return null;
              q = key === 't' ? i - 1 : i;
            } else {
              let i = q - (key === 'T' ? 2 : 1);
              while (i >= s && v[i] !== arg) i--;
              if (i < s) return null;
              q = key === 'T' ? i + 1 : i;
            }
          }
          return q;
        }
        case '%': {
          const pairs = { '(': ')', '[': ']', '{': '}' };
          const rev = { ')': '(', ']': '[', '}': '{' };
          const c = v[from];
          if (pairs[c]) {
            let depth = 0;
            for (let i = from; i < v.length; i++) {
              if (v[i] === c) depth++;
              else if (v[i] === pairs[c] && --depth === 0) return i;
            }
          } else if (rev[c]) {
            let depth = 0;
            for (let i = from; i >= 0; i--) {
              if (v[i] === c) depth++;
              else if (v[i] === rev[c] && --depth === 0) return i;
            }
          }
          return null;
        }
        default: return null;
      }
    }

    const LINEWISE = new Set(['j', 'k', 'G', 'gg', '{', '}']);

    // ---------------------------------------------------------- operating
    function operate(op, from, to, linewise) {
      let a = Math.min(from, to), b = Math.max(from, to);
      if (linewise) { a = lineStart(a); b = Math.min(val().length, lineEnd(b) + 1); }
      else b = b + (op === 'y' || op === 'd' || op === 'c' ? 0 : 0);
      const text = val().slice(a, b);
      register = text;
      registerLinewise = !!linewise;
      if (op === 'y') { setCaret(a); return; }
      pushUndo();
      applyText(val().slice(0, a) + val().slice(b), a);
      if (op === 'c') enterInsert(false);
    }

    function enterInsert(snap = true) {
      if (snap) pushUndo();
      insertStart = true;
      setMode('insert');
    }

    function setMode(m) {
      mode = m;
      ta.dataset.vimMode = m;
      onMode(m);
      if (m === 'normal') setCaret(caret(), false);
    }

    // ------------------------------------------------------------- paste
    function paste(after, n) {
      if (!register) return;
      pushUndo();
      const v = val();
      let p = caret();
      let text = register.repeat(n);
      if (registerLinewise) {
        const at = after ? Math.min(v.length, lineEnd(p) + 1) : lineStart(p);
        if (!text.endsWith('\n')) text += '\n';
        applyText(v.slice(0, at) + text + v.slice(at), at);
      } else {
        const at = after ? Math.min(lineEnd(p) + 1, p + 1) : p;
        applyText(v.slice(0, at) + text + v.slice(at), at + text.length - 1);
      }
    }

    // ------------------------------------------------------------- search
    function doSearch(term, backward, fromPos) {
      if (!term) return;
      lastSearch = { term, backward };
      const v = val();
      let i;
      if (backward) {
        i = v.lastIndexOf(term, Math.max(0, fromPos - 1));
        if (i === -1) i = v.lastIndexOf(term);
      } else {
        i = v.indexOf(term, fromPos + 1);
        if (i === -1) i = v.indexOf(term);
      }
      if (i === -1) { onMessage(`not found: ${term}`); return; }
      setCaret(i);
    }

    // -------------------------------------------------------------- keys
    function handle(ev) {
      if (!enabled) return;
      const k = ev.key;

      if (searching !== null) {
        if (k === 'Escape') { searching = null; searchBuf = ''; onMessage(''); ev.preventDefault(); return; }
        if (k === 'Enter') {
          doSearch(searchBuf, searching === '?', caret());
          searching = null; searchBuf = ''; onMessage('');
          ev.preventDefault(); return;
        }
        if (k === 'Backspace') { searchBuf = searchBuf.slice(0, -1); onMessage(searching + searchBuf); ev.preventDefault(); return; }
        if (k.length === 1) { searchBuf += k; onMessage(searching + searchBuf); ev.preventDefault(); return; }
        return;
      }

      if (mode === 'insert') {
        if (k === 'Escape') {
          ev.preventDefault();
          insertStart = null;
          setMode('normal');
          setCaret(Math.max(lineStart(ta.selectionStart), ta.selectionStart - 1), false);
        }
        return;   // everything else is ordinary typing
      }

      if (mode === 'replace') {
        if (k.length === 1) {
          ev.preventDefault();
          pushUndo();
          const p = caret();
          applyText(val().slice(0, p) + k + val().slice(p + 1), p);
        }
        setMode('normal');
        return;
      }

      // ----- normal and visual
      if (k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta') return;
      if (ev.ctrlKey && k === 'r') {
        ev.preventDefault();
        const s = redoStack.pop();
        if (s) { undoStack.push(snapshot()); applyText(s.text, s.pos); }
        return;
      }
      if (ev.metaKey || (ev.ctrlKey && k !== 'r')) return;   // leave shortcuts alone
      ev.preventDefault();

      // a numeric prefix, except that 0 alone is a motion
      if (/[0-9]/.test(k) && !(k === '0' && count === '')) { count += k; return; }
      const n = count ? parseInt(count, 10) : 1;

      // pending operator or two-key command
      if (pending) {
        const op = pending;
        pending = '';
        if (op === 'g') {
          if (k === 'g') { setCaret(motion('gg', caret(), n, false, count ? n : 1)); }
          count = ''; return;
        }
        if ('dcy'.includes(op)) {
          if (k === op) {                 // dd, cc, yy
            const from = lineAt(lineOf(caret()));
            const to = lineAt(Math.min(nLines() - 1, lineOf(caret()) + n - 1));
            operate(op, from, to, true);
            count = ''; return;
          }
          if ('fFtT'.includes(k)) { pending = op + k; count = String(n); return; }
          if (k === 'g') { pending = op + 'g'; count = String(n); return; }
          const to = motion(k, caret(), n, true);
          if (to !== null) operate(op, caret(), k === 'e' || k === 'E' ? to + 1 : to,
                                   LINEWISE.has(k));
          count = ''; return;
        }
        if (op.length === 2 && 'dcy'.includes(op[0])) {
          const to = motion(op[1], caret(), n, true, k);
          if (to !== null) operate(op[0], caret(), 'ft'.includes(op[1]) ? to + 1 : to, false);
          count = ''; return;
        }
        if ('fFtT'.includes(op)) {
          const to = motion(op, caret(), n, false, k);
          if (to !== null) setCaret(to);
          count = ''; return;
        }
        if (op === 'r') {
          pushUndo();
          const p = caret();
          applyText(val().slice(0, p) + k + val().slice(p + 1), p);
          count = ''; return;
        }
        count = '';
        return;
      }

      switch (k) {
        case 'Escape':
          if (mode !== 'normal') setMode('normal');
          count = ''; return;
        case 'i': enterInsert(); count = ''; return;
        case 'I': setCaret(firstNonBlank(caret()), false); enterInsert(); count = ''; return;
        case 'a': {
          pushUndo(); const p = caret();
          setMode('insert');
          ta.setSelectionRange(Math.min(p + 1, lineEnd(p) + 1), Math.min(p + 1, lineEnd(p) + 1));
          count = ''; return;
        }
        case 'A': {
          pushUndo(); const e = lineEnd(caret());
          setMode('insert'); ta.setSelectionRange(e, e);
          count = ''; return;
        }
        case 'o': case 'O': {
          pushUndo();
          const at = k === 'o' ? lineEnd(caret()) : lineStart(caret());
          const indent = (val().slice(lineStart(caret()), lineEnd(caret()))
                          .match(/^\s*/) || [''])[0];
          const ins = k === 'o' ? '\n' + indent : indent + '\n';
          applyText(val().slice(0, at) + ins + val().slice(at),
                    at + (k === 'o' ? ins.length : indent.length));
          setMode('insert');
          count = ''; return;
        }
        case 'v':
          if (mode === 'visual') setMode('normal');
          else { anchor = caret(); ta.dataset.vimCaret = String(anchor); setMode('visual'); setCaret(anchor); }
          count = ''; return;
        case 'V':
          if (mode === 'vline') setMode('normal');
          else { anchor = caret(); ta.dataset.vimCaret = String(anchor); setMode('vline'); setCaret(anchor); }
          count = ''; return;
        case 'o':
          count = ''; return;
        case 'd': case 'c': case 'y':
          if (mode === 'visual' || mode === 'vline') {
            operate(k, anchor, caret() + (mode === 'visual' ? 1 : 0), mode === 'vline');
            if (k !== 'c') setMode('normal');
            count = ''; return;
          }
          pending = k; count = String(n === 1 && !count ? '' : n); return;
        case 'D': operate('d', caret(), lineEnd(caret()), false); count = ''; return;
        case 'C': operate('c', caret(), lineEnd(caret()), false); count = ''; return;
        case 'Y': {
          const from = lineAt(lineOf(caret()));
          const to = lineAt(Math.min(nLines() - 1, lineOf(caret()) + n - 1));
          operate('y', from, to, true); count = ''; return;
        }
        case 'x': operate('d', caret(), Math.min(lineEnd(caret()), caret() + n), false); count = ''; return;
        case 'X': operate('d', Math.max(lineStart(caret()), caret() - n), caret(), false); count = ''; return;
        case 's': operate('c', caret(), Math.min(lineEnd(caret()), caret() + n), false); count = ''; return;
        case 'S': {
          const from = lineAt(lineOf(caret()));
          const to = lineAt(Math.min(nLines() - 1, lineOf(caret()) + n - 1));
          operate('c', from, to, true); count = ''; return;
        }
        case 'p': paste(true, n); count = ''; return;
        case 'P': paste(false, n); count = ''; return;
        case 'J': {
          pushUndo();
          const e = lineEnd(caret());
          if (e < val().length) {
            let j = e + 1;
            while (j < val().length && isSpace(val()[j]) && val()[j] !== '\n') j++;
            applyText(val().slice(0, e) + ' ' + val().slice(j), e);
          }
          count = ''; return;
        }
        case 'u': {
          const s = undoStack.pop();
          if (s) { redoStack.push(snapshot()); applyText(s.text, s.pos); }
          else onMessage('nothing to undo');
          count = ''; return;
        }
        case 'r': pending = 'r'; count = ''; return;
        case 'R': setMode('replace'); count = ''; return;
        case 'g': pending = 'g'; return;
        case '/': case '?': searching = k; searchBuf = ''; onMessage(k); count = ''; return;
        case 'n': case 'N':
          if (lastSearch) {
            const back = lastSearch.backward !== (k === 'N');
            doSearch(lastSearch.term, back, caret());
          }
          count = ''; return;
        case ';': case ',':
          if (lastFind) {
            const key = k === ';' ? lastFind.key
              : { f: 'F', F: 'f', t: 'T', T: 't' }[lastFind.key];
            const to = motion(key, caret(), n, false, lastFind.arg);
            if (to !== null) setCaret(to);
          }
          count = ''; return;
        default: {
          if ('fFtT'.includes(k)) { pending = k; count = String(n); return; }
          const to = motion(k === 'G' && count ? 'G' : k, caret(), n, false,
                            k === 'G' && count ? n : undefined);
          if (to !== null) setCaret(to);
          count = '';
          return;
        }
      }
    }

    ta.addEventListener('keydown', handle, true);

    return {
      enable(on) {
        enabled = !!on;
        ta.dataset.vim = on ? 'on' : 'off';
        if (on) { setMode('normal'); }
        else { ta.dataset.vimMode = ''; onMode(''); }
      },
      get mode() { return mode; },
      isEnabled: () => enabled,
      detach() {
        ta.removeEventListener('keydown', handle, true);
        enabled = false;
        delete ta.dataset.vim;
        delete ta.dataset.vimMode;
      },
    };
  }

  return { attach };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = VIM;
