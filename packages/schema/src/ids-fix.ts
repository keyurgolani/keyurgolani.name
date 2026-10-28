import { applyEdits, type Edit } from './edit';
import { isSectionId, mintId, slugifyTitle, type IdKind } from './ids';
import { isPlainObject } from './json';
import { detectDocument } from './legacy';
import { toPointer } from './pointer';
import { documentEntries, type IdOwner } from './record-ids';
import { parseSource, type DocumentFormat } from './source';
import { PORTFOLIO_SCHEMA_VERSION } from './versions';

// `pnpm config:ids-fix` (#10, item 3): gives every section, record, and media
// asset that lacks a well-formed id one of its own, minted with mintId(), by
// editing the source text, so a YAML document keeps its comments and every
// untouched byte, and both formats keep their key order. A new `id` goes
// last in its entry. A malformed id's references in the document follow it.
// Pure: text in, text and the fixes out.

/** One id the fix set. */
export interface IdFix {
  /** Where it is: `/<list>/<index>/id`. */
  readonly pointer: string;
  readonly id: string;
  /** `missing`: no id. `invalid`: not a well-formed id. `repeated`: an earlier entry has it. */
  readonly reason: 'missing' | 'invalid' | 'repeated';
  /** For an invalid id, the references it renamed with it. */
  readonly references: readonly string[];
}

export type IdsFixResult =
  | { readonly ok: true; readonly text: string; readonly fixes: readonly IdFix[] }
  | { readonly ok: false; readonly reasons: readonly string[] };

const MINT_KIND: Readonly<Record<IdOwner, IdKind>> = {
  section: 'section',
  work: 'work',
  evidence: 'evidence',
  chronology: 'chronology',
  media: 'media',
};

type Rec = Record<string, unknown>;
type Path = readonly (string | number)[];

const text = (value: unknown) =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

/** What an entry's id is minted from: its title, or what stands for one. */
function titleOf(owner: IdOwner, entry: Rec): string | undefined {
  switch (owner) {
    case 'section':
      return text(entry.title) ?? text(entry.kind)?.replace(/^.*\//, '');
    case 'work':
      return text(entry.title);
    case 'evidence':
      return (
        text(entry.title) ??
        (isPlainObject(entry.source) ? text(entry.source.name) : undefined) ??
        text(entry.statement)?.split(/\s+/).slice(0, 8).join(' ')
      );
    case 'chronology':
      return [text(entry.title), text(entry.organization)].filter(Boolean).join(' ') || undefined;
    case 'media': {
      const source = text(entry.source);
      if (!source) return undefined;
      const path = /^https:/i.test(source) ? source.replace(/^https:\/\/[^/]+/i, '') : source;
      return path.replace(/[?#].*$/, '').replace(/\.[A-Za-z0-9]+$/, '');
    }
  }
}

/** Where each owner's references sit, by the record type they name. */
function references(portfolio: Rec): Array<{ path: Path; value: unknown; target: IdOwner }> {
  const found: Array<{ path: Path; value: unknown; target: IdOwner }> = [];
  const at = (path: Path, value: unknown, target: IdOwner) => found.push({ path, value, target });
  const list = (path: Path, values: unknown, target: IdOwner) => {
    if (Array.isArray(values))
      values.forEach((value, index) => at([...path, index], value, target));
  };
  const placement = (path: Path, value: unknown) => {
    if (isPlainObject(value)) at([...path, 'asset'], value.asset, 'media');
  };
  const placements = (path: Path, values: unknown) => {
    if (Array.isArray(values)) values.forEach((value, index) => placement([...path, index], value));
  };
  const lists = (key: string) =>
    Array.isArray(portfolio[key]) ? (portfolio[key] as unknown[]) : [];
  at(['signature'], portfolio.signature, 'work');
  list(['featured'], portfolio.featured, 'work');
  list(['proof'], portfolio.proof, 'evidence');
  list(['archive'], portfolio.archive, 'work');
  if (isPlainObject(portfolio.identity))
    placement(['identity', 'avatar'], portfolio.identity.avatar);
  if (isPlainObject(portfolio.meta)) placement(['meta', 'ogImage'], portfolio.meta.ogImage);
  lists('works').forEach((work, index) => {
    if (!isPlainObject(work)) return;
    placement(['works', index, 'cover'], work.cover);
    placements(['works', index, 'media'], work.media);
    list(['works', index, 'evidence'], work.evidence, 'evidence');
  });
  lists('evidence').forEach((evidence, index) => {
    if (isPlainObject(evidence) && isPlainObject(evidence.source)) {
      placement(['evidence', index, 'source', 'avatar'], evidence.source.avatar);
    }
  });
  lists('chronology').forEach((entry, index) => {
    if (!isPlainObject(entry)) return;
    placement(['chronology', index, 'logo'], entry.logo);
    at(['chronology', index, 'branchesFrom'], entry.branchesFrom, 'chronology');
    at(['chronology', index, 'mergesInto'], entry.mergesInto, 'chronology');
    list(['chronology', index, 'works'], entry.works, 'work');
  });
  lists('sections').forEach((section, index) => {
    if (!isPlainObject(section)) return;
    const kind = section.kind;
    if (kind === 'works' || kind === 'evidence' || kind === 'chronology') {
      list(['sections', index, 'items'], section.items, kind === 'works' ? 'work' : kind);
    } else if (kind === 'custom' && Array.isArray(section.items)) {
      section.items.forEach((item, position) => {
        if (!isPlainObject(item)) return;
        placements(['sections', index, 'items', position, 'media'], item.media);
        list(['sections', index, 'items', position, 'evidence'], item.evidence, 'evidence');
      });
    }
  });
  return found;
}

/**
 * Mints an id for every entry of a version 3 portfolio document that has
 * none, has one that isn't well formed, or repeats an earlier entry's, in
 * document order. Well-formed first uses keep theirs. A malformed id's
 * references, wherever the document names that record type, follow it; a
 * repeated id's references keep naming the first entry.
 */
export function fixIds(source: {
  readonly text: string;
  readonly format: DocumentFormat;
}): IdsFixResult {
  const parsed = parseSource(source.text, source.format);
  if (!parsed.ok) {
    return {
      ok: false,
      reasons: parsed.problems.map(({ message, line, column }) =>
        line === undefined ? message : `Line ${line}, column ${column}: ${message}`,
      ),
    };
  }
  const data = parsed.data;
  if (detectDocument(data) !== 'portfolio' || !isPlainObject(data)) {
    return {
      ok: false,
      reasons: [
        "It isn't a portfolio document. pnpm config:ids-fix gives ids in portfolio.yml or portfolio.json.",
      ],
    };
  }
  if (data.schemaVersion !== PORTFOLIO_SCHEMA_VERSION) {
    return {
      ok: false,
      reasons: [
        `It isn't a schemaVersion ${PORTFOLIO_SCHEMA_VERSION} portfolio document. Run pnpm config:migrate on it first, which mints every id.`,
      ],
    };
  }

  const entries = documentEntries(data);
  const taken = new Set<string>();
  const firsts = new Set<number>();
  entries.forEach((entry, index) => {
    if (typeof entry.id === 'string' && isSectionId(entry.id) && !taken.has(entry.id)) {
      taken.add(entry.id);
      firsts.add(index);
    }
  });
  const refs = references(data);
  const edits: Edit[] = [];
  const fixes: IdFix[] = [];
  // The malformed ids whose references already follow an entry, the first
  // that had each, by the record type they name.
  const followed = new Set<string>();
  entries.forEach((entry, index) => {
    if (firsts.has(index)) return;
    const record = valueAt(data, entry.path);
    if (!isPlainObject(record)) return;
    const reason: IdFix['reason'] =
      entry.id === undefined
        ? 'missing'
        : typeof entry.id === 'string' && isSectionId(entry.id)
          ? 'repeated'
          : 'invalid';
    const fromId =
      reason === 'invalid' && typeof entry.id === 'string' ? slugifyTitle(entry.id) : '';
    const id = mintId(MINT_KIND[entry.owner], fromId || titleOf(entry.owner, record), taken);
    taken.add(id);
    const pointer = toPointer([...entry.path, 'id']);
    edits.push({ op: 'set', pointer, value: id });
    const renamed: string[] = [];
    const target = entry.owner === 'section' ? undefined : entry.owner;
    const key = `${target}\u0000${String(entry.id)}`;
    if (reason === 'invalid' && typeof entry.id === 'string' && !followed.has(key)) {
      followed.add(key);
      for (const reference of refs) {
        if (reference.value === entry.id && reference.target === target) {
          const at = toPointer(reference.path);
          edits.push({ op: 'set', pointer: at, value: id });
          renamed.push(at);
        }
      }
    }
    fixes.push({ pointer, id, reason, references: renamed });
  });
  if (edits.length === 0) return { ok: true, text: source.text, fixes };
  try {
    return { ok: true, text: applyEdits(source.text, source.format, edits), fixes };
  } catch (error) {
    return { ok: false, reasons: [`The ids can't be written: ${(error as Error).message}`] };
  }
}

function valueAt(root: unknown, path: Path): unknown {
  let node = root;
  for (const segment of path) {
    if (Array.isArray(node)) node = node[Number(segment)];
    else if (isPlainObject(node)) node = Object.hasOwn(node, segment) ? node[segment] : undefined;
    else return undefined;
  }
  return node;
}
