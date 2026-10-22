import { mintId, type IdKind } from '../ids';
import { isJsonEqual, isPlainObject } from '../json';
import { toPointer } from '../pointer';
import { PORTFOLIO_SCHEMA_VERSION } from '../versions';
import type { Change, Need } from './types';

// The 2-to-3 step (#10, items 2 and 6): a version 2 portfolio document to the
// version 3 content model. Section ids stay byte for byte; each baseline
// section keeps its position, id, title, and subtitle as a section of its
// items' new type, `contact`, or `practice`. Items become records, and image
// sources media assets, each with an id minted here once, in document order,
// from content, so the same input always mints the same ids. Pure.

type Rec = Record<string, unknown>;
type Path = readonly (string | number)[];

/** An id the step minted: a record's or a media asset's. */
export interface MintedId {
  readonly id: string;
  readonly owner: 'work' | 'evidence' | 'chronology' | 'media';
  /** Where it is in the new portfolio. */
  readonly pointer: string;
  /** What it came from in the old one. */
  readonly from: string;
}

export interface V3StepResult {
  readonly portfolio: Rec;
  readonly changes: Change[];
  readonly minted: MintedId[];
  /** Values only the owner can give, by `--set` path. */
  readonly needs: Need[];
}

export interface V3StepOptions {
  /**
   * The ids of the sections the site document hides. Hidden content never
   * merges into a practice part or the contact record a visible section
   * shows, since in version 3 those are top-level.
   */
  readonly hidden?: ReadonlySet<string>;
}

/** The v2 kinds whose items become works, with each one's default medium. */
const WORK_KINDS: Readonly<Record<string, string>> = {
  projects: 'software',
  writings: 'writing',
  discography: 'music',
  episodes: 'audio-video',
};

/** The v2 kinds whose items become evidence, with the evidence type. */
const EVIDENCE_KINDS: Readonly<Record<string, string>> = {
  publications: 'publication',
  talks: 'talk',
  awards: 'award',
  patents: 'patent',
  press: 'press',
  testimonials: 'testimonial',
  'external-portfolios': 'external-work',
  stats: 'metric',
  tenure: 'metric',
};

const CHRONOLOGY_KINDS: Readonly<Record<string, string>> = {
  experience: 'role',
  education: 'study',
};

/** The v2 kinds whose groups join one part of the practice. */
const PRACTICE_KINDS: Readonly<Record<string, 'skills' | 'tools' | 'services'>> = {
  skills: 'skills',
  stack: 'tools',
  services: 'services',
};

const UNCHANGED_KINDS = new Set([
  'github',
  'hero',
  'lede',
  'now',
  'quote',
  'focus',
  'fun-facts',
  'cta',
]);

/** A version 2 image's keys. */
const IMAGE_KEYS = new Set(['src', 'alt', 'width', 'height', 'credit', 'focalPoint', 'extensions']);

/** How each item field carries over: the same name, or a new one. A dotted name nests. */
type FieldMap = Readonly<Record<string, string>>;

const same = (...keys: string[]): FieldMap => Object.fromEntries(keys.map((key) => [key, key]));

const ITEM_FIELDS: Readonly<Record<string, FieldMap>> = {
  projects: {
    ...same(
      'summary',
      'description',
      'period',
      'role',
      'organization',
      'links',
      'highlights',
      'extensions',
    ),
    name: 'title',
    technologies: 'tools',
  },
  writings: same(
    'title',
    'summary',
    'excerpt',
    'publication',
    'publishedAt',
    'url',
    'readingTimeMinutes',
    'tags',
    'extensions',
  ),
  discography: same(
    'title',
    'artist',
    'role',
    'releasedAt',
    'label',
    'description',
    'tracks',
    'links',
    'extensions',
  ),
  episodes: same(
    'number',
    'title',
    'publishedAt',
    'durationMinutes',
    'description',
    'showNotes',
    'guests',
    'audioUrl',
    'videoUrl',
    'links',
    'extensions',
  ),
  publications: same(
    'title',
    'authors',
    'venue',
    'publishedAt',
    'abstract',
    'citation',
    'doi',
    'url',
    'pdfUrl',
    'awards',
    'extensions',
  ),
  talks: {
    ...same(
      'title',
      'venue',
      'location',
      'presentedAt',
      'description',
      'abstract',
      'slidesUrl',
      'videoUrl',
      'links',
      'extensions',
    ),
    type: 'format',
  },
  awards: {
    ...same('organization', 'receivedAt', 'description', 'url', 'extensions'),
    name: 'title',
  },
  patents: same(
    'title',
    'number',
    'status',
    'filedAt',
    'grantedAt',
    'inventors',
    'assignee',
    'description',
    'url',
    'extensions',
  ),
  press: same('title', 'publication', 'publishedAt', 'excerpt', 'url', 'author', 'extensions'),
  testimonials: {
    quote: 'statement',
    author: 'source.name',
    authorRole: 'source.role',
    authorOrganization: 'source.organization',
    authorUrl: 'source.url',
    sourceUrl: 'url',
    extensions: 'extensions',
  },
  'external-portfolios': {
    ...same(
      'url',
      'description',
      'locationLabel',
      'categories',
      'highlights',
      'urlLabel',
      'buttonText',
      'iconName',
      'extensions',
    ),
    brandName: 'title',
  },
  experience: {
    ...same(
      'organization',
      'organizationUrl',
      'location',
      'period',
      'description',
      'highlights',
      'skills',
      'extensions',
    ),
    role: 'title',
  },
  education: {
    ...same('field', 'location', 'period', 'description', 'achievements', 'extensions'),
    degree: 'title',
    institution: 'organization',
    institutionUrl: 'organizationUrl',
  },
};

/** The image fields of each kind's items, and whether their placements are decorative. */
const ITEM_IMAGES: Readonly<
  Record<string, Readonly<Record<string, { target: string; decorative: boolean; list?: boolean }>>>
> = {
  projects: {
    image: { target: 'cover', decorative: false },
    images: { target: 'media', decorative: false, list: true },
  },
  discography: { cover: { target: 'cover', decorative: false } },
  testimonials: { authorAvatar: { target: 'source.avatar', decorative: true } },
  experience: { logo: { target: 'logo', decorative: true } },
  education: { logo: { target: 'logo', decorative: true } },
};

/** What each kind's notes say its items became. */
const RENAMES: Readonly<Record<string, string>> = {
  projects:
    ' Its name is the title, technologies are tools, image is the cover, and images are media placements.',
  awards: ' Its name is the title.',
  talks: ' Its type is the format.',
  testimonials:
    ' The quote is the statement, the author the source name, and the author fields the source.',
  'external-portfolios': ' Its brandName is the title.',
  experience: ' Its role is the title.',
  education: ' Its degree is the title, and the institution the organization.',
};

/** Whether a stat's value is a number, written as one or as decimal digits. */
function numericValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim())) {
    return Number(value.trim());
  }
  return undefined;
}

/** A v2 image src as a media source: /assets/ and other root paths become media-root paths. */
function mediaSource(src: string): string {
  if (src.startsWith('/assets/')) return src.slice('/assets/'.length);
  if (/^\/[^/\\]/.test(src)) return src.slice(1);
  return src;
}

function setOwn(record: Rec, key: string, value: unknown): void {
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/** Sets `a.b` style paths, making the mappings on the way. */
function setDotted(record: Rec, dotted: string, value: unknown): void {
  const keys = dotted.split('.');
  let node = record;
  for (const key of keys.slice(0, -1)) {
    if (!isPlainObject(node[key])) setOwn(node, key, {});
    node = node[key] as Rec;
  }
  setOwn(node, keys.at(-1)!, value);
}

export function v3Step(v2: Rec, options: V3StepOptions = {}): V3StepResult {
  const changes: Change[] = [];
  const needs: Need[] = [];
  const minted: MintedId[] = [];
  const hidden = options.hidden ?? new Set<string>();
  const data = withoutBlanks(v2, changes);
  const sections: unknown[] = Array.isArray(data.sections) ? data.sections : [];

  // Every id the document will hold: its sections' first, kept as they are.
  const taken = new Set<string>();
  for (const section of sections) {
    if (isPlainObject(section) && typeof section.id === 'string') taken.add(section.id);
  }
  const mint = (kind: IdKind, title: unknown): string => {
    const id = mintId(kind, typeof title === 'string' ? title : undefined, taken);
    taken.add(id);
    return id;
  };

  const works: Rec[] = [];
  const evidence: Rec[] = [];
  const chronology: Rec[] = [];
  const media: Rec[] = [];
  const assets = new Map<string, Rec>();
  const practice: Record<'skills' | 'tools' | 'services', Rec[]> = {
    skills: [],
    tools: [],
    services: [],
  };
  const record = (list: Rec[], owner: MintedId['owner'], rec: Rec, from: string, name: string) => {
    list.push(rec);
    const pointer = `/${name}/${list.length - 1}`;
    minted.push({ id: rec.id as string, owner, pointer, from });
    return pointer;
  };
  const warn = (from: string, note: string) => changes.push({ code: 'warned', from, note });
  const removed = (from: string, note: string) => changes.push({ code: 'removed', from, note });

  /**
   * One use of a v2 image, as a placement of its media asset. The first use
   * of each source makes the asset, with its alt text, credit, and focal
   * point; a later use keeps a differing alt text or focal point on the
   * placement, and a differing credit is reported.
   */
  const place = (
    image: unknown,
    path: Path,
    title: string,
    decorative: boolean,
  ): Rec | undefined => {
    const from = toPointer(path);
    if (!isPlainObject(image) || typeof image.src !== 'string') {
      removed(from, "It isn't an image with a src, so no media asset holds it.");
      return undefined;
    }
    const source = mediaSource(image.src);
    let asset = assets.get(source);
    const created = asset === undefined;
    if (asset === undefined) {
      asset = { id: mint('media', title), kind: 'image', source };
      if (image.alt === '') asset.decorative = true;
      else if (typeof image.alt === 'string') asset.alt = image.alt;
      if (typeof image.credit === 'string') asset.credit = image.credit;
      if (isPlainObject(image.focalPoint)) asset.focalPoint = image.focalPoint;
      if (isPlainObject(image.extensions)) asset.extensions = image.extensions;
      assets.set(source, asset);
      const pointer = record(media, 'media', asset, from, 'media');
      changes.push({
        code: 'mapped',
        from,
        to: { document: 'portfolio', pointer },
        note: `The image is the media asset ${asset.id}, which takes its alt text, credit, and focal point from this, its first use.${source === image.src ? '' : ' Its path is a path under the media root now.'}`,
      });
    }
    const placement: Rec = { asset: asset.id };
    const assetDecorative = asset.decorative === true;
    if (decorative) {
      placement.decorative = true;
    } else if (image.alt === '') {
      if (!assetDecorative) placement.decorative = true;
    } else if (typeof image.alt === 'string') {
      if (image.alt !== asset.alt) placement.alt = image.alt;
      if (assetDecorative) placement.decorative = false;
    }
    if (isPlainObject(image.focalPoint) && !isJsonEqual(image.focalPoint, asset.focalPoint)) {
      placement.focalPoint = image.focalPoint;
    }
    if (typeof image.credit === 'string' && image.credit !== asset.credit) {
      warn(
        `${from}/credit`,
        `Its credit differs from the first use of the same image, and the media asset ${asset.id} keeps the first one's. Credit belongs to the asset.`,
      );
    }
    if (image.width !== undefined || image.height !== undefined) {
      removed(`${from}/width`, 'Image dimensions come from the media document now.');
    }
    if (
      !created &&
      isPlainObject(image.extensions) &&
      !isJsonEqual(image.extensions, asset.extensions)
    ) {
      placement.extensions = image.extensions;
    }
    for (const key of Object.keys(image)) {
      if (!IMAGE_KEYS.has(key))
        removed(`${from}/${key}`, 'Version 3 has no place for it on an image.');
    }
    const effectiveDecorative = (placement.decorative as boolean | undefined) ?? assetDecorative;
    const alt = (placement.alt as string | undefined) ?? (asset.alt as string | undefined);
    if (!effectiveDecorative && alt === undefined) {
      warn(
        from,
        "It has no alt text. Give the asset alt text, or decorative: true if it's only decoration.",
      );
    }
    return placement;
  };

  /** An item's fields carried to a record, with every other field reported. */
  const carry = (kind: string, item: Rec, target: Rec, path: Path) => {
    const fields = ITEM_FIELDS[kind] ?? {};
    const images = ITEM_IMAGES[kind] ?? {};
    for (const [key, value] of Object.entries(item)) {
      if (Object.hasOwn(images, key)) continue;
      const to = fields[key];
      if (to === undefined) {
        removed(toPointer([...path, key]), `Version 3 has no place for it on a ${kind} item.`);
      } else {
        setDotted(target, to, value);
      }
    }
  };

  const imagesOf = (kind: string, item: Rec, target: Rec, path: Path, owner: string) => {
    const images = ITEM_IMAGES[kind] ?? {};
    for (const [key, { target: to, decorative, list }] of Object.entries(images)) {
      const value = item[key];
      if (value === undefined) continue;
      const role =
        to === 'cover'
          ? 'cover'
          : to === 'logo'
            ? 'logo'
            : to === 'source.avatar'
              ? 'avatar'
              : 'image';
      if (list) {
        const placements = (Array.isArray(value) ? value : [])
          .map((image, index) =>
            place(image, [...path, key, index], `${owner} ${role}`, decorative),
          )
          .filter((placement): placement is Rec => placement !== undefined);
        if (placements.length > 0) setDotted(target, to, placements);
      } else {
        const placement = place(value, [...path, key], `${owner} ${role}`, decorative);
        if (placement) setDotted(target, to, placement);
      }
    }
  };

  const portfolio: Rec = { schemaVersion: PORTFOLIO_SCHEMA_VERSION };
  for (const key of Object.keys(data)) {
    if (key === 'schemaVersion' || key === 'sections') continue;
    if (key === 'identity' && isPlainObject(data.identity)) {
      const { avatar, ...identity } = data.identity;
      const out: Rec = { ...identity };
      if (avatar !== undefined) {
        const placement = place(avatar, ['identity', 'avatar'], 'avatar', false);
        if (placement) out.avatar = placement;
      }
      portfolio.identity = out;
    } else if (key === 'meta' && isPlainObject(data.meta)) {
      const { ogImage, ...meta } = data.meta;
      const out: Rec = { ...meta };
      if (ogImage !== undefined) {
        const placement = place(ogImage, ['meta', 'ogImage'], 'og image', false);
        if (placement) out.ogImage = placement;
      }
      portfolio.meta = out;
    } else {
      portfolio[key] = data[key];
    }
  }

  // Which practice kinds a visible section has: a hidden section's groups
  // never merge into a part a visible section shows.
  const visiblePractice = new Set<string>();
  for (const section of sections) {
    if (
      isPlainObject(section) &&
      typeof section.kind === 'string' &&
      PRACTICE_KINDS[section.kind]
    ) {
      if (!hidden.has(String(section.id))) visiblePractice.add(PRACTICE_KINDS[section.kind]!);
    }
  }
  const practiceSeen = new Map<string, number>();
  const contactSections = sections
    .map((section, index) => ({ section, index }))
    .filter(
      ({ section }) =>
        isPlainObject(section) &&
        section.kind === 'contact' &&
        ['message', 'links'].some((key) => section[key] !== undefined),
    );
  const contactSource =
    contactSections.find(({ section }) => !hidden.has(String((section as Rec).id))) ??
    contactSections[0];
  let contact: Rec | undefined;

  const v3Sections = sections.map((section, index): unknown => {
    if (!isPlainObject(section) || typeof section.kind !== 'string') return section;
    const at: Path = ['sections', index];
    const from = toPointer(at);
    const { kind } = section;
    const base = sectionBase(section);
    const items = Array.isArray(section.items) ? section.items : [];
    const isHidden = hidden.has(String(section.id));
    const lang = typeof section.lang === 'string' ? { lang: section.lang } : {};
    const extra = (keys: readonly string[]) => {
      for (const key of Object.keys(section)) {
        if (!['kind', 'id', 'title', 'subtitle', 'lang', 'extensions', ...keys].includes(key)) {
          removed(`${from}/${key}`, `Version 3 has no place for a ${kind} section's ${key}.`);
        }
      }
    };

    if (UNCHANGED_KINDS.has(kind)) {
      actionNeeds(section, index, needs);
      return section;
    }

    const medium = WORK_KINDS[kind];
    if (medium !== undefined) {
      extra(kind === 'episodes' ? ['items', 'showName', 'showDescription'] : ['items']);
      if (section.showDescription !== undefined) {
        removed(`${from}/showDescription`, 'Version 3 has no place for a show description.');
      }
      const ids = items.map((item, position) => {
        const path = [...at, 'items', position];
        if (!isPlainObject(item)) {
          removed(toPointer(path), "It isn't an item, so no work holds it.");
          return undefined;
        }
        const title = kind === 'projects' ? item.name : item.title;
        const work: Rec = { id: mint('work', title), medium, ...lang };
        carry(kind, item, work, path);
        if (kind === 'episodes' && typeof section.showName === 'string')
          work.series = section.showName;
        imagesOf(kind, item, work, path, work.id as string);
        const pointer = record(works, 'work', work, toPointer(path), 'works');
        changes.push({
          code: 'mapped',
          from: toPointer(path),
          to: { document: 'portfolio', pointer },
          note: `The ${kind} item is the work ${work.id}, medium ${medium}.${RENAMES[kind] ?? ''}`,
        });
        return work.id as string;
      });
      return worksSection(base, ids, kind, from, changes);
    }

    if (kind === 'gallery') {
      extra(['items', 'layout']);
      if (section.layout !== undefined) {
        removed(`${from}/layout`, 'The layout is presentation, which a composition decides now.');
      }
      const id = mint('work', section.title);
      const work: Rec = {
        id,
        ...(typeof section.title === 'string' ? { title: section.title } : {}),
        medium: 'image-series',
        ...lang,
      };
      const placements = items
        .map((item, position) => {
          const path = [...at, 'items', position];
          if (!isPlainObject(item)) {
            removed(toPointer(path), "It isn't a gallery item, so no placement holds it.");
            return undefined;
          }
          const placement = place(item.image, [...path, 'image'], `${id} image`, false);
          if (!placement) return undefined;
          for (const [key, value] of Object.entries(item)) {
            if (key === 'image') continue;
            if (['caption', 'takenAt', 'location', 'tags', 'extensions'].includes(key))
              placement[key] = value;
            else
              removed(
                toPointer([...path, key]),
                'Version 3 has no place for it on a gallery item.',
              );
          }
          return placement;
        })
        .filter((placement): placement is Rec => placement !== undefined);
      if (placements.length > 0) work.media = placements;
      const pointer = record(works, 'work', work, from, 'works');
      changes.push({
        code: 'mapped',
        from,
        to: { document: 'portfolio', pointer },
        note: `The gallery is the work ${id}, medium image-series, with its items as placements in order.`,
      });
      if (typeof section.title !== 'string') {
        needs.push({
          path: `portfolio.works.${works.length - 1}.title`,
          reason: 'The gallery has no title, and its work needs one: no renderer makes one up.',
        });
      }
      return worksSection(base, [id], kind, from, changes);
    }

    const type = EVIDENCE_KINDS[kind];
    if (type !== undefined) {
      if (kind === 'tenure') {
        extra(['years', 'summary']);
        const record_: Rec = { id: mint('evidence', 'tenure years'), type, ...lang };
        if (typeof section.summary === 'string') record_.statement = section.summary;
        else
          warn(
            from,
            'The tenure has no summary, so its evidence has no statement: only the number shows.',
          );
        if (section.years !== undefined) {
          record_.metric = { key: 'tenure-years', value: section.years, unit: 'years' };
        }
        const pointer = record(evidence, 'evidence', record_, from, 'evidence');
        changes.push({
          code: 'mapped',
          from,
          to: { document: 'portfolio', pointer },
          note: `The tenure is the evidence ${record_.id}: a metric keyed tenure-years, its summary the statement.`,
        });
        return evidenceSection(base, [record_.id as string], kind, from, changes);
      }
      extra(['items']);
      const ids = items.map((item, position) => {
        const path = [...at, 'items', position];
        const pointer = toPointer(path);
        if (!isPlainObject(item)) {
          removed(pointer, "It isn't an item, so no evidence holds it.");
          return undefined;
        }
        let rec: Rec;
        if (kind === 'stats') {
          rec = statEvidence(item, pointer, mint, lang, changes);
        } else {
          const title =
            kind === 'testimonials'
              ? item.author
              : kind === 'awards'
                ? item.name
                : kind === 'external-portfolios'
                  ? item.brandName
                  : item.title;
          rec = { id: mint('evidence', title), type, ...lang };
          carry(kind, item, rec, path);
          imagesOf(kind, item, rec, path, rec.id as string);
        }
        const to = record(evidence, 'evidence', rec, pointer, 'evidence');
        changes.push({
          code: 'mapped',
          from: pointer,
          to: { document: 'portfolio', pointer: to },
          note: `The ${kind} item is the evidence ${rec.id}, type ${type}.${RENAMES[kind] ?? ''}`,
        });
        return rec.id as string;
      });
      return evidenceSection(base, ids, kind, from, changes);
    }

    const entryKind = CHRONOLOGY_KINDS[kind];
    if (entryKind !== undefined) {
      extra(['items']);
      const ids = items.map((item, position) => {
        const path = [...at, 'items', position];
        const pointer = toPointer(path);
        if (!isPlainObject(item)) {
          removed(pointer, "It isn't an item, so no chronology entry holds it.");
          return undefined;
        }
        const title = kind === 'experience' ? item.role : item.degree;
        const organization = kind === 'experience' ? item.organization : item.institution;
        const entry: Rec = {
          id: mint(
            'chronology',
            [title, organization].filter((part) => typeof part === 'string').join(' '),
          ),
          kind: entryKind,
          ...lang,
        };
        carry(kind, item, entry, path);
        imagesOf(kind, item, entry, path, entry.id as string);
        const to = record(chronology, 'chronology', entry, pointer, 'chronology');
        changes.push({
          code: 'mapped',
          from: pointer,
          to: { document: 'portfolio', pointer: to },
          note: `The ${kind} item is the chronology entry ${entry.id}, kind ${entryKind}.${RENAMES[kind] ?? ''}`,
        });
        return entry.id as string;
      });
      const kept = ids.filter((id): id is string => id !== undefined);
      changes.push({
        code: 'mapped',
        from,
        to: { document: 'portfolio', pointer: from },
        note: `The ${kind} section is a chronology section listing its entries in the same order.`,
      });
      return { ...base, kind: 'chronology', ...(kept.length > 0 ? { items: kept } : {}) };
    }

    const part = PRACTICE_KINDS[kind];
    if (part !== undefined) {
      extra(kind === 'skills' ? ['groups', 'items'] : kind === 'stack' ? ['groups'] : ['items']);
      const groups = practiceGroups(kind, section, from, changes);
      const seen = practiceSeen.get(part);
      if (isHidden && visiblePractice.has(part)) {
        if (groups.length > 0) {
          removed(
            from,
            `The section is hidden, and in version 3 its groups would join practice.${part}, which a visible section shows. Its groups are left out; add them back to practice.${part} if they should show.`,
          );
        }
      } else {
        practice[part].push(...groups);
        if (seen !== undefined) {
          warn(
            from,
            `A second ${kind} section: its groups join practice.${part} after those of /sections/${seen}, and both sections show the whole part. Remove one of them if that's not wanted.`,
          );
        }
      }
      if (seen === undefined) practiceSeen.set(part, index);
      changes.push({
        code: 'mapped',
        from,
        to: { document: 'portfolio', pointer: from },
        note: `The ${kind} section is a practice section showing practice.${part}.`,
      });
      return { ...base, kind: 'practice', part };
    }

    if (kind === 'contact') {
      extra(['message', 'links', 'showAvailability']);
      if (section.showAvailability !== undefined) {
        removed(
          `${from}/showAvailability`,
          "It showed a label no one wrote, and version 3 renders only authored text: say you're available in contact.message instead.",
        );
      }
      const data_ = Object.fromEntries(
        ['message', 'links']
          .filter((key) => section[key] !== undefined)
          .map((key) => [key, section[key]]),
      );
      if (Object.keys(data_).length > 0) {
        if (contactSource?.index === index) {
          contact = data_;
          changes.push({
            code: 'moved',
            from,
            to: { document: 'portfolio', pointer: '/contact' },
            note: 'Its message and links are the top-level contact record, which the section places.',
          });
        } else {
          removed(
            from,
            `Its message and links aren't kept: the contact record comes from /sections/${contactSource!.index}${isHidden ? ', and this section is hidden' : ''}. Merge them there if they should show.`,
          );
        }
      }
      return { ...base, kind: 'contact' };
    }

    // An extension section, or a kind no version knows: as written.
    return section;
  });

  if (practice.skills.length + practice.tools.length + practice.services.length > 0) {
    portfolio.practice = Object.fromEntries(
      (['skills', 'tools', 'services'] as const)
        .filter((part) => practice[part].length > 0)
        .map((part) => [part, practice[part]]),
    );
  }
  if (works.length > 0) portfolio.works = works;
  if (evidence.length > 0) portfolio.evidence = evidence;
  if (chronology.length > 0) portfolio.chronology = chronology;
  if (media.length > 0) portfolio.media = media;
  if (contact) portfolio.contact = contact;
  if ('sections' in data) portfolio.sections = v3Sections;

  return { portfolio, changes, minted, needs };
}

/** A section's own fields, which carry over as they are. */
function sectionBase(section: Rec): Rec {
  return Object.fromEntries(
    ['id', 'title', 'subtitle', 'lang', 'extensions']
      .filter((key) => section[key] !== undefined)
      .map((key) => [key, section[key]]),
  );
}

function worksSection(
  base: Rec,
  ids: readonly (string | undefined)[],
  kind: string,
  from: string,
  changes: Change[],
): Rec {
  const items = ids.filter((id): id is string => id !== undefined);
  changes.push({
    code: 'mapped',
    from,
    to: { document: 'portfolio', pointer: from },
    note: `The ${kind} section is a works section listing its works in the same order.`,
  });
  return { ...base, kind: 'works', ...(items.length > 0 ? { items } : {}) };
}

function evidenceSection(
  base: Rec,
  ids: readonly (string | undefined)[],
  kind: string,
  from: string,
  changes: Change[],
): Rec {
  const items = ids.filter((id): id is string => id !== undefined);
  changes.push({
    code: 'mapped',
    from,
    to: { document: 'portfolio', pointer: from },
    note: `The ${kind} section is an evidence section listing its evidence in the same order.`,
  });
  return { ...base, kind: 'evidence', ...(items.length > 0 ? { items } : {}) };
}

/**
 * A stat as metric evidence. A number keeps its value as the metric's value
 * and its label as the statement; any other value becomes the statement
 * with the label after it. The #4 metric slug is the metric's key.
 */
function statEvidence(
  item: Rec,
  from: string,
  mint: (kind: IdKind, title: unknown) => string,
  lang: Rec,
  changes: Change[],
): Rec {
  const label = typeof item.label === 'string' ? item.label : undefined;
  const value = numericValue(item.value);
  const rec: Rec = {
    id: mint('evidence', label ?? (typeof item.value === 'string' ? item.value : undefined)),
    type: 'metric',
    ...lang,
  };
  const metric: Rec = {};
  if (typeof item.metric === 'string') metric.key = item.metric;
  if (value !== undefined) {
    if (label !== undefined) rec.statement = label;
    metric.value = value;
  } else {
    const text = [item.value, label].filter((part) => typeof part === 'string').join(' ');
    if (text !== '') rec.statement = text;
    changes.push({
      code: 'warned',
      from: `${from}/value`,
      note: "The stat's value isn't a number, so it's part of the statement, and no metric value can be checked against other claims.",
    });
  }
  if (metric.key === undefined) {
    changes.push({
      code: 'warned',
      from,
      note: 'The stat has no metric key, so no other claim is checked against it. Give it metric.key if one is stated elsewhere.',
    });
  }
  if (Object.keys(metric).length > 0) rec.metric = metric;
  if (typeof item.description === 'string') rec.description = item.description;
  if (isPlainObject(item.extensions)) rec.extensions = item.extensions;
  for (const key of Object.keys(item)) {
    if (!['value', 'label', 'description', 'metric', 'extensions'].includes(key)) {
      changes.push({
        code: 'removed',
        from: `${from}/${key}`,
        note: 'Version 3 has no place for it on a stat.',
      });
    }
  }
  return rec;
}

/** A practice section's groups: skills groups and a flat list, stack groups, or the services as one group. */
function practiceGroups(kind: string, section: Rec, from: string, changes: Change[]): Rec[] {
  const groups: Rec[] = [];
  const group = (value: unknown, path: string): Rec | undefined => {
    if (!isPlainObject(value)) {
      changes.push({
        code: 'removed',
        from: path,
        note: "It isn't a group, so practice doesn't hold it.",
      });
      return undefined;
    }
    return { ...value };
  };
  if (kind === 'skills' || kind === 'stack') {
    (Array.isArray(section.groups) ? section.groups : []).forEach((value, index) => {
      const kept = group(value, `${from}/groups/${index}`);
      if (kept) groups.push(kept);
    });
  }
  if ((kind === 'skills' || kind === 'services') && Array.isArray(section.items)) {
    groups.push({ items: section.items });
    changes.push({
      code: 'mapped',
      from: `${from}/items`,
      note: 'The items are one group without a name.',
    });
  }
  return groups;
}

/** A call to action with no label: the owner gives one, since no renderer makes one up. */
function actionNeeds(section: Rec, index: number, needs: Need[]): void {
  const need = (path: string) =>
    needs.push({ path, reason: 'A call to action needs a label: no renderer makes one up.' });
  if (section.kind === 'hero' && Array.isArray(section.ctas)) {
    section.ctas.forEach((cta, at) => {
      if (isPlainObject(cta) && typeof cta.label !== 'string')
        need(`portfolio.sections.${index}.ctas.${at}.label`);
    });
  }
  if (section.kind === 'cta') {
    for (const key of ['primaryAction', 'secondaryAction']) {
      const action = section[key];
      if (isPlainObject(action) && typeof action.label !== 'string')
        need(`portfolio.sections.${index}.${key}.label`);
    }
  }
}

/**
 * The data without blank text or empty lists, each reported: in version 3,
 * a field that's left out isn't authored. Extension data is kept as
 * written, and so is an image's `alt: ''`, which says it's decoration.
 */
function withoutBlanks(data: Rec, changes: Change[]): Rec {
  const walk = (node: unknown, path: Path): unknown => {
    if (Array.isArray(node)) {
      const kept: unknown[] = [];
      node.forEach((child, index) => {
        const value = walk(child, [...path, index]);
        if (value !== BLANK) kept.push(value);
        else {
          changes.push({
            code: 'removed',
            from: toPointer([...path, index]),
            note: "Blank text is left out: in version 3 a field that's left out isn't authored.",
          });
        }
      });
      return kept;
    }
    if (!isPlainObject(node)) {
      return typeof node === 'string' && node.trim() === '' ? BLANK : node;
    }
    const image = typeof node.src === 'string';
    const extensionSection = typeof node.kind === 'string' && node.kind.includes('/');
    const out: Rec = {};
    for (const [key, child] of Object.entries(node)) {
      const at = [...path, key];
      if (key === 'extensions' || (extensionSection && key === 'data')) {
        setOwn(out, key, child);
        continue;
      }
      if (image && key === 'alt' && child === '') {
        setOwn(out, key, child);
        continue;
      }
      const value = walk(child, at);
      if (value === BLANK) {
        changes.push({
          code: 'removed',
          from: toPointer(at),
          note: "Blank text is left out: in version 3 a field that's left out isn't authored.",
        });
      } else if (Array.isArray(value) && value.length === 0 && Array.isArray(child)) {
        changes.push({
          code: 'removed',
          from: toPointer(at),
          note: "An empty list is left out: in version 3 a list that's left out isn't authored.",
        });
      } else {
        setOwn(out, key, value);
      }
    }
    return out;
  };
  return walk(data, []) as Rec;
}

const BLANK = Symbol('blank');
