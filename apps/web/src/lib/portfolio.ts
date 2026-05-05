import fs from 'node:fs/promises';
import {
  detectFormat,
  parsePortfolio,
  safeParsePortfolio,
  type Portfolio,
  type PortfolioFormat,
} from '@portfolio/schema';
import { resolvePortfolioPath, resolveExamplePortfolioPath } from './paths';

export interface LoadedPortfolio {
  portfolio: Portfolio;
  source: string;
  format: PortfolioFormat;
  path: string;
}

/**
 * Load and validate the active portfolio file. If it doesn't exist, fall back
 * to the bundled example so the host always renders something. If validation
 * fails, throws — let the caller decide what to surface.
 */
export async function loadPortfolio(): Promise<LoadedPortfolio> {
  let activePath = await resolvePortfolioPath();
  let raw: string;
  try {
    raw = await fs.readFile(activePath, 'utf8');
  } catch {
    const examplePath = await resolveExamplePortfolioPath();
    if (!examplePath) {
      throw new Error(
        `No portfolio file found at ${activePath} and no example available. ` +
          `Set PORTFOLIO_PATH or place a portfolio.yml at the workspace root.`,
      );
    }
    activePath = examplePath;
    raw = await fs.readFile(activePath, 'utf8');
  }
  const format = detectFormat(activePath);
  const portfolio = parsePortfolio(raw, format);
  return { portfolio, source: raw, format, path: activePath };
}

export async function loadPortfolioRaw(): Promise<{ source: string; path: string; format: PortfolioFormat }> {
  const path = await resolvePortfolioPath();
  const source = await fs.readFile(path, 'utf8');
  const format = detectFormat(path);
  return { source, path, format };
}

export async function savePortfolioRaw(source: string): Promise<{ ok: true } | { ok: false; error: string; issues?: unknown[] }> {
  const path = await resolvePortfolioPath();
  const format = detectFormat(path);
  const result = safeParsePortfolio(source, format);
  if (!result.success) {
    return { ok: false, error: result.error, issues: 'issues' in result ? result.issues : undefined };
  }
  await fs.writeFile(path, source, 'utf8');
  return { ok: true };
}
