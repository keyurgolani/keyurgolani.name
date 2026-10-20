// @portfolio/core/owner: the package's only entry, and all of it owner code
// (#1, item 14). Only the web app's server/owner/ modules import it, which
// check:deps enforces, so demo and read-only never load it.
import { recordOwnerModule } from './load-trace';

recordOwnerModule('core/owner');

export {
  credentialFingerprint,
  formatHash,
  HASH_CEILING,
  HASH_FLOOR,
  hashPassword,
  parameterProblem,
  parseHash,
  type PasswordHash,
  type ScryptParams,
} from './auth/phc.mjs';
export {
  localPasswordProvider,
  type AuthProvider,
  type LocalPasswordOptions,
  type Principal,
  type Verification,
} from './auth/provider';
