/* Validate modal exercises through the same client the browser uses.
 *
 * Called by build.py --validate. Reads a JSON payload on argv[2], writes
 * results to argv[3].
 *
 * Requires a runner and its secret in the environment, because there is no
 * shared GPU and there should not be one:
 *
 *   HH_MODAL_SUBMIT   https://you--hh-runner-submit.modal.run
 *   HH_MODAL_POLL     https://you--hh-runner-poll.modal.run
 *   HH_MODAL_TOKEN    the SHARED_SECRET from runner/app.py
 *   HH_MODAL_GPU      optional, defaults to T4
 *
 * Without them every modal exercise is reported as SKIPPED rather than passing.
 * A validation that silently passes what it did not check is worse than one
 * that does not run.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const WB = require('./assets/workbench.js');

const { judges, items } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const OUT = process.argv[3];
if (!OUT) throw new Error('usage: validate_modal.mjs <payload.json> <out.json>');

const modal = {
  submit: process.env.HH_MODAL_SUBMIT,
  poll: process.env.HH_MODAL_POLL,
  token: process.env.HH_MODAL_TOKEN,
};
const gpu = process.env.HH_MODAL_GPU || 'T4';

if (!modal.submit || !modal.poll || !modal.token) {
  writeFileSync(OUT, JSON.stringify(
    items.map(i => ({ n: i.n, title: i.title, skipped: true }))));
  process.stderr.write('modal: no runner configured, exercises skipped\n');
  process.exit(0);
}

/* Two at a time. Each one starts a GPU container, and the point is to check
 * the content rather than to see how fast the account can spend its credit. */
async function pool(jobs, limit) {
  const out = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= jobs.length) return;
      out[i] = await jobs[i]();
    }
  }));
  return out;
}

const jobs = items.map(item => async () => {
  const ex = {
    backend: 'modal', lang: 'cuda', kind: item.kind, flags: item.flags,
    tests: item.tests, gpu: item.gpu, gpuChoice: gpu, diagnose: [],
  };
  const cfg = { judges, modal, gpu };
  const run = async (src) => {
    const r = await WB.run(ex, src, cfg);
    return {
      verdicts: r.signals.filter(s => s.judge === 'verdict').map(s => s.key),
      pass: r.pass,
      unavailable: r.verdicts.some(v => v.state === 'unavailable'),
      title: r.verdicts.map(v => v.title).join(' / '),
      out: (r.verdicts.find(v => v.detail) || {}).detail || '',
    };
  };
  const starter = await run(item.starter);
  const solution = await run(item.solution);
  process.stderr.write(`  ex${item.n} ${item.title}\n`);
  return {
    n: item.n, title: item.title, want: item.want,
    starterVerdicts: starter.verdicts, starterPass: starter.pass,
    starterUnavailable: starter.unavailable, starterTitle: starter.title,
    solutionVerdicts: solution.verdicts, solutionPass: solution.pass,
    solutionUnavailable: solution.unavailable, solutionTitle: solution.title,
  };
});

const results = await pool(jobs, 2);
writeFileSync(OUT, JSON.stringify(results));
