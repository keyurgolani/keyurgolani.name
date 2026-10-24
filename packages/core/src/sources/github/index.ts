import { readFileSync } from 'node:fs';
import {
  GitHubSnapshotDataSchema,
  isPlainObject,
  isSectionId,
  snapshotRecords,
  type GitHubSnapshot,
  type GitHubSnapshotData,
  type SnapshotRecord,
} from '@portfolio/schema';
import { recordOwnerModule } from '../../load-trace';
import { GITHUB_REFRESH_BUDGET_MS, type FetchLike } from './fetch';
import { fetchViaGraphQL } from './graphql';
import { fetchViaREST } from './rest';
import type { FetchGitHubDataInput, GitHubData } from './types';

// The GitHub adapter (#10, item 8; threat row github-3): the only code that
// reads GITHUB_TOKEN, and the only code that calls GitHub. It runs on the
// owner's side, when the owner refreshes a draft from Studio or with
// `portfolio-store sources refresh`, never for a visitor: what it fetches
// goes into the draft as a `github` snapshot record per section, and
// renderers read only what a publish froze. A refresh with no token does
// nothing and says so; a section whose fetch fails or answers data that
// doesn't check keeps the record it had. Nothing it reports names the token.

recordOwnerModule('core/sources/github/index');

export {
  GITHUB_BODY_MAX_BYTES,
  GITHUB_FETCH_TIMEOUT_MS,
  GITHUB_REFRESH_BUDGET_MS,
  readJson,
  timedFetch,
} from './fetch';
export type { FetchLike } from './fetch';

/** Why a refresh, or one section's, didn't change what the draft holds. */
export interface GitHubRefreshFinding {
  readonly code: 'token_unset' | 'fetch_failed' | 'data_invalid';
  /** The section it's about; absent for one about the whole refresh. */
  readonly sectionId?: string;
}

export interface GitHubRefresh {
  /** The draft's new `github` snapshot, or null when the refresh changed nothing, as with no token. */
  readonly snapshot: GitHubSnapshot | null;
  /** The sections whose data was fetched now. */
  readonly refreshed: readonly string[];
  readonly findings: readonly GitHubRefreshFinding[];
}

export interface GitHubAdapter {
  /**
   * Fetches each GitHub section of `portfolio`, a draft's parsed model,
   * over `previous`, the draft's `github` snapshot: one record per section,
   * the last one kept for a section whose fetch fails.
   */
  refresh(portfolio: unknown, previous: unknown): Promise<GitHubRefresh>;
}

export interface GitHubAdapterOptions {
  /** GITHUB_TOKEN, as the deployment holds it. Without one, a refresh does nothing. */
  readonly token?: string;
  /** Node's fetch by default. Tests pass a stub that never leaves the process. */
  readonly fetch?: FetchLike;
  readonly now?: () => number;
}

/**
 * GITHUB_TOKEN from `env`, or the file GITHUB_TOKEN_FILE names, trimmed, as
 * the server reads it, or undefined. The command line reads the token here,
 * and nowhere else does.
 */
export function githubTokenFrom(
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const direct = env.GITHUB_TOKEN?.trim();
  if (direct) return direct;
  const file = env.GITHUB_TOKEN_FILE?.trim();
  if (!file) return undefined;
  try {
    return readFileSync(file, 'utf8').trim() || undefined;
  } catch {
    return undefined;
  }
}

/** A GitHub section's settings, as the fetchers take them, from a leniently read section. */
function sectionInput(section: Record<string, unknown>): FetchGitHubDataInput | null {
  if (typeof section.username !== 'string' || section.username.trim() === '') return null;
  const names = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((name): name is string => typeof name === 'string')
      : undefined;
  const flag = (value: unknown) => (typeof value === 'boolean' ? value : undefined);
  const input: Record<string, unknown> = { username: section.username.trim() };
  for (const key of [
    'showContributionGraph',
    'showPinnedRepos',
    'showTotalStars',
    'showLanguageBreakdown',
    'showRecentlyActive',
  ] as const) {
    if (flag(section[key]) !== undefined) input[key] = section[key];
  }
  if (typeof section.recentlyActiveLimit === 'number') {
    input.recentlyActiveLimit = section.recentlyActiveLimit;
  }
  const featured = names(section.featuredRepos);
  const excluded = names(section.excludeRepos);
  if (featured) input.featuredRepos = featured;
  if (excluded) input.excludeRepos = excluded;
  return input as unknown as FetchGitHubDataInput;
}

/** The GitHub sections of a portfolio model, in order, each id once. */
function githubSections(portfolio: unknown): { id: string; input: FetchGitHubDataInput }[] {
  const sections =
    isPlainObject(portfolio) && Array.isArray(portfolio.sections) ? portfolio.sections : [];
  const seen = new Set<string>();
  const found: { id: string; input: FetchGitHubDataInput }[] = [];
  for (const section of sections) {
    if (!isPlainObject(section) || section.kind !== 'github') continue;
    if (typeof section.id !== 'string' || !isSectionId(section.id) || seen.has(section.id))
      continue;
    const input = sectionInput(section);
    if (!input) continue;
    seen.add(section.id);
    found.push({ id: section.id, input });
  }
  return found;
}

export function githubAdapter({
  token,
  fetch: fetchFn = (url, init) => fetch(url, init),
  now = Date.now,
}: GitHubAdapterOptions): GitHubAdapter {
  /** One section's data, or null when GitHub didn't answer with it. */
  async function fetchOne(input: FetchGitHubDataInput, key: string): Promise<GitHubData | null> {
    // Every request below shares one budget, on top of its own timeout.
    const budget = AbortSignal.timeout(GITHUB_REFRESH_BUDGET_MS);
    const viaGraphQL = await fetchViaGraphQL(input, key, budget, fetchFn).catch(() => null);
    if (viaGraphQL) return viaGraphQL;
    return fetchViaREST(input, budget, fetchFn).catch(() => null);
  }

  return {
    async refresh(portfolio, previous) {
      if (!token) return { snapshot: null, refreshed: [], findings: [{ code: 'token_unset' }] };
      const before = snapshotRecords(previous);
      const records: SnapshotRecord<GitHubSnapshotData>[] = [];
      const refreshed: string[] = [];
      const findings: GitHubRefreshFinding[] = [];
      for (const { id, input } of githubSections(portfolio)) {
        const keep = (code: GitHubRefreshFinding['code']) => {
          findings.push({ code, sectionId: id });
          // Only the same account's: after a username edit, the last record
          // is another account's data.
          const last = before.get(id);
          const account = (value: unknown) =>
            typeof value === 'string' ? value.trim().toLowerCase() : null;
          if (
            last &&
            isPlainObject(last.data) &&
            account(last.data.username) === account(input.username)
          ) {
            records.push(last as unknown as SnapshotRecord<GitHubSnapshotData>);
          }
        };
        const fetched = await fetchOne(input, token);
        if (!fetched) {
          keep('fetch_failed');
          continue;
        }
        // The record carries when it was fetched; the data doesn't.
        const data: Record<string, unknown> = { ...fetched };
        delete data.fetchedAt;
        const checked = GitHubSnapshotDataSchema.safeParse(data);
        if (!checked.success) {
          keep('data_invalid');
          continue;
        }
        records.push({
          adapter: 'github',
          sectionId: id,
          data: checked.data,
          fetchedAt: new Date(now()).toISOString(),
        });
        refreshed.push(id);
      }
      return { snapshot: { records }, refreshed, findings };
    },
  };
}
