// How registry generation and the audit print their findings: one block per
// finding, where it is first, then what's wrong and what fixes it.

import type { AuditFinding } from './audit';
import type { RegistryDiagnostic } from './registry';

/**
 * Each diagnostic as
 *
 *     @acme/ocean@1.2.0 node_modules/@acme/ocean/manifest.json /contract: manifest.contract-newer (error)
 *       /contract is contract 2.1, newer than the 2.0 this host reads.
 *       Expected 2.0, found 2.1.
 *       Upgrade the host, or pin a release of the package built for this contract. ...
 */
export function formatRegistryDiagnostics(diagnostics: readonly RegistryDiagnostic[]): string {
  return diagnostics
    .map((record) => {
      const name = record.version ? `${record.package}@${record.version}` : record.package;
      const where = `${name} ${record.manifestPath}${record.pointer ? ` ${record.pointer}` : ''}`;
      const lines = [`${where}: ${record.code} (${record.severity})`, `  ${record.message}`];
      if (record.expected !== undefined || record.actual !== undefined) {
        const parts = [
          record.expected !== undefined ? `Expected ${record.expected}` : undefined,
          record.actual !== undefined ? `found ${record.actual}` : undefined,
        ].filter(Boolean);
        lines.push(`  ${parts.join(', ').replace(/^found/, 'Found')}.`);
      }
      lines.push(`  ${record.remedy}`);
      return `${lines.join('\n')}\n`;
    })
    .join('\n');
}

/** Each finding as `<package> <file>:<line>:<column>: <code>`, its message, and its remedy. */
export function formatAuditFindings(findings: readonly AuditFinding[]): string {
  return findings
    .map(
      (finding) =>
        `${finding.package} ${finding.file}:${finding.line}:${finding.column}: ${finding.code}\n  ${finding.file} ${finding.message}\n  ${finding.remedy}\n`,
    )
    .join('\n');
}
