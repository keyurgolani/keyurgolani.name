// pnpm test:trace's own options (#6, Slice 1), which tests/trace/run.mjs
// takes from the command line and hands to Playwright's workers in the
// environment. Everything after `--`, and anything it doesn't know, goes
// to Playwright as is.
//
//   pnpm test:trace                          the app under test, each registered selection
//   pnpm test:trace --selection <id>         one registered selection, by variant id or as the site names it
//   pnpm test:trace --base-url <url> [--selection <label>] [--allow-third-party]
//                                            a server it didn't start, on this machine only
//
// --allow-third-party, for the baseline calibration alone, records each
// third-party request and aborts it, where a trace would fail on it. It
// needs --base-url, so no trace of the app under test ever allows one.

export const ENV = {
  baseUrl: 'PORTFOLIO_TRACE_BASE_URL',
  allowThirdParty: 'PORTFOLIO_TRACE_ALLOW_THIRD_PARTY',
  selection: 'PORTFOLIO_TRACE_SELECTION',
  command: 'PORTFOLIO_TRACE_COMMAND',
};

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * A base URL the trace may visit: http or https on this machine, the
 * origin alone. Throws on anything else.
 *
 * @param {string} value
 */
export function checkBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`--base-url needs a URL, such as http://127.0.0.1:3000; got ${value}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`--base-url is http or https; got ${url.protocol}`);
  }
  if (!LOOPBACK.has(url.hostname)) {
    throw new Error(
      `--base-url traces a server on this machine only (127.0.0.1, localhost, or [::1]); got ${url.hostname}`,
    );
  }
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error(`--base-url is an origin, with no path, query, or credentials; got ${value}`);
  }
  return url.origin;
}

/**
 * Splits the command line into the trace's options and Playwright's arguments.
 *
 * @param {string[]} argv
 * @returns {{ baseUrl: string | null, allowThirdParty: boolean, selection: string | null, playwright: string[] }}
 */
export function parseTraceArgs(argv) {
  const options = { baseUrl: null, allowThirdParty: false, selection: null, playwright: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      options.playwright.push(...argv.slice(index + 1));
      break;
    }
    const [name, inline] = arg.startsWith('--') ? arg.split(/=(.*)/s, 2) : [arg, undefined];
    const value = () => {
      if (inline !== undefined) return inline;
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) throw new Error(`${name} needs a value`);
      index += 1;
      return next;
    };
    if (name === '--base-url') options.baseUrl = checkBaseUrl(value());
    else if (name === '--selection') options.selection = value();
    else if (name === '--allow-third-party') {
      if (inline !== undefined) throw new Error('--allow-third-party takes no value');
      options.allowThirdParty = true;
    } else options.playwright.push(arg);
  }
  if (options.allowThirdParty && !options.baseUrl) {
    throw new Error(
      '--allow-third-party is for a server the trace did not start: it needs --base-url',
    );
  }
  if (options.selection !== null && !/^[a-z0-9][a-z0-9-]*$/.test(options.selection)) {
    throw new Error(`--selection is an id, such as editorial; got ${options.selection}`);
  }
  return options;
}

/** The environment that carries `options` to the workers. */
export function traceEnv(options, command) {
  return {
    [ENV.baseUrl]: options.baseUrl ?? '',
    [ENV.allowThirdParty]: options.allowThirdParty ? '1' : '',
    [ENV.selection]: options.selection ?? '',
    [ENV.command]: command,
  };
}

/**
 * The options, as a worker reads them back. Outside run.mjs, as when
 * Playwright runs the config directly, they're the defaults.
 *
 * @param {Record<string, string | undefined>} [env]
 */
export function readTraceEnv(env = process.env) {
  const baseUrl = env[ENV.baseUrl] ? checkBaseUrl(env[ENV.baseUrl]) : null;
  const allowThirdParty = env[ENV.allowThirdParty] === '1';
  if (allowThirdParty && !baseUrl) throw new Error(`${ENV.allowThirdParty} needs ${ENV.baseUrl}`);
  return {
    baseUrl,
    allowThirdParty,
    selection: env[ENV.selection] || null,
    command: env[ENV.command] || 'pnpm test:trace',
  };
}
