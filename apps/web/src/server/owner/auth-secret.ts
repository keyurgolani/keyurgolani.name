import 'server-only';
import { HASH_CEILING, HASH_FLOOR, parameterProblem, parseHash } from '@portfolio/core/owner';
import type { ConfigIssue, DeploymentConfig } from '../config';
import { recordOwnerModule } from '../load-trace';

// The auth.secret startup requirement (#2): owner's password hash is a
// scrypt PHC string inside the parameter floor and ceiling. config.ts has
// already refused a key set both directly and through _FILE, an unreadable
// file, and a hash file that isn't a regular file or that group or others
// can write. Each finding names the variable and the reason, never the value.
// Typed by shape, so this module doesn't import the composition root.

recordOwnerModule('server/owner/auth-secret');

const FILE_KEY = 'PORTFOLIO_AUTH_PASSWORD_HASH_FILE';
const params = ({ ln, r, p }: { ln: number; r: number; p: number }) => `ln=${ln}, r=${r}, p=${p}`;
const REWRITE = 'Write a new one with hash-password (docs/deployment.md, Owner authentication).';

export async function check({
  config,
}: {
  readonly config: DeploymentConfig;
}): Promise<readonly ConfigIssue[]> {
  const hash = config.secrets.authPasswordHash;
  if (hash === undefined) {
    return [
      fatal(
        FILE_KEY,
        'required',
        `The owner profile needs a password hash: set ${FILE_KEY} to a file holding the line ` +
          'hash-password prints, or PORTFOLIO_AUTH_PASSWORD_HASH to the line itself.',
      ),
    ];
  }
  const key = config.secretKeys?.authPasswordHash ?? FILE_KEY;
  const parsed = parseHash(hash);
  if (!parsed.ok) {
    return [fatal(key, 'malformed', `${key} doesn't hold a scrypt PHC string. ${REWRITE}`)];
  }
  switch (parameterProblem(parsed.hash.params)) {
    case 'below_floor':
      return [
        fatal(
          key,
          'below_floor',
          `${key} holds a hash weaker than ${params(HASH_FLOOR)}. ${REWRITE}`,
        ),
      ];
    case 'above_ceiling':
      return [
        fatal(
          key,
          'above_ceiling',
          `${key} holds a hash past ${params(HASH_CEILING)}, which costs too much to check at ` +
            `each sign-in. ${REWRITE}`,
        ),
      ];
    default:
      return [];
  }
}

function fatal(key: string, code: string, message: string): ConfigIssue {
  return { severity: 'fatal', key, code, message };
}
