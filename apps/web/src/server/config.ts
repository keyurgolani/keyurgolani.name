import 'server-only';
import fs from 'node:fs';
import path from 'node:path';

// The deployment configuration. This is the only module that reads
// deployment environment variables; everything else gets the frozen result
// through getDeploymentConfig() in config-store.ts.
//
// Every key also accepts <KEY>_FILE, a file holding the value with one
// trailing newline trimmed. An empty value counts as unset. Lookups go through
// a variable key, so Next.js never inlines a build-time value.

export const PROFILES = ['owner', 'demo', 'read-only'] as const;
export type Profile = (typeof PROFILES)[number];

/** `production` when NODE_ENV is production; `next dev` and tests are development. */
export type RuntimeMode = 'production' | 'development';

/** Each deployment key and the profiles whose column lists it. */
export const DEPLOYMENT_KEYS = {
  PORTFOLIO_PROFILE: PROFILES,
  PORTFOLIO_ORIGIN: PROFILES,
  PORTFOLIO_SOURCE_DIR: ['owner', 'read-only'],
  PORTFOLIO_TRUSTED_PROXY_HOPS: PROFILES,
  PORTFOLIO_PREVIEW_ORIGIN: ['owner', 'demo'],
  PORTFOLIO_DATA_DIR: ['owner'],
  PORTFOLIO_AUTH_PASSWORD_HASH: ['owner'],
  GITHUB_TOKEN: ['owner'],
} as const satisfies Record<string, readonly Profile[]>;
export type DeploymentKey = keyof typeof DEPLOYMENT_KEYS;

/** Removed settings, each with the key that replaced it. Setting one is fatal. */
export const REPLACED_KEYS = {
  PORTFOLIO_PATH: 'PORTFOLIO_SOURCE_DIR',
  NEXT_PUBLIC_BASE_URL: 'PORTFOLIO_ORIGIN',
} as const;

export interface DeploymentConfig {
  readonly profile: Profile;
  readonly mode: RuntimeMode;
  /** The canonical origin. Every absolute URL the app builds starts with it. */
  readonly origin: string;
  /** Absolute PORTFOLIO_SOURCE_DIR (`owner`, `read-only`). */
  readonly sourceDir?: string;
  /** How many X-Forwarded-For entries, from the right, come from trusted proxies. */
  readonly trustedProxyHops: number;
  /** Origin for isolated previews (`owner`, `demo`). */
  readonly previewOrigin?: string;
  /** Writable data directory (`owner`), for draft and revision storage. */
  readonly dataDir?: string;
  readonly secrets: Readonly<{ authPasswordHash?: string; githubToken?: string }>;
}

/**
 * One startup finding. It names the key and, for a document, where in the
 * file the problem is. It never carries a configured value or document text.
 */
export interface ConfigIssue {
  readonly severity: 'fatal' | 'warning';
  /** Stable reason, such as `required` or `document_invalid`. */
  readonly code: string;
  readonly key: string;
  readonly message: string;
  /** Document name, relative to the source directory. */
  readonly file?: string;
  /** JSON pointer into the document. */
  readonly path?: string;
  readonly line?: number;
  readonly column?: number;
  /** The parser's or the schema's own code for the problem. */
  readonly issueCode?: string;
}

/** One JSON line for the startup log: `config.fatal` or `config.warning`. */
export function issueLogLine(issue: ConfigIssue, profile?: Profile, now = new Date()): string {
  const fatal = issue.severity === 'fatal';
  return JSON.stringify({
    ts: now.toISOString(),
    level: fatal ? 'fatal' : 'warn',
    event: fatal ? 'config.fatal' : 'config.warning',
    profile,
    key: issue.key,
    code: issue.code,
    file: issue.file,
    path: issue.path,
    line: issue.line,
    column: issue.column,
    issueCode: issue.issueCode,
    message: issue.message,
  });
}

export type Env = Readonly<Record<string, string | undefined>>;

export interface ReadConfigOptions {
  /** Resolves a relative PORTFOLIO_SOURCE_DIR (the server's working directory, apps/web). */
  readonly cwd: string;
  /** Reads a <KEY>_FILE. Defaults to fs.readFileSync as UTF-8. */
  readonly readFile?: (file: string) => string;
}

export type ReadConfigResult =
  | { readonly ok: true; readonly config: DeploymentConfig; readonly issues: ConfigIssue[] }
  | { readonly ok: false; readonly profile?: Profile; readonly issues: ConfigIssue[] };

type Resolved =
  | { readonly state: 'unset' }
  | { readonly state: 'invalid' }
  | { readonly state: 'set'; readonly value: string };
const UNSET: Resolved = { state: 'unset' };
const INVALID: Resolved = { state: 'invalid' };

const KNOWN_KEYS = new Set<string>([
  ...Object.keys(DEPLOYMENT_KEYS).flatMap((key) => [key, `${key}_FILE`]),
  ...Object.keys(REPLACED_KEYS),
]);

const ORIGIN_SHAPE =
  'a bare origin: http or https, a host, and an optional port, written the way a browser ' +
  'serializes it (lowercase, no path or trailing slash, no default port), such as https://jane.name';

/**
 * Reads and validates the deployment configuration from `env`. Returns every
 * problem it finds, so one failed start reports them all.
 */
export function readDeploymentConfig(env: Env, options: ReadConfigOptions): ReadConfigResult {
  const readFile =
    options.readFile ?? ((file) => fs.readFileSync(/*turbopackIgnore: true*/ file, 'utf8'));
  const mode: RuntimeMode = env['NODE_ENV'] === 'production' ? 'production' : 'development';
  const issues: ConfigIssue[] = [];
  const fatal = (key: string, code: string, message: string) => {
    issues.push({ severity: 'fatal', key, code, message });
  };
  const warn = (key: string, code: string, message: string) => {
    issues.push({ severity: 'warning', key, code, message });
  };

  for (const [key, replacement] of Object.entries(REPLACED_KEYS)) {
    if (isSet(env[key])) {
      fatal(key, 'key_replaced', `${key} is no longer read. Set ${replacement} instead.`);
    }
  }

  /** The key's value, from the key itself or its _FILE. `invalid` is already reported. */
  const resolve = (key: DeploymentKey): Resolved => {
    const fileKey = `${key}_FILE`;
    const direct = env[key];
    const file = env[fileKey];
    if (isSet(direct) && isSet(file)) {
      fatal(key, 'value_and_file', `Set ${key} or ${fileKey}, not both.`);
      return INVALID;
    }
    if (isSet(direct)) return { state: 'set', value: direct };
    if (!isSet(file)) return UNSET;
    let text: string;
    try {
      text = readFile(file);
    } catch {
      fatal(fileKey, 'file_unreadable', `${fileKey} names a file the server can't read.`);
      return INVALID;
    }
    const value = text.endsWith('\r\n')
      ? text.slice(0, -2)
      : text.endsWith('\n')
        ? text.slice(0, -1)
        : text;
    return value === '' ? UNSET : { state: 'set', value };
  };

  let profile: Profile | undefined;
  const profileValue = resolve('PORTFOLIO_PROFILE');
  if (profileValue.state === 'unset') {
    fatal(
      'PORTFOLIO_PROFILE',
      'required',
      'PORTFOLIO_PROFILE is required. Set it to owner, demo, or read-only.',
    );
  } else if (profileValue.state === 'set') {
    if (isProfile(profileValue.value)) profile = profileValue.value;
    else {
      fatal(
        'PORTFOLIO_PROFILE',
        'invalid',
        'PORTFOLIO_PROFILE must be exactly owner, demo, or read-only, in lowercase.',
      );
    }
  }

  /**
   * resolve(), except that a key outside the profile's column is fatal in
   * production and ignored, with a warning, in development.
   */
  const resolveFor = (key: DeploymentKey): Resolved => {
    const allowed: readonly Profile[] = DEPLOYMENT_KEYS[key];
    if (profile && !allowed.includes(profile)) {
      if (isSet(env[key]) || isSet(env[`${key}_FILE`])) {
        const name = isSet(env[key]) ? key : `${key}_FILE`;
        const plural = allowed.length > 1 ? 's' : '';
        const applies = `${key} applies only to the ${allowed.join(' and ')} profile${plural}`;
        if (mode === 'production') {
          fatal(name, 'not_in_profile', `${applies}. Unset it for ${profile}.`);
        } else {
          warn(
            name,
            'not_in_profile',
            `${applies}. Ignored under next dev; production refuses to start.`,
          );
        }
      }
      return UNSET;
    }
    return resolve(key);
  };

  let origin: string | undefined;
  const originValue = resolve('PORTFOLIO_ORIGIN');
  if (originValue.state === 'unset') {
    fatal('PORTFOLIO_ORIGIN', 'required', `PORTFOLIO_ORIGIN is required: ${ORIGIN_SHAPE}.`);
  } else if (originValue.state === 'set') {
    const url = parseBareOrigin(originValue.value);
    if (!url) {
      fatal('PORTFOLIO_ORIGIN', 'invalid', `PORTFOLIO_ORIGIN must be ${ORIGIN_SHAPE}.`);
    } else if (profile === 'owner' && url.protocol === 'http:' && !isLoopback(url.hostname)) {
      fatal(
        'PORTFOLIO_ORIGIN',
        'insecure',
        'The owner profile needs an https PORTFOLIO_ORIGIN unless the host is loopback.',
      );
    } else {
      origin = url.origin;
      if ((profile === 'owner' || profile === 'read-only') && isReservedExampleHost(url.hostname)) {
        const reserved =
          'PORTFOLIO_ORIGIN is on a reserved example domain (example.com, .net, or .org, ' +
          '.example, or .invalid)';
        if (mode === 'production') {
          fatal('PORTFOLIO_ORIGIN', 'reserved_domain', `${reserved}. Set the origin visitors use.`);
        } else {
          warn('PORTFOLIO_ORIGIN', 'reserved_domain', `${reserved}. Production refuses to start.`);
        }
      }
    }
  }

  let trustedProxyHops = 0;
  const hopsValue = resolveFor('PORTFOLIO_TRUSTED_PROXY_HOPS');
  if (hopsValue.state === 'set') {
    if (/^\d+$/.test(hopsValue.value) && Number.isSafeInteger(Number(hopsValue.value))) {
      trustedProxyHops = Number(hopsValue.value);
    } else {
      fatal(
        'PORTFOLIO_TRUSTED_PROXY_HOPS',
        'invalid',
        'PORTFOLIO_TRUSTED_PROXY_HOPS must be a whole number, 0 or more.',
      );
    }
  }

  let previewOrigin: string | undefined;
  const previewValue = resolveFor('PORTFOLIO_PREVIEW_ORIGIN');
  if (previewValue.state === 'set') {
    const url = parseBareOrigin(previewValue.value);
    if (!url) {
      fatal(
        'PORTFOLIO_PREVIEW_ORIGIN',
        'invalid',
        `PORTFOLIO_PREVIEW_ORIGIN must be ${ORIGIN_SHAPE}.`,
      );
    } else if (origin !== undefined && url.origin === origin) {
      fatal(
        'PORTFOLIO_PREVIEW_ORIGIN',
        'same_as_origin',
        'PORTFOLIO_PREVIEW_ORIGIN must differ from PORTFOLIO_ORIGIN.',
      );
    } else {
      previewOrigin = url.origin;
    }
  }

  let sourceDir: string | undefined;
  const sourceValue = resolveFor('PORTFOLIO_SOURCE_DIR');
  if (sourceValue.state === 'set') {
    sourceDir = path.resolve(/*turbopackIgnore: true*/ options.cwd, sourceValue.value);
  } else if (sourceValue.state === 'unset' && (profile === 'owner' || profile === 'read-only')) {
    fatal(
      'PORTFOLIO_SOURCE_DIR',
      'required',
      `PORTFOLIO_SOURCE_DIR is required for the ${profile} profile: the directory that holds portfolio.yml.`,
    );
  }

  const dataDir = valueOf(resolveFor('PORTFOLIO_DATA_DIR'));
  const authPasswordHash = valueOf(resolveFor('PORTFOLIO_AUTH_PASSWORD_HASH'));
  const githubToken = valueOf(resolveFor('GITHUB_TOKEN'));

  for (const name of Object.keys(env)) {
    if (name.startsWith('PORTFOLIO_') && !KNOWN_KEYS.has(name) && isSet(env[name])) {
      warn(
        name,
        'unknown_key',
        `${name} isn't a deployment setting. Check the name against .env.example.`,
      );
    }
  }

  if (!profile || origin === undefined || issues.some((issue) => issue.severity === 'fatal')) {
    return { ok: false, profile, issues };
  }
  const config: DeploymentConfig = Object.freeze({
    profile,
    mode,
    origin,
    trustedProxyHops,
    ...(sourceDir !== undefined ? { sourceDir } : {}),
    ...(previewOrigin !== undefined ? { previewOrigin } : {}),
    ...(dataDir !== undefined
      ? { dataDir: path.resolve(/*turbopackIgnore: true*/ options.cwd, dataDir) }
      : {}),
    secrets: Object.freeze({
      ...(authPasswordHash !== undefined ? { authPasswordHash } : {}),
      ...(githubToken !== undefined ? { githubToken } : {}),
    }),
  });
  return { ok: true, config, issues };
}

function valueOf(resolved: Resolved): string | undefined {
  return resolved.state === 'set' ? resolved.value : undefined;
}

function isSet(value: string | undefined): value is string {
  return value !== undefined && value !== '';
}

function isProfile(value: string): value is Profile {
  return (PROFILES as readonly string[]).includes(value);
}

/** The URL when `value` is exactly a serialized http(s) origin, else null. */
export function parseBareOrigin(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return url.origin === value ? url : null;
}

export function isLoopback(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    hostname === '[::1]'
  );
}

/** example.com, .net, and .org with their subdomains, and the .example and .invalid TLDs. */
export function isReservedExampleHost(hostname: string): boolean {
  return /(^|\.)(example\.(com|net|org)|example|invalid)$/.test(hostname);
}
