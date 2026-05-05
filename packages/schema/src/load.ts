import { parse as parseYaml } from 'yaml';
import { parse as parseToml } from 'smol-toml';
import { PortfolioSchema, type Portfolio } from './portfolio';

export type PortfolioFormat = 'yaml' | 'toml' | 'json';

export function detectFormat(filename: string): PortfolioFormat {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml';
  if (lower.endsWith('.toml')) return 'toml';
  if (lower.endsWith('.json')) return 'json';
  throw new Error(`Cannot detect portfolio format from filename: ${filename}`);
}

export function parsePortfolio(source: string, format: PortfolioFormat): Portfolio {
  let raw: unknown;
  switch (format) {
    case 'yaml':
      raw = parseYaml(source);
      break;
    case 'toml':
      raw = parseToml(source);
      break;
    case 'json':
      raw = JSON.parse(source);
      break;
  }
  return PortfolioSchema.parse(raw);
}

export function safeParsePortfolio(source: string, format: PortfolioFormat) {
  let raw: unknown;
  try {
    switch (format) {
      case 'yaml':
        raw = parseYaml(source);
        break;
      case 'toml':
        raw = parseToml(source);
        break;
      case 'json':
        raw = JSON.parse(source);
        break;
    }
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : String(error),
      stage: 'parse' as const,
    };
  }
  const result = PortfolioSchema.safeParse(raw);
  if (!result.success) {
    return {
      success: false as const,
      error: result.error.message,
      stage: 'validate' as const,
      issues: result.error.issues,
    };
  }
  return { success: true as const, data: result.data };
}
