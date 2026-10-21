import { isIPv4, isIPv6 } from 'node:net';
import { recordOwnerModule } from '../load-trace';

// Where a request came from (#2). The audit log keeps only its IPv4 /24 or
// IPv6 /48 prefix, or `unknown` when no trusted proxy named one. Sign-in's
// per-source limit counts an IPv4 address or an IPv6 /64, the block one
// client usually holds.

recordOwnerModule('core/audit/source');

/** The eight 16-bit groups of an IPv6 address, or null when it isn't one. */
function ipv6Groups(address: string): number[] | null {
  if (!isIPv6(address)) return null;
  let text = address.toLowerCase().replace(/%.*$/, '');
  // An embedded IPv4 tail, as in ::ffff:192.0.2.1, becomes two groups.
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number) as [number, number, number, number];
    text = `${text.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = '', rest] = text.split('::');
  const parse = (part: string) =>
    part === '' ? [] : part.split(':').map((group) => parseInt(group, 16));
  const left = parse(head);
  const right = rest === undefined ? [] : parse(rest);
  const fill = rest === undefined ? 0 : 8 - left.length - right.length;
  const groups = [...left, ...Array<number>(fill).fill(0), ...right];
  return groups.length === 8 ? groups : null;
}

/** The groups of an address, IPv4 mapped into IPv6 counting as IPv4. */
function parse(address: string): { v4: number[] } | { v6: number[] } | null {
  if (isIPv4(address)) return { v4: address.split('.').map(Number) };
  const groups = ipv6Groups(address);
  if (!groups) return null;
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    const [high = 0, low = 0] = groups.slice(6);
    return { v4: [high >> 8, high & 0xff, low >> 8, low & 0xff] };
  }
  return { v6: groups };
}

/**
 * What sign-in's per-source limit counts for a client address: the IPv4
 * address itself, or its IPv6 /64, such as `2001:db8:85a3:42::/64`. Null
 * for no address, or one that isn't an IP address.
 */
export function limitSource(address: string | null | undefined): string | null {
  const parsed = address ? parse(address) : null;
  if (!parsed) return null;
  if ('v4' in parsed) return parsed.v4.join('.');
  return `${parsed.v6
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(':')}::/64`;
}

/**
 * The audit source for a client address: `203.0.113.0/24`,
 * `2001:db8:85a3::/48`, or `unknown`. An IPv4 address mapped into IPv6
 * counts as IPv4.
 */
export function sourcePrefix(address: string | null | undefined): string {
  if (!address) return 'unknown';
  if (isIPv4(address)) return `${address.split('.').slice(0, 3).join('.')}.0/24`;
  const groups = ipv6Groups(address);
  if (!groups) return 'unknown';
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    const [high = 0, low = 0] = groups.slice(6);
    return `${high >> 8}.${high & 0xff}.${low >> 8}.0/24`;
  }
  return `${groups
    .slice(0, 3)
    .map((group) => group.toString(16))
    .join(':')}::/48`;
}
