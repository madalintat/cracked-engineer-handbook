/* The mascot's only behaviour.
 *
 * Called from exactly one place: the branch of the workbench where an exercise
 * has just passed. Nothing else in the app may speak.
 *
 * The gating is the whole design. A companion that comments on everything is a
 * companion you close, and then it cannot say the one thing that mattered. So
 * it speaks on the first solve, on the last one in a unit, and on every third
 * in between, with a hard floor of one line every two minutes whatever those
 * rules say. A long session gets one line about stopping instead, once.
 *
 * It says nothing on failure. There is already a verdict, a diagnosis and a
 * hint on screen when something is wrong, and a cartoon bird is not the thing
 * that reading list needs.
 */

'use strict';

const COMPANION = (() => {
  const FLOOR_MS = 120000;          // one line every two minutes, at most
  const LONG_SESSION_MS = 90 * 60 * 1000;

  let lastSpoke = 0;
  let saidRest = false;
  const started = Date.now();
  let node = null;
  let timer = null;

  const LINES = {
    first: [
      'First one. A tool agreed with you, which is the only kind of ' +
      'agreement that counts here.',
    ],
    mid: [
      'Three in a row.',
      'That one had a carry in it.',
      'Still going.',
    ],
    last: [
      'That is the unit. Every check in it passed.',
      'Unit finished. The next one starts from what you just built.',
    ],
    rest: [
      'You have been at this a while. The track keeps.',
    ],
  };

  function hide() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (node) { node.remove(); node = null; }
  }

  function say(text, ttl) {
    hide();
    node = document.createElement('div');
    node.className = 'companion';
    node.setAttribute('role', 'status');
    node.innerHTML =
      '<img src="assets/img/mascot-head-128.png" alt="" width="46" height="41">' +
      `<p></p><button type="button" aria-label="Dismiss">&times;</button>`;
    node.querySelector('p').textContent = text;
    node.querySelector('button').onclick = hide;
    node.onclick = e => { if (e.target === node) hide(); };
    document.body.appendChild(node);
    lastSpoke = Date.now();
    timer = setTimeout(hide, ttl || 9000);
  }

  /** Called on a pass. `done` and `total` are for the unit being worked on. */
  function cheer(done, total) {
    // A long session pre-empts everything, and says its piece once.
    if (!saidRest && Date.now() - started > LONG_SESSION_MS) {
      saidRest = true;
      say(LINES.rest[0], 12000);
      return;
    }
    if (Date.now() - lastSpoke < FLOOR_MS) return;

    let pool = null;
    if (done === 1) pool = LINES.first;
    else if (total && done >= total) pool = LINES.last;
    else if (done % 3 === 0) pool = LINES.mid;
    if (!pool) return;

    say(pool[Math.floor(Math.random() * pool.length)],
        pool === LINES.last ? 11000 : 9000);
  }

  return { cheer, hide };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = COMPANION;
