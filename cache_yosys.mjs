/* Cache the Yosys WebAssembly runtime locally so the build-time validator can
 * run it without a network import and without npm.
 *
 * Node removed network imports, and this project has no package.json on
 * purpose: the site itself has no dependencies and is served as static files.
 * Validation is a build-time concern, so the runtime is fetched once into
 * .cache/ (gitignored) and imported from disk.
 *
 * One transformation is applied to the bundle. It resolves its WebAssembly
 * against an absolute CDN path:
 *
 *     new URL("./yosys.core.wasm",
 *             new URL("/npm/@yowasp/yosys@VERSION/gen/bundle.js", import.meta.url))
 *
 * Under file: that anchors at the filesystem root. Replacing the inner URL with
 * import.meta.url makes the siblings resolve next to the cached bundle, which
 * is where they are put. The runtime already has a Node path: it detects
 * process.release.name === "node" and reads file: URLs with readFile.
 *
 * Run: node cache_yosys.mjs
 */

import { mkdir, writeFile, stat, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERSION = '0.68.1207';
const BASE = `https://cdn.jsdelivr.net/npm/@yowasp/yosys@${VERSION}`;
const HERE = dirname(fileURLToPath(import.meta.url));
export const CACHE = join(HERE, '.cache', 'yosys', VERSION);
export const ENTRY = join(CACHE, 'bundle.js');

const SIBLINGS = [
  'yosys.core.wasm', 'yosys.core2.wasm', 'yosys.core3.wasm', 'yosys.core4.wasm',
  'yosys-resources.0.tar',
];

const exists = async (p) => { try { await stat(p); return true; } catch { return false; } };

/* Node's fetch does not implement the file: scheme, and the browser-targeted
 * bundle has its Node branch shimmed out by the CDN, so it reaches for fetch
 * unconditionally. Teach fetch about file: rather than patching the bundle
 * further: the shim is small, obvious, and only installed in Node.
 *
 * Without this the failure is `Error: not implemented... yet...` from deep
 * inside undici, which says nothing about what went wrong. */
let shimmed = false;
export function shimFileFetch() {
  if (shimmed) return;
  shimmed = true;
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = input instanceof URL ? input : new URL(String(input?.url ?? input));
    if (url.protocol !== 'file:') return real(input, init);
    const body = await readFile(url);
    return new Response(body, {
      status: 200,
      headers: {
        'content-length': String(body.length),
        'content-type': url.pathname.endsWith('.wasm')
          ? 'application/wasm' : 'application/octet-stream',
      },
    });
  };
}

async function get(url, dest, label, onProgress) {
  if (await exists(dest)) return false;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} fetching ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  await writeFile(dest, buf);
  onProgress && onProgress(label, buf.length);
  return true;
}

export async function ensureCached(onProgress = () => {}) {
  shimFileFetch();
  await mkdir(CACHE, { recursive: true });

  if (!(await exists(ENTRY))) {
    const r = await fetch(`${BASE}/+esm`);
    if (!r.ok) throw new Error(`${r.status} fetching the yosys bundle`);
    let js = await r.text();
    // Note the trailing `.href`: the bundle writes
    //   new URL("./x.wasm", new URL("/npm/...", import.meta.url).href)
    // and dropping only the inner URL leaves `import.meta.url.href`, which is
    // undefined because import.meta.url is a string. That produced an
    // ERR_INVALID_URL with no useful message, so the suffix is part of the
    // pattern.
    const abs = `new URL("/npm/@yowasp/yosys@${VERSION}/gen/bundle.js",import.meta.url).href`;
    if (!js.includes(abs)) {
      throw new Error(
        'the bundle no longer anchors its wasm the way this cache expects; ' +
        're-read cache_yosys.mjs before bumping the version');
    }
    js = js.split(abs).join('import.meta.url');
    // Look for the construction, not the string: jsDelivr puts the original
    // path in a banner comment, which is harmless.
    if (js.includes('new URL("/npm/') || js.includes('import.meta.url.href')) {
      throw new Error('the rewrite left a URL this cache cannot resolve');
    }
    await writeFile(ENTRY, js);
    onProgress('bundle.js', js.length);
  }

  for (const f of SIBLINGS) {
    await get(`${BASE}/gen/${f}`, join(CACHE, f), f, onProgress);
  }

  // Prove the cache works rather than assuming it. A rewrite that produces a
  // syntactically valid but semantically broken URL fails here with a clear
  // message instead of surfacing as "every exercise has a syntax error".
  if (!verified) {
    const { pathToFileURL } = await import('node:url');
    const mod = await import(pathToFileURL(ENTRY).href);
    let out = '';
    const dec = new TextDecoder();
    await mod.runYosys(['-p', 'read_verilog t.v; synth -top t; stat'],
      { 't.v': 'module t(input a, output y); assign y = ~a; endmodule' },
      { stdout: (b) => { if (b) out += dec.decode(b); }, stderr: () => {} });
    if (!/\$_NOT_/.test(out)) {
      throw new Error('the cached runtime ran but produced no recognisable ' +
                      'netlist; the cache is not usable');
    }
    verified = true;
  }
  return ENTRY;
}

let verified = false;

if (import.meta.url === `file://${process.argv[1]}`) {
  let total = 0;
  const entry = await ensureCached((name, bytes) => {
    total += bytes;
    process.stderr.write(`  fetched ${name} (${(bytes / 1e6).toFixed(1)} MB)\n`);
  });
  process.stderr.write(total
    ? `yosys ${VERSION} cached, ${(total / 1e6).toFixed(1)} MB\n`
    : `yosys ${VERSION} already cached\n`);
  process.stdout.write(entry);
}
