// Rows 45/50 CI probe, evidence only, not for merge: the packs' readings at 200% root text, compared.
//   node tests/e2e/sb-reflow-probe-diff.mjs <file of "[sb-probe] json" lines>
// It prints each pack's scrollWidth, every token and type value that differs between packs (marked
// "splits" where the failing packs share one value and no passing pack has it), and each failing pack's
// elements past the window's right edge that no passing pack has there. It exits 0 whatever it finds.
import { readFileSync } from 'node:fs';

const PREFIX = '[sb-probe] json ';
const results = readFileSync(process.argv[2], 'utf8')
  .split('\n')
  .map((line) => (line.includes(PREFIX) ? line.slice(line.indexOf(PREFIX)) : ''))
  .filter(Boolean)
  .map((line) => JSON.parse(line.slice(PREFIX.length)));
console.log(
  `[sb-probe diff] ${results.length} pack(s): ${results.map((each) => each.pack).join(', ')}`,
);
const fails = (each) => each.expected.startsWith('fails');
const at = (each) => each.readings[0];
const values = {};
const put = (pack, name, value) => {
  values[name] ??= {};
  values[name][pack] = typeof value === 'string' ? value : JSON.stringify(value);
};
for (const each of results) {
  const reading = at(each);
  if (!reading) continue;
  console.log(
    `[sb-probe diff] ${each.pack} (${each.expected}): ${reading.label}, scrollWidth ${reading.page.scrollWidth} in ${reading.page.innerWidth}`,
  );
  for (const [name, value] of Object.entries(reading.tokens ?? {})) put(each.pack, name, value);
  for (const role of ['bodyType', 'nameType', 'metaType']) {
    for (const [key, value] of Object.entries(reading.page[role] ?? {})) {
      if (key !== 'selector') put(each.pack, `${role}.${key}`, value);
    }
  }
  reading.stageBodies.forEach((body, index) => {
    for (const key of [
      'gridTemplateColumns',
      'columnGap',
      'rowColumns',
      'rowGap2',
      'leaderMargin',
      'still',
    ]) {
      put(each.pack, `stage[${index}].${key}`, body[key]);
    }
  });
  if (reading.widestName)
    put(each.pack, 'widestName', `${reading.widestName.text} ${reading.widestName.width}`);
}
const failing = results.filter(fails).map((each) => each.pack);
const passing = results.filter((each) => !fails(each)).map((each) => each.pack);
for (const [name, byPack] of Object.entries(values)) {
  const distinct = new Set(Object.values(byPack));
  if (distinct.size < 2) continue;
  const failValues = new Set(failing.map((pack) => byPack[pack]));
  const splits =
    failValues.size === 1 && !passing.some((pack) => failValues.has(byPack[pack])) ? ' splits' : '';
  console.log(
    `[sb-probe diff]${splits} ${name}: ${Object.entries(byPack)
      .map(([pack, value]) => `${pack}=${value}`)
      .join(' | ')}`,
  );
}
const past = (each) =>
  new Set(
    at(each)
      ?.widest.filter((el) => el.rect.right > at(each).page.innerWidth + 0.5)
      .map((el) => el.selector) ?? [],
  );
const passPast = new Set(results.filter((each) => !fails(each)).flatMap((each) => [...past(each)]));
for (const each of results.filter(fails)) {
  const only = [...past(each)].filter((selector) => !passPast.has(selector));
  console.log(
    `[sb-probe diff] ${each.pack}: ${only.length} element(s) past the edge that no passing pack has there`,
  );
  for (const selector of only.slice(0, 10)) console.log(`[sb-probe diff]   ${selector}`);
}
