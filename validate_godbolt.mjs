/* Validate godbolt exercises through THE SAME client the browser uses.
 *
 * Called by build.py --validate. Reads a JSON payload on argv[2] and prints a
 * JSON array of results.
 *
 * Reusing assets/workbench.js rather than reimplementing the request in Python
 * is the whole point: a validator that models the client instead of being the
 * client will eventually disagree with it, and the disagreement will be
 * discovered by a learner rather than by the build.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const WB = require('./assets/workbench.js');

const payload = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const { judges, items } = payload;

/* Compiler Explorer is a free public service. Four at a time is a politeness
 * budget, not a throughput target, and it is per-backend so hundreds of local
 * simulator checks never queue behind these. */
const LIMIT = 4;

async function pool(jobs, limit) {
  const out = new Array(jobs.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, jobs.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= jobs.length) return;
      out[i] = await jobs[i]();
    }
  });
  await Promise.all(workers);
  return out;
}

const attempt = async (ex, source) => {
  for (let tryN = 0; tryN < 3; tryN++) {
    const r = await WB.run(ex, source, { judges });
    const unavailable = r.verdicts.some(v => v.state === 'unavailable');
    if (!unavailable) return r;
    // The service being busy is not the content being wrong. Back off and
    // retry rather than failing a build over someone else's load.
    if (tryN < 2) await new Promise(res => setTimeout(res, 1500 * (tryN + 1)));
    else return r;
  }
};

const jobs = items.map(item => async () => {
  const ex = {
    backend: 'godbolt', lang: item.lang, kind: item.kind,
    flags: item.flags, tests: item.tests, diagnose: [],
  };
  const starter = await attempt(ex, item.starter);
  const solution = await attempt(ex, item.solution);
  // Every verdict the run emitted, not only the first. A program that
  // compiles with warnings and runs correctly emits both `ok` and `warning`,
  // and an exercise may legitimately expect either.
  const keys = r => r.signals.filter(s => s.judge === 'verdict').map(s => s.key);
  return {
    n: item.n, title: item.title, want: item.want,
    starterVerdicts: keys(starter),
    starterVerdict: keys(starter)[0],
    starterPass: starter.pass,
    starterUnavailable: starter.verdicts.some(v => v.state === 'unavailable'),
    starterText: (starter.verdicts.find(v => v.detail) || {}).detail || '',
    starterSignals: starter.signals.map(s => ({ judge: s.judge, key: String(s.key).slice(0, 400) })),
    solutionVerdicts: keys(solution),
    solutionVerdict: keys(solution)[0],
    solutionPass: solution.pass,
    solutionClean: solution.clean,
    solutionUnavailable: solution.verdicts.some(v => v.state === 'unavailable'),
    solutionTitle: solution.verdicts.map(v => v.title).join(' / '),
    toolchain: solution.toolchain || starter.toolchain,
  };
});

const results = await pool(jobs, LIMIT);
process.stdout.write(JSON.stringify(results));
