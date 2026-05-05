import path from 'node:path';
import fs from 'node:fs/promises';

const WORKSPACE_ROOT = path.resolve(process.cwd(), '..', '..');
const DEFAULT_FILENAMES = ['portfolio.yml', 'portfolio.yaml', 'portfolio.toml', 'portfolio.json'];

/**
 * Resolve the active portfolio file path.
 *
 * Priority:
 *   1. PORTFOLIO_PATH env var (absolute or relative to cwd)
 *   2. First existing file at workspace root matching one of the default names
 *   3. Falls back to <workspace-root>/portfolio.yml (which may not exist yet)
 */
export async function resolvePortfolioPath(): Promise<string> {
  const fromEnv = process.env.PORTFOLIO_PATH;
  if (fromEnv) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.resolve(process.cwd(), fromEnv);
  }

  for (const name of DEFAULT_FILENAMES) {
    const candidate = path.join(WORKSPACE_ROOT, name);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try next
    }
  }

  return path.join(WORKSPACE_ROOT, 'portfolio.yml');
}

export function workspaceRoot(): string {
  return WORKSPACE_ROOT;
}

export async function resolveExamplePortfolioPath(): Promise<string | null> {
  const candidate = path.join(WORKSPACE_ROOT, 'portfolio.example.yml');
  try {
    await fs.access(candidate);
    return candidate;
  } catch {
    return null;
  }
}
