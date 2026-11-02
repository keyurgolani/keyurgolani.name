// Preloaded into a server under test with NODE_OPTIONS=--import=<this file's
// URL>, so nothing it renders reaches the network: a fetch to any host but
// loopback rejects, as it would offline, and the server renders what it
// renders without the data. Next.js wraps global fetch after this runs, so
// its wrapper calls this one. Each refused host goes to the server log once.
const loopback = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const fetchOnline = globalThis.fetch;
const refused = new Set();

globalThis.fetch = async function offlineFetch(input, init) {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (loopback.has(url.hostname)) return fetchOnline(input, init);
  if (!refused.has(url.host)) {
    refused.add(url.host);
    console.error(`[offline-fetch] refused a fetch to ${url.host}`);
  }
  throw new TypeError(`fetch failed: ${url.host} is offline under test`);
};
