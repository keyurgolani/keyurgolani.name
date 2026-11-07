// Harness push 2's evidence: applies mutant <index> of <mutants.json> (a05b7's inventory meta mutants,
// converted from inv/mutant_list.py) under <root>, each edit's old string found exactly once, and
// prints the files it changed, one a line. Exits 1, changing nothing, when an edit's count isn't 1.
//   node patch.mjs <mutants.json> <index> <root>
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const [file, index, root] = process.argv.slice(2);
const mutant = JSON.parse(readFileSync(file, 'utf8'))[Number(index)];
if (!mutant) throw new Error(`no mutant ${index}`);
const texts = new Map();
for (const [rel, old, replacement] of mutant.edits) {
  const full = path.join(root, rel);
  const text = texts.get(full) ?? readFileSync(full, 'utf8');
  const count = text.split(old).length - 1;
  if (count !== 1) {
    console.log(`${mutant.name}: ${rel}: anchor found ${count} times`);
    process.exit(1);
  }
  texts.set(full, text.replace(old, () => replacement));
}
for (const [full, text] of texts) {
  writeFileSync(full, text);
  console.log(path.relative(root, full));
}
