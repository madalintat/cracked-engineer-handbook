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

  /* godbolt: Compiler Explorer's public API.
   *
   * Two things here are not obvious and both were established by measurement:
   *
   * 1. The nonce goes in userArguments, never in the source. Options are part
   *    of the cache key, so this defeats the cache; and unlike a comment it
   *    shifts no line numbers. A nonce in the source moves every diagnostic
   *    down by one and silently breaks the mapping from error to editor line.
   *
   * 2. In executor mode the COMPILER's diagnostics live in buildResult, and
   *    the top-level stderr belongs to the running program. Reading the wrong
   *    one finds no diagnostics and reports success.
   *
   * Also: check didExecute before trusting code. A build failure reports
   * didExecute:false with code -1, which is not a program exit status.
   */

  const uuid = () =>
    (crypto.randomUUID ? crypto.randomUUID()
     : String(Date.now()) + Math.random().toString(16).slice(2))
    .replace(/-/g, '').slice(0, 16);

  /** Compiler prose is not stable across releases, but its shape is. Strip the
   *  parts that move so a regex written today still matches tomorrow. */
  function normalise(text) {
    // The full CSI form, not only the colour sequences. gcc also emits
    // ESC[K (erase-line), and stripping only the ones ending in `m` leaves
    // that behind, which then stops every anchored rule below from matching.
    const CSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;?]*[ -\\/]*[@-~]', 'g');
    return String(text || '')
      .replace(CSI, '')
      .replace(/\r\n/g, '\n')
      .replace(/^\s*<source>:/gm, '')                     // the virtual file
      .replace(/^\s*\/[^\s:]*\/(?=[\w.-]+:\d)/gm, '')    // absolute paths
      .split('\n').map(l => l.replace(/\s+$/, '')).join('\n')
      .trim();
  }

  /** The closest thing C and C++ have to a stable error code. */
  function warningFlag(text) {
    const m = /\[-W([a-z0-9-]+)\]/.exec(text || '');
    return m ? `-W${m[1]}` : null;
  }

  /* Classify the run.
   *
   * The exit code is not enough. Measured against the live service: a failed
   * assert reports code 139 and "Program terminated with signal: SIGSEGV",
   * while its own stderr says "Assertion `x' failed". The sandbox's signal
   * number is not the process's. So the text decides where the text is
   * unambiguous, and the code decides the rest.
   *
   * In executor mode there is no execResult: the top-level object IS the run,
   * and the compiler lives in buildResult. Reading that backwards finds no
   * diagnostics and reports success.
   */
  function ceVerdictOf(res, ran, runText) {
    if (res.timedOut) return 'timeout';
    if (!ran) return res.code === 0 ? 'ok' : 'compile-error';

    const build = res.buildResult;
    if (build && build.code !== 0) return 'compile-error';
    if (res.didExecute === false) return 'compile-error';

    // Not anchored: the real line begins with the object and source path,
    // e.g. "output.s: /app/example.cpp:3: int main(): Assertion `x' failed."
    if (/\bAssertion\b.*\bfailed\b/.test(runText || '')) return 'assert-failed';

    const code = res.code;
    if (code === null || code === undefined) return 'compile-error';
    if (code === 0) return 'ok';
    if (code === 134) return 'assert-failed';
    if (code > 128) return 'signal';
    return 'nonzero-exit';
  }

  register('godbolt', {
    label: 'compiler',
    async run(ex, source, cfg) {
      const conf = (cfg.judges && cfg.judges.godbolt) || null;
      if (!conf) {
        return {
          pass: false, signals: [],
          verdicts: [{ who: 'compiler', state: 'unavailable',
                       title: 'The compiler configuration has not loaded.' }],
        };
      }
      const lang = ex.lang || 'cpp';
      const L = conf.langs[lang];
      if (!L) {
        return {
          pass: false, signals: [],
          verdicts: [{ who: 'compiler', state: 'unavailable',
                       title: `No compiler is configured for ${lang}.` }],
        };
      }

      const wantsRun = ex.kind === 'output' || !!ex.tests;
      const full = ex.tests
        ? source + '\n' + ex.tests + '\n'
        : source;
      const userLines = source.split('\n').length;

      const args = [L.flags, ex.flags || '', `${conf.nonceFlag}=${uuid()}`]
        .filter(Boolean).join(' ');

      const body = {
        source: full,
        lang: lang === 'cpp' ? 'c++' : lang,
        allowStoreCodeDebug: false,
        options: {
          userArguments: args,
          compilerOptions: { executorRequest: wantsRun, skipAsm: wantsRun },
          filters: { execute: wantsRun, binary: false, intel: true,
                     labels: true, directives: true, commentOnly: true,
                     demangle: true, trim: false },
          executeParameters: { args: [], stdin: '' },
          tools: [],
        },
      };

      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), conf.timeoutMs || 30000);
      let res;
      try {
        const r = await fetch(conf.endpoint.replace('{id}', L.id), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body),
          signal: ctl.signal,
        });
        if (!r.ok) throw new Error(`the compiler service answered ${r.status}`);
        res = await r.json();
      } catch (e) {
        return {
          pass: false, signals: [],
          verdicts: [{
            who: 'compiler', state: 'unavailable',
            title: e.name === 'AbortError'
              ? 'The compiler did not answer in time. This is the service, not your code.'
              : `Could not reach the compiler: ${e.message}`,
          }],
        };
      } finally { clearTimeout(t); }

      // In executor mode the compiler speaks in buildResult; the top level is
      // the program. Read both, and never mix them up.
      const build = res.buildResult || res;
      const diagText = normalise(
        (build.stderr || []).map(x => x.text).join('\n'));
      const progOut = normalise((res.stdout || []).map(x => x.text).join('\n'));
      const progErr = normalise((res.stderr || []).map(x => x.text).join('\n'));

      // In executor mode the top-level object is the run itself.
      const exec = wantsRun ? (res.execResult || res) : null;
      const verdict = ceVerdictOf(res, wantsRun, progErr + '\n' + progOut);

      const tagged = (build.stderr || []).filter(x => x.tag);
      const errors = tagged.filter(x => x.tag.severity === 3);
      const warnings = tagged.filter(x => x.tag.severity === 2);

      // In compile-only mode the build stderr and the top-level stderr are the
      // same text, so dedupe rather than offering the reader's regex two
      // identical haystacks.
      const signals = [{ judge: 'verdict', key: verdict }];
      const seen = new Set();
      const addMatch = (txt) => {
        if (!txt || seen.has(txt)) return;
        seen.add(txt);
        signals.push({ judge: 'match', key: txt });
      };
      addMatch(diagText);
      addMatch(progErr);
      addMatch(progOut);
      for (const w of warnings) {
        const f = warningFlag(w.tag.text);
        if (f) signals.push({ judge: 'verdict', key: 'warning' },
                            { judge: 'match', key: f });
      }
      // `silent` is the most instructive failure a handbook can set: every
      // judge happy and the answer still wrong. It is a property of FAILING
      // with nothing to show for it, not of succeeding.
      const quiet = !errors.length && !warnings.length;
      const wrong = verdict === 'assert-failed' || verdict === 'nonzero-exit';
      if (quiet && wrong) signals.push({ judge: 'silent', key: '' });

      const verdicts = [];
      const firstErr = errors[0] || warnings[0];
      verdicts.push({
        who: 'compiler',
        state: errors.length ? 'bad' : (warnings.length ? 'warn' : 'ok'),
        title: errors.length
          ? `${errors.length} error${errors.length > 1 ? 's' : ''}.`
          : warnings.length
            ? `Compiled, with ${warnings.length} warning${warnings.length > 1 ? 's' : ''}.`
            : 'Compiled cleanly.',
        detail: diagText
          ? `<pre>${escHtml(withUserLineNote(diagText, userLines))}</pre>` : '',
        code: firstErr ? (warningFlag(firstErr.tag.text) || 'error') : null,
        line: firstErr ? firstErr.tag.line : null,
      });

      if (wantsRun) {
        const code = exec ? exec.code : null;
        const ok = verdict === 'ok';
        verdicts.push({
          who: 'program',
          state: !errors.length && ok ? 'ok'
               : (!errors.length ? 'bad' : 'unavailable'),
          title: errors.length
            ? 'Not run, because it did not compile.'
            : verdict === 'assert-failed'
              ? 'A check failed. The line above says which.'
            : verdict === 'signal' ? `Killed by signal ${code - 128}.`
            : verdict === 'nonzero-exit' ? `Exited with status ${code}.`
            : verdict === 'timeout' ? 'Took too long and was stopped.'
            : 'Ran and every check passed.',
          detail: (progOut || progErr)
            ? `<pre>${escHtml([progOut, progErr].filter(Boolean).join('\n'))}</pre>`
            : '',
        });
      }

      // Correct and clean are different questions. A program that compiles
      // with warnings and passes its checks is right, and not yet finished.
      const pass = verdict === 'ok' && errors.length === 0;
      const clean = pass && warnings.length === 0;
      if (pass && !clean) {
        verdicts[0].title =
          `Correct, and not clean: ${warnings.length} ` +
          `warning${warnings.length > 1 ? 's' : ''} to answer for.`;
      }
      return { pass, clean, signals, verdicts, toolchain: L.name };
    },
  });

  /* yosys: real synthesis, as WebAssembly, in a module worker.
   *
   * The runtime is a 78 MB download. That is a product decision, not a
   * footnote, so it is never fetched until a learner asks for it and the size
   * is stated before anything starts. The Python handbook downloads about
   * 20 MB in silence and its own analysis flagged that as the thing not to
   * copy.
   */
  const YOSYS_BYTES = 78_300_000;

  const yosysWorker = (() => {
    let w = null, seq = 0, ready = false;
    const pending = new Map();

    const start = () => {
      if (w) return w;
      w = new Worker('assets/yosys-worker.js', { type: 'module' });
      w.onmessage = (ev) => {
        const { id, type, result, message, done, total, version } = ev.data;
        const p = pending.get(id);
        if (!p) return;
        if (type === 'progress') { p.onProgress && p.onProgress(done, total); return; }
        pending.delete(id);
        if (type === 'result') { ready = true; p.resolve(result); }
        else if (type === 'ready') { ready = true; p.resolve({ version }); }
        else p.resolve({ verdict: 'unavailable', message: message || 'the synthesiser failed' });
      };
      w.onerror = (e) => {
        pending.forEach(p => p.resolve({
          verdict: 'unavailable',
          message: 'The synthesiser could not start: ' + (e.message || 'unknown'),
        }));
        pending.clear();
        w = null; ready = false;
      };
      return w;
    };

    return {
      get ready() { return ready; },
      send(type, payload, onProgress) {
        const id = ++seq;
        return new Promise(resolve => {
          pending.set(id, { resolve, onProgress });
          start().postMessage({ id, type, ...payload });
        });
      },
    };
  })();

  register('yosys', {
    label: 'synthesis',
    bytes: YOSYS_BYTES,
    get loaded() { return yosysWorker.ready; },
    async run(ex, source, cfg) {
      if (!ex.spec) {
        return {
          pass: false, signals: [],
          verdicts: [{ who: 'synthesis', state: 'unavailable',
                       title: 'This exercise has no synthesis specification.' }],
        };
      }
      const r = await yosysWorker.send('run', { src: source, spec: ex.spec },
                                       cfg.onProgress);
      if (r.verdict === 'unavailable') {
        return {
          pass: false, signals: [],
          verdicts: [{ who: 'synthesis', state: 'unavailable', title: r.message }],
        };
      }
      const ok = r.verdict === 'ok';
      const cellList = r.cells && Object.keys(r.cells).length
        ? '<pre>' + escHtml(Object.entries(r.cells)
            .map(([k, v]) => `${String(v).padStart(4)}  ${k}`).join('\n')) + '</pre>'
        : '';
      return {
        pass: ok,
        clean: ok,
        cells: r.cells,
        signals: [{ judge: 'verdict', key: r.verdict },
                  { judge: 'match', key: normalise(r.out || '') }],
        verdicts: [{
          who: 'synthesis',
          state: ok ? 'ok' : (r.verdict === 'cell-budget' ? 'warn' : 'bad'),
          title: r.message,
          detail: cellList,
          code: r.verdict,
        }],
        toolchain: 'yosys 0.68',
      };
    },
  });

  /* modal: a GPU on the learner's own account.
   *
   * Submit then poll, because Modal enforces a hard 150-second ceiling on web
   * functions and a cold start plus an nvcc compile can exceed it. The submit
   * endpoint is CPU-only and checks the secret before any GPU is started, so a
   * leaked URL costs a fraction of a cent rather than $6.25 an hour.
   *
   * Nothing here has a fallback to someone else's GPU. If the learner has not
   * configured a runner, the honest answer is `unavailable`, not a pretend
   * pass.
   */
  function nvccVerdict(r) {
    if (r.compile_rc !== 0) return 'compile-error';
    if (/compute-sanitizer|Invalid __global__|CUDA-MEMCHECK/.test(r.stderr || ''))
      return 'sanitizer';
    if (/\b(cudaError|CUDA error|an illegal memory access)\b/.test(
          (r.stderr || '') + (r.stdout || ''))) return 'cuda-error';
    if (/\bAssertion\b.*\bfailed\b/.test((r.stderr || '') + (r.stdout || '')))
      return 'assert-failed';
    if (r.run_rc === undefined || r.run_rc === null) return 'launch-error';
    if (r.run_rc !== 0) return 'cuda-error';
    return 'ok';
  }

  register('modal', {
    label: 'gpu',
    needsSetup: true,
    async run(ex, source, cfg) {
      const conf = (cfg.judges && cfg.judges.modal) || {};
      const ep = cfg.modal || {};
      if (!ep.submit || !ep.poll || !ep.token) {
        return {
          pass: false, signals: [{ judge: 'verdict', key: 'no-endpoint' }],
          verdicts: [{
            who: 'gpu', state: 'unavailable',
            title: 'No GPU runner is configured. These exercises run on a ' +
                   'GPU you rent, from your own free credit, and the handbook ' +
                   'has no GPU of its own to lend you.',
          }],
        };
      }

      const gpu = ex.gpuChoice || cfg.gpu || 'T4';
      const post = async (url, body) => {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: ep.token, ...body }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `the runner answered ${r.status}`);
        return j;
      };

      let started;
      try {
        started = await post(ep.submit, {
          gpu, source, arch: ex.gpu || undefined, flags: ex.flags || '',
        });
      } catch (e) {
        return {
          pass: false, signals: [{ judge: 'verdict', key: 'no-endpoint' }],
          verdicts: [{ who: 'gpu', state: 'unavailable',
                       title: `Could not reach your runner: ${e.message}` }],
        };
      }

      const deadline = Date.now() + (conf.timeoutMs || 300000);
      const every = conf.pollMs || 1500;
      let r = null;
      while (Date.now() < deadline) {
        await new Promise(res => setTimeout(res, every));
        let p;
        try {
          p = await post(ep.poll, { call_id: started.call_id });
        } catch (e) {
          return {
            pass: false, signals: [{ judge: 'verdict', key: 'no-endpoint' }],
            verdicts: [{ who: 'gpu', state: 'unavailable',
                         title: `Lost contact with your runner: ${e.message}` }],
          };
        }
        if (p.state === 'done') { r = p.result; break; }
        if (p.state === 'failed') {
          return {
            pass: false, signals: [{ judge: 'verdict', key: 'launch-error' }],
            verdicts: [{ who: 'gpu', state: 'bad',
                         title: `The run failed on the GPU: ${p.error}` }],
          };
        }
        cfg.onProgress && cfg.onProgress(0, 0,
          `Waiting on ${gpu}. A cold start takes about a minute.`);
      }

      if (!r) {
        return {
          pass: false, signals: [{ judge: 'verdict', key: 'timeout' }],
          verdicts: [{ who: 'gpu', state: 'bad',
                       title: 'The GPU did not answer in time.' }],
        };
      }

      const verdict = nvccVerdict(r);
      const diag = normalise(r.compile_stderr || '');
      const runOut = normalise((r.stdout || '') + '\n' + (r.stderr || ''));
      const signals = [{ judge: 'verdict', key: verdict }];
      if (diag) signals.push({ judge: 'match', key: diag });
      if (runOut) signals.push({ judge: 'match', key: runOut });
      if (r.sass) signals.push({ judge: 'match', key: r.sass });
      if (r.ptxas) signals.push({ judge: 'match', key: normalise(r.ptxas) });
      if (verdict !== 'ok' && !diag) signals.push({ judge: 'silent', key: '' });

      const verdicts = [{
        who: 'nvcc',
        state: r.compile_rc === 0 ? 'ok' : 'bad',
        title: r.compile_rc === 0
          ? `Compiled for ${r.arch}.`
          : 'It did not compile.',
        detail: diag ? `<pre>${escHtml(diag)}</pre>` : '',
      }];
      verdicts.push({
        who: r.gpu ? r.gpu.split(',')[0] : gpu,
        state: verdict === 'ok' ? 'ok'
             : (r.compile_rc !== 0 ? 'unavailable' : 'bad'),
        title: r.compile_rc !== 0 ? 'Not run, because it did not compile.'
             : verdict === 'ok' ? 'Ran and every check passed.'
             : verdict === 'assert-failed' ? 'A check failed on the GPU.'
             : verdict === 'cuda-error' ? `The kernel failed: exit ${r.run_rc}.`
             : 'The run did not complete.',
        detail: runOut ? `<pre>${escHtml(runOut)}</pre>` : '',
      });

      return {
        pass: verdict === 'ok',
        clean: verdict === 'ok',
        signals, verdicts,
        sass: r.sass,
        toolchain: `nvcc on ${(r.gpu || gpu).split(',')[0]}`,
      };
    },
  });

  const escHtml = s => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  /* Hidden tests are appended after the learner's code, so a diagnostic past
   * their last line is about the tests, not about them. Say so rather than
   * pointing at a line they cannot see. */
  function withUserLineNote(text, userLines) {
    return text.replace(/^(\d+):(\d+):/gm, (m0, l, c) =>
      Number(l) > userLines ? `[in the checks] ${l}:${c}:` : m0);
  }

  return { highlight, mountEditor, run, register, BACKENDS, RULES,
           normalise, warningFlag, ceVerdictOf, withUserLineNote };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = WB;
