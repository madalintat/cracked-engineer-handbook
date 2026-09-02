/* Every var(--x) in app.css names a token app.css defines.
 *
 * A `font:` shorthand with an undefined variable is not an error anywhere: the
 * declaration is dropped at computed-value time and the element inherits body
 * type. That is how the unit number on every track card, the path card title
 * and the stage title all rendered at 15px in Inter for a month, with every
 * other check green. This is the check that would have caught it.
 */
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../assets/app.css', import.meta.url), 'utf8');

const defined = new Set([...css.matchAll(/(?:^|[\s;{])(--[\w-]+)\s*:/g)].map(m => m[1]));
/* A var() with a fallback is allowed to name a token the stylesheet never
 * sets: --read is written from JS as the reader scrolls, and the fallback is
 * what the rail shows before that. Without a fallback there is no such excuse. */
const used = new Map();
for (const m of css.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)) {
  const line = css.slice(0, m.index).split('\n').length;
  if (m[2] === ')' && !used.has(m[1])) used.set(m[1], line);
}

const bad = [...used].filter(([name]) => !defined.has(name));
if (bad.length) {
  bad.forEach(([name, line]) =>
    console.error(`  app.css:${line} uses ${name}, which nothing defines`));
  process.exit(1);
}
console.log(`${used.size} tokens used, every one defined`);
