/* The workbench: the editor, the tokenizers, and the backend registry.
 *
 * One interface, several implementations. A backend takes a source string and
 * an exercise, and returns a normalised result the view renders without
 * knowing which tool produced it:
 *
 *   { verdicts: [ { who, state, title, detail?, code? } ],
 *     pass: bool,
 *     signals: [ { judge:'verdict'|'match'|'silent', key } ] }
 *
 * `signals` is what @expect and @diagnose match against. Structured keys come
 * first and a regex over text is the fallback, because every backend exposes
 * some stable key even when it has no error codes.
 *
 * Three states are distinct and must stay distinct:
 *   failed        the tool ran and said no
 *   unavailable   the tool could not run at all
 *   running       the tool has not answered yet
 * Collapsing `unavailable` into `failed` tells a learner their answer is wrong
 * when the truth is that nothing looked at it.
 */

'use strict';

const WB = (() => {

  /* ------------------------------------------------------------ tokenizers */

  /* A token span may only set colour. Anything that changes glyph advance
   * separates the highlight layer from the textarea underneath it. */

  const esc = s => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function paint(src, rules) {
    // One pass, one regex, one capture group per rule. Alternation order is
    // the correctness argument: earlier rules win.
    const re = new RegExp(rules.map(r => `(${r.re})`).join('|'), 'gm');
    let out = '', last = 0, m;
    while ((m = re.exec(src)) !== null) {
      if (m.index > last) out += esc(src.slice(last, m.index));
      const i = m.slice(1).findIndex(g => g !== undefined);
      out += `<span class="t-${rules[i].cls}">${esc(m[0])}</span>`;
      last = m.index + m[0].length;
      if (m[0].length === 0) re.lastIndex++;
    }
    out += esc(src.slice(last));
    // A trailing newline collapses in a <pre> but not in a textarea, which
    // shifts every line by one once the learner presses enter at the end.
    return out + ' ';
  }

  const RULES = {
    netlist: [
      { cls: 'com', re: '//[^\\n]*' },
      { cls: 'kw', re: '\\bchip\\b' },
      { cls: 'fn', re: '\\bnand\\b' },
      { cls: 'type', re: '\\b[A-Z]\\w*(?=\\s*\\()' },
      { cls: 'punc', re: '->|[(){},=]' },
      { cls: 'num', re: '\\b\\d+\\b' },
    ],
    c: [
      { cls: 'com', re: '//[^\\n]*|/\\*[\\s\\S]*?\\*/' },
      { cls: 'pre', re: '^[ \\t]*#[a-z]+' },
      { cls: 'str', re: '"(?:[^"\\\\\\n]|\\\\.)*"|\'(?:[^\'\\\\\\n]|\\\\.)*\'' },
      { cls: 'kw', re: '\\b(?:auto|break|case|const|continue|default|do|else|enum|extern|for|goto|if|inline|register|restrict|return|sizeof|static|struct|switch|typedef|union|volatile|while|_Atomic|_Bool)\\b' },
      { cls: 'type', re: '\\b(?:void|char|short|int|long|float|double|signed|unsigned|size_t|ptrdiff_t|u?int(?:8|16|32|64)_t|bool)\\b' },
      { cls: 'num', re: '\\b(?:0[xX][0-9a-fA-F]+|0[bB][01]+|\\d+\\.?\\d*(?:[eE][-+]?\\d+)?)[uUlLfF]*\\b' },
      { cls: 'fn', re: '\\b[A-Za-z_]\\w*(?=\\s*\\()' },
      { cls: 'punc', re: '[-+*/%=<>!&|^~?:;,.\\[\\](){}]' },
    ],
    cpp: null,   // built below: c plus a few keywords
    cuda: null,  // built below: cpp plus the launch and qualifier syntax
    verilog: [
      { cls: 'com', re: '//[^\\n]*|/\\*[\\s\\S]*?\\*/' },
      { cls: 'str', re: '"(?:[^"\\\\\\n]|\\\\.)*"' },
      { cls: 'kw', re: '\\b(?:module|endmodule|input|output|inout|wire|reg|logic|always|always_comb|always_ff|always_latch|assign|begin|end|if|else|case|endcase|posedge|negedge|parameter|localparam|generate|endgenerate|for|initial|function|endfunction|task|endtask|default)\\b' },
      // a base specifier, not a character literal: the apostrophe means three
      // different things across this handbook's languages and its rule is
      // never shared
      { cls: 'num', re: "\\b\\d*'[bBoOdDhH][0-9a-fA-FxXzZ_]+|\\b\\d+\\b" },
      { cls: 'fn', re: '\\b[A-Za-z_]\\w*(?=\\s*\\()' },
      { cls: 'punc', re: '<=|>=|==|!=|&&|\\|\\||[-+*/%=<>!&|^~?:;,.@\\[\\](){}]' },
    ],
    python: [
      { cls: 'str', re: '(?:[rRbBfFuU]{0,2})(?:"""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\'|"(?:[^"\\\\\\n]|\\\\.)*"|\'(?:[^\'\\\\\\n]|\\\\.)*\')' },
      { cls: 'com', re: '#[^\\n]*' },
      { cls: 'kw', re: '\\b(?:and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield|match|case)\\b' },
      { cls: 'type', re: '\\b(?:None|True|False|int|float|str|bytes|bool|list|dict|set|tuple)\\b' },
      { cls: 'num', re: '\\b(?:0[xX][0-9a-fA-F_]+|\\d[\\d_]*\\.?[\\d_]*(?:[eE][-+]?\\d+)?)\\b' },
      { cls: 'fn', re: '\\b[A-Za-z_]\\w*(?=\\s*\\()' },
      { cls: 'punc', re: '[-+*/%=<>!&|^~?:;,.\\[\\](){}]' },
    ],
  };

  RULES.cpp = [
    RULES.c[0], RULES.c[1],
    { cls: 'str', re: 'R"\\w*\\([\\s\\S]*?\\)\\w*"|' + RULES.c[2].re },
    { cls: 'kw', re: '\\b(?:alignas|alignof|catch|class|concept|consteval|constexpr|constinit|co_await|co_return|co_yield|decltype|delete|dynamic_cast|explicit|export|friend|mutable|namespace|new|noexcept|nullptr|operator|override|private|protected|public|reinterpret_cast|requires|static_assert|static_cast|template|this|throw|try|typename|using|virtual)\\b|' + RULES.c[3].re },
    RULES.c[4], RULES.c[5], RULES.c[6], RULES.c[7],
  ];

  RULES.cuda = [
    ...RULES.cpp.slice(0, 4),
    { cls: 'type', re: '\\b(?:__global__|__device__|__host__|__shared__|__constant__|__restrict__|__managed__|dim3|threadIdx|blockIdx|blockDim|gridDim|warpSize|half|nv_bfloat16|__nv_fp8_e4m3|__nv_fp8_e5m2)\\b' },
    { cls: 'punc', re: '<<<|>>>' },
    ...RULES.cpp.slice(4),
  ];

  /* x86-64 does not fit the single-pass shape: `label:` at column zero and an
   * operand `mov` are different tokens by POSITION, not by pattern. So it gets
   * an anchored pass per line. */
  function paintAsm(src) {
    return src.split('\n').map(line => {
      const c = line.indexOf('#') >= 0 ? line.indexOf('#')
              : (line.indexOf(';') >= 0 ? line.indexOf(';') : -1);
      const code = c >= 0 ? line.slice(0, c) : line;
      const com = c >= 0 ? line.slice(c) : '';
      let out = code
        .replace(/^(\s*)([A-Za-z_.$][\w.$]*)(:)/,
          (_, w, l, cl) => `${w}<span class="t-fn">${esc(l)}</span><span class="t-punc">${cl}</span>`)
        .replace(/(^|\s)(\.[a-z_]\w*)/g,
          (_, w, d) => `${w}<span class="t-pre">${esc(d)}</span>`)
        .replace(/%[a-z0-9]+/g, r => `<span class="t-type">${esc(r)}</span>`)
        .replace(/\$?-?\b(?:0[xX][0-9a-fA-F]+|\d+)\b/g,
          n => `<span class="t-num">${esc(n)}</span>`);
      // anything still unspanned at the start of the instruction is a mnemonic
      out = out.replace(/^(\s*)([a-z][a-z0-9.]*)(?=\s|$)/,
        (m0, w, mn) => m0.includes('<span') ? m0
          : `${w}<span class="t-kw">${esc(mn)}</span>`);
      return out + (com ? `<span class="t-com">${esc(com)}</span>` : '');
    }).join('\n') + ' ';
  }

  function highlight(src, lang) {
    if (lang === 'asm' || lang === 'x86') return paintAsm(src);
    const rules = RULES[lang] || RULES.c;
    return paint(src, rules);
  }

  /* ---------------------------------------------------------------- editor */

  function mountEditor(host, { value, lang, onChange }) {
    host.innerHTML =
      `<div class="stack"><pre class="hl" aria-hidden="true"></pre>` +
      `<textarea spellcheck="false" autocapitalize="off" autocomplete="off"
                 autocorrect="off" aria-label="Your answer"></textarea></div>`;
    const stack = host.querySelector('.stack');
    const pre = host.querySelector('pre.hl');
    const ta = host.querySelector('textarea');
    ta.value = value || '';

    const sync = () => {
      pre.innerHTML = highlight(ta.value, lang);
      // The pre defines the scroll extent; the textarea contributes no layout.
      // Width is the one metric CSS cannot express, so it is pushed here.
      requestAnimationFrame(() => { ta.style.width = pre.scrollWidth + 'px'; });
    };

    ta.addEventListener('input', () => { sync(); onChange && onChange(ta.value); });
    // vertical is free: the textarea cannot scroll. horizontal is not.
    ta.addEventListener('scroll', () => { stack.scrollLeft = ta.scrollLeft; });

    ta.addEventListener('keydown', ev => {
      if (ev.key === 'Tab') {
        ev.preventDefault();
        const s = ta.selectionStart, e = ta.selectionEnd;
        ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(e);
        ta.selectionStart = ta.selectionEnd = s + 2;
        sync(); onChange && onChange(ta.value);
      }
      if (ev.key === 'Enter') {
        // keep the current indent, and add one level after an opening brace
        const s = ta.selectionStart;
        const line = ta.value.slice(0, s).split('\n').pop();
        const indent = (line.match(/^\s*/) || [''])[0];
        const extra = /\{\s*$/.test(line) ? '  ' : '';
        if (indent || extra) {
          ev.preventDefault();
          const ins = '\n' + indent + extra;
          ta.value = ta.value.slice(0, s) + ins + ta.value.slice(ta.selectionEnd);
          ta.selectionStart = ta.selectionEnd = s + ins.length;
          sync(); onChange && onChange(ta.value);
        }
      }
    });

    sync();
    return {
      get value() { return ta.value; },
      set value(v) { ta.value = v; sync(); },
      focus: () => ta.focus(),
      setWrap: on => { host.dataset.wrap = on ? 'on' : 'off'; sync(); },
      el: ta,
    };
  }

  /* --------------------------------------------------------- the backends */

  const BACKENDS = {};

  /** Register a backend. Every one returns the same shape. */
  function register(name, impl) { BACKENDS[name] = impl; }

  async function run(exercise, source, cfg) {
    const be = BACKENDS[exercise.backend];
    if (!be) {
      return {
        pass: false,
        signals: [],
        verdicts: [{
          who: exercise.backend, state: 'unavailable',
          title: 'This backend is not built into the page yet.',
        }],
      };
    }
    return be.run(exercise, source, cfg || {});
  }

  /* sim: the in-page logic simulator. Runs in a Worker because a learner's
   * circuit can be deep and the page must stay alive. */
  const simWorker = (() => {
    let w = null, seq = 0;
    const pending = new Map();
    const start = () => {
      if (w) return w;
      w = new Worker('assets/sim.js');
      w.onmessage = ev => {
        const { id, result } = ev.data;
        const r = pending.get(id);
        if (r) { pending.delete(id); r(result); }
      };
      w.onerror = () => {
        pending.forEach(res => res({
          verdict: 'parse-error', line: 0,
          message: 'the simulator could not start',
        }));
        pending.clear();
        w = null;
      };
      return w;
    };
    return (src, spec) => new Promise(resolve => {
      const id = ++seq;
      pending.set(id, resolve);
      start().postMessage({ id, src, spec });
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          if (w) { w.terminate(); w = null; }
          resolve({ verdict: 'timeout', message: 'the circuit took too long' });
        }
      }, 5000);
    });
  })();

  register('sim', {
    label: 'simulator',
    run: async (ex, src) => {
      const spec = ex.spec;
      if (!spec) {
        return {
          pass: false, signals: [],
          verdicts: [{ who: 'sim', state: 'unavailable',
                       title: 'This exercise has no specification to check against.' }],
        };
      }
      const r = await simWorker(src, spec);
      const ok = r.verdict === 'ok';
      const state = ok ? 'ok' : (r.verdict === 'gate-budget' ? 'warn' : 'bad');

      let detail = '';
      if (r.verdict === 'table-mismatch' && r.rows) {
        const head = [...spec.inputs, ...spec.outputs, 'yours'];
        detail = '<table class="truth"><thead><tr>' +
          head.map(h => `<th>${esc(h)}</th>`).join('') + '</tr></thead><tbody>' +
          r.rows.map(row =>
            `<tr class="${row.ok ? '' : 'bad'}">` +
            row.ins.map(v => `<td>${v}</td>`).join('') +
            row.want.map(v => `<td>${v}</td>`).join('') +
            row.got.map(v => `<td>${v}</td>`).join('') + '</tr>').join('') +
          '</tbody></table>';
      } else if (r.verdict === 'cycle' && r.loop) {
        detail = `<pre>${esc(r.loop.join('  ->  '))}</pre>`;
      }

      return {
        pass: ok,
        gates: r.gates,
        signals: [{ judge: 'verdict', key: r.verdict }],
        verdicts: [{
          who: 'simulator', state,
          title: r.message,
          detail,
          code: r.verdict,
          line: r.line,
        }],
      };
    },
  });

  return { highlight, mountEditor, run, register, BACKENDS, RULES };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = WB;
