// A Playwright reporter for a CI proof run: each test's final outcome, as Playwright counts them
// (expected, unexpected, flaky, skipped), and every PNG attachment's SHA-256, keyed by the test
// and the attachment's name, so two runs of one suite compare shot by shot. Node built-ins only.
//
//   playwright test ... --reporter=list,<this file>
//
// PROOF_STATS names the JSON file it writes the counts and the unexpected tests' titles
// (failures) to.
// PROOF_SHOTS names a folder: shots.tsv (key, sha256, bytes, project, file, titles as JSON) and
// png/<sha256>.png, each shot once.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const clean = (text) => String(text).replace(/[\t\n\r]+/g, ' ');

export default class ProofReporter {
  constructor() {
    this.stats = process.env.PROOF_STATS;
    this.shots = process.env.PROOF_SHOTS;
    this.tests = [];
    this.keys = new Map();
    if (this.shots) mkdirSync(path.join(this.shots, 'png'), { recursive: true });
  }

  printsToStdio() {
    return false;
  }

  onBegin(_config, suite) {
    this.tests = suite.allTests();
  }

  onTestEnd(test, result) {
    if (!this.shots) return;
    const title = test.titlePath().filter(Boolean).join(' > ');
    const seen = new Map();
    for (const attachment of result.attachments) {
      if (attachment.contentType !== 'image/png') continue;
      let body = attachment.body;
      if (!body && attachment.path && existsSync(attachment.path))
        body = readFileSync(attachment.path);
      if (!body) continue;
      const n = (seen.get(attachment.name) ?? 0) + 1;
      seen.set(attachment.name, n);
      const key = clean(`${title} > ${attachment.name}${n > 1 ? ` #${n}` : ''}`);
      const sha = createHash('sha256').update(body).digest('hex');
      const png = path.join(this.shots, 'png', `${sha}.png`);
      if (!existsSync(png)) writeFileSync(png, body);
      // A retried test's last result stands: the key keeps its last line.
      // The test's project, file and titles too, so a shot can be re-shot by itself.
      const [, project, file, ...titles] = test.titlePath();
      this.keys.set(
        key,
        [key, sha, body.length, project ?? '', file ?? '', JSON.stringify(titles)].join('\t'),
      );
    }
  }

  onEnd(result) {
    if (this.shots) {
      const lines = [...this.keys.values()].sort();
      writeFileSync(
        path.join(this.shots, 'shots.tsv'),
        lines.length ? `${lines.join('\n')}\n` : '',
      );
    }
    if (!this.stats) return;
    const counts = { expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
    const failures = [];
    for (const test of this.tests) {
      const outcome = test.outcome();
      counts[outcome] = (counts[outcome] ?? 0) + 1;
      if (outcome === 'unexpected') {
        failures.push(clean(test.titlePath().filter(Boolean).join(' > ')));
      }
    }
    const out = { status: result.status, total: this.tests.length, ...counts, failures };
    writeFileSync(this.stats, `${JSON.stringify(out, null, 2)}\n`);
  }
}
