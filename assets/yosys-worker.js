/* Yosys, off the main thread.
 *
 * A module worker, because the runtime arrives by dynamic import from a CDN and
 * because a learner's design can take a while to synthesise. Nothing here
 * touches the DOM; all the checking logic lives in yosys-check.js so the
 * build-time validator runs the identical code.
 *
 * Messages in:
 *   { id, type: 'load' }              start fetching, report progress
 *   { id, type: 'run', src, spec }    synthesise and check
 * Messages out:
 *   { id, type: 'progress', done, total }
 *   { id, type: 'ready', version }
 *   { id, type: 'result', result }
 *   { id, type: 'error', message }
 */

import { check, load } from './yosys-check.js';

self.onmessage = async (ev) => {
  const { id, type, src, spec } = ev.data;
  const post = (o) => self.postMessage({ id, ...o });
  try {
    if (type === 'load') {
      const mod = await load();
      post({ type: 'ready', version: (mod && mod.version) || 'unknown' });
      return;
    }
    if (type === 'run') {
      const result = await check(src, spec,
        (e) => post({ type: 'progress', done: e.doneLength, total: e.totalLength }));
      post({ type: 'result', result });
      return;
    }
    post({ type: 'error', message: `unknown message ${type}` });
  } catch (e) {
    post({ type: 'error', message: String((e && e.message) || e) });
  }
};
