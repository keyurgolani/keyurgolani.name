import type { DeploymentConfig } from './config';
import type { ConfigSummary } from './operations';
import { capabilityPolicy } from './policy';

/** The catalog adapter the composition root built. */
export type CatalogAdapter = ConfigSummary['adapters']['catalog'];

/**
 * The redacted deployment summary. The owner-session `config.status` query
 * returns it, and #1 item 20 logs it once at startup; no anonymous route
 * does. It names each secret only as set or unset.
 */
export function configSummary(config: DeploymentConfig, catalog: CatalogAdapter): ConfigSummary {
  return {
    profile: config.profile,
    origin: config.origin,
    previewOrigin: config.previewOrigin ?? null,
    proxyHops: config.trustedProxyHops,
    capabilities: [...capabilityPolicy(config.profile).summary().capabilities],
    adapters: { catalog },
    secrets: {
      PORTFOLIO_AUTH_PASSWORD_HASH: config.secrets.authPasswordHash ? 'set' : 'unset',
      GITHUB_TOKEN: config.secrets.githubToken ? 'set' : 'unset',
    },
  };
}
