/* Validate yosys exercises through the same checking logic the browser uses.
 *
 * Called by build.py --validate. Reads a JSON payload on argv[2] and prints a
 * JSON array of results.
 *
 * Imports assets/yosys-check.js, which the browser worker also imports. There
 * is one implementation of "what counts as a latch", not two that can drift.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { check, useRuntime } from './assets/yosys-check.js';
import { ensureCached, VERSION } from './cache_yosys.mjs';

// Fetch the pinned runtime once into .cache/ and point the shared checking
// logic at it, so this runs the identical code the browser worker runs.
const entry = await ensureCached();
await useRuntime(pathToFileURL(entry).href);

const { items } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const OUT = process.argv[3];
if (!OUT) throw new Error('usage: validate_yosys.mjs <payload.json> <out.json>');

/* Serial on purpose. The runtime is a single WebAssembly instance and the
 * whole payload is already resident after the first call, so concurrency buys
 * nothing and makes the output interleave. */
const out = [];
for (const item of items) {
  const one = async (src) => {
    try {
      const r = await check(src, item.spec);
      return { verdict: r.verdict, message: r.message, cells: r.cells || {} };
    } catch (e) {
      return { verdict: 'unavailable', message: String((e && e.message) || e) };
    }
  };
  const starter = await one(item.starter);
  const solution = await one(item.solution);
  out.push({
    n: item.n, title: item.title, want: item.want,
    starterVerdict: starter.verdict, starterMessage: starter.message,
    starterCells: starter.cells,
    solutionVerdict: solution.verdict, solutionMessage: solution.message,
    solutionCells: solution.cells,
  });
}

// The runtime logs its download progress to stdout, so results go to a file
// rather than competing with it for the same stream.
writeFileSync(OUT, JSON.stringify(out));
