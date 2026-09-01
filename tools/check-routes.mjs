/* Every route names a function that exists.
 *
 * `node --check` parses app.js and says nothing about a route pointing at a
 * name nothing declares: the reference is only evaluated when someone visits
 * that page. A bad search-and-replace deleted viewAtlas and left the route
 * behind, and every automated check passed while the atlas showed a blank
 * page. This is the check that would have caught it.
 */
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../assets/app.js', import.meta.url), 'utf8');

const m = src.match(/const ROUTES = \{([\s\S]*?)\n\};/);
if (!m) {
  console.error('check-routes: no ROUTES table found in app.js');
  process.exit(1);
}

const declared = new Set(
  [...src.matchAll(/(?:^|\n)(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g)]
    .map(x => x[1]));

const bad = [];
for (const [, route, fn] of m[1].matchAll(/'([^']+)':\s*([A-Za-z0-9_$]+)/g)) {
  if (!declared.has(fn)) bad.push(`route '${route}' points at ${fn}, which nothing declares`);
}

if (bad.length) {
  bad.forEach(b => console.error('  ' + b));
  process.exit(1);
}
console.log(`${[...m[1].matchAll(/'([^']+)':/g)].length} routes, every handler declared`);
