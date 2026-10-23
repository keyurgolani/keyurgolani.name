import { BlockList, isIP } from 'node:net';
import { recordOwnerModule } from '../load-trace';

// The addresses a remote media fetch never connects to (#10, slice 2 item 3,
// SSRF): loopback, private, link-local (169.254.169.254 and the other cloud
// metadata endpoints among them), shared, documentation, benchmarking,
// multicast, and reserved space, in IPv4 and IPv6. An IPv6 address that
// carries an IPv4 one (mapped, compatible, NAT64, 6to4, Teredo) is refused
// whole, whatever it carries. Checked after DNS, on the address the
// connection then uses.

recordOwnerModule('core/media/address');

const IPV4: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // shared address space (carrier NAT; 100.100.100.200 metadata)
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (169.254.169.254 metadata)
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, and 255.255.255.255
];

const IPV6: ReadonlyArray<readonly [string, number]> = [
  ['::', 96], // unspecified, loopback (::1), and IPv4-compatible
  ['::ffff:0:0', 96], // IPv4-mapped
  ['64:ff9b::', 96], // NAT64
  ['64:ff9b:1::', 48], // local NAT64
  ['100::', 64], // discard
  ['2001::', 23], // IETF protocol assignments, Teredo among them
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4
  ['fc00::', 7], // unique local (fd00:ec2::254 metadata)
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local
  ['ff00::', 8], // multicast
];

// Two lists: one BlockList matches IPv4 against IPv4-mapped IPv6 rules and
// the other way round, so ::ffff:0:0/96 in a shared list would block every
// IPv4 address.
const blockedV4 = new BlockList();
const blockedV6 = new BlockList();
for (const [network, prefix] of IPV4) blockedV4.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of IPV6) blockedV6.addSubnet(network, prefix, 'ipv6');

/** An address without the brackets a URL puts around an IPv6 literal. */
function bare(address: string): string {
  return address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address;
}

/** Whether a fetch may connect to `address`. Anything that isn't an IP address may not. */
export function isPublicAddress(address: string): boolean {
  // A zone index ties an address to a local link.
  if (address.includes('%')) return false;
  const ip = bare(address);
  const family = isIP(ip);
  if (family === 4) return !blockedV4.check(ip, 'ipv4');
  if (family === 6) return !blockedV6.check(ip, 'ipv6');
  return false;
}

/** Whether a URL's hostname is an IP address rather than a name to resolve. */
export function isAddressLiteral(hostname: string): boolean {
  return isIP(bare(hostname)) !== 0;
}

/** A URL hostname as an address to connect to: brackets off an IPv6 literal. */
export function literalAddress(hostname: string): string {
  return bare(hostname);
}
