// The portfolio shapes Editorial Evidence has to hold up for (#13), beside
// the contract fixtures: one artifact and nothing else, text with no media
// at all, a long title and long evidence, hostile Markdown, and a curated
// practice with every list the home page reads. Each is a version 3
// portfolio document, parsed by the tests through #4's schema.

const base = {
  schemaVersion: 3,
  locale: 'en',
  direction: 'ltr',
} as const;

/** Every curation list, a case study, an archive, and a reading order around them. */
export const CURATED = {
  ...base,
  identity: {
    name: 'Rowan Vale',
    tagline: 'Builds calm, inspectable systems.',
    location: 'Lisbon',
    pronouns: 'they/them',
  },
  practice: { thesis: 'Systems people can **inspect**, and trust because they can.' },
  signature: 'ledger',
  featured: ['atlas', 'harbor', 'kiln'],
  proof: ['uptime', 'quote'],
  archive: ['old-site', 'zine'],
  works: [
    {
      id: 'ledger',
      slug: 'ledger',
      title: 'Ledger',
      medium: 'system',
      role: 'Lead engineer',
      organization: 'Northwind',
      summary: 'A double-entry audit trail for every deploy.',
      cover: { asset: 'ledger-cover' },
      evidence: ['uptime', 'quote', 'paper', 'talk'],
      caseStudy: {
        challenge: 'Nobody could say what changed, or when.',
        decisions: [{ decision: 'Append only.', rationale: 'History is the product.' }],
        outcomes: 'Every change has an author and a reason.',
      },
    },
    { id: 'atlas', slug: 'atlas', title: 'Atlas', medium: 'interface', summary: 'A map of services.' },
    { id: 'harbor', title: 'Harbor', medium: 'software', summary: 'A release train.' },
    { id: 'kiln', title: 'Kiln', medium: 'research', summary: 'Build caching, measured.' },
    {
      id: 'notes',
      slug: 'notes',
      title: 'Field notes',
      medium: 'writing',
      summary: 'Essays on operations.',
      caseStudy: { context: 'Written on call.' },
    },
    { id: 'old-site', title: 'The old site', medium: 'interface' },
    { id: 'zine', slug: 'zine', title: 'A zine', medium: 'writing', caseStudy: { role: 'Editor.' } },
  ],
  evidence: [
    { id: 'uptime', type: 'metric', title: 'Uptime', metric: { value: 99.95, unit: '%' } },
    {
      id: 'quote',
      type: 'testimonial',
      statement: 'The first audit we passed without a scramble.',
      source: { name: 'Mira Okafor', role: 'Head of security' },
    },
    { id: 'paper', type: 'publication', title: 'Append-only operations' },
    { id: 'talk', type: 'talk', title: 'Ledgers all the way down' },
  ],
  media: [{ id: 'ledger-cover', kind: 'image', source: 'ledger/cover.jpg', alt: 'The ledger view' }],
  contact: { message: 'Write any time.', links: [{ url: 'https://rowan.test', label: 'Site' }] },
  sections: [
    { kind: 'practice', id: 'thesis', part: 'thesis' },
    { kind: 'works', id: 'work', title: 'Work', items: ['ledger', 'atlas', 'harbor', 'kiln', 'notes', 'old-site'] },
    { kind: 'evidence', id: 'evidence', title: 'Evidence', items: ['uptime', 'paper', 'talk'] },
    { kind: 'contact', id: 'contact', title: 'Contact' },
  ],
};

/** One artifact: a signature work and the name. */
export const ONE_ARTIFACT = {
  ...base,
  identity: { name: 'Sol Ito' },
  signature: 'piece',
  works: [{ id: 'piece', title: 'The one piece', medium: 'object', summary: 'Made by hand.' }],
};

/** Text only: a thesis and writing, with no media anywhere. */
export const TEXT_ONLY = {
  ...base,
  identity: { name: 'Ada Reyes', tagline: 'Writes about cities.' },
  practice: { thesis: 'Cities are arguments people live inside.' },
  featured: ['essay'],
  works: [{ id: 'essay', title: 'On sidewalks', medium: 'writing', excerpt: 'The curb is a border.' }],
  sections: [
    { kind: 'practice', id: 'thesis', part: 'thesis' },
    { kind: 'lede', id: 'about', title: 'About', body: 'I write, and I walk.' },
  ],
};

const LONG = 'Infrastructure '.repeat(40).trim();

/** A long title and long evidence, which wrap rather than widen the page. */
export const LONG_TEXT = {
  ...base,
  identity: { name: 'Noor Haddad' },
  signature: 'long',
  works: [
    {
      id: 'long',
      slug: 'long',
      title: `A ${'very '.repeat(20)}long title`,
      medium: 'system',
      evidence: ['long-claim'],
      caseStudy: { evidence: LONG },
    },
  ],
  evidence: [{ id: 'long-claim', type: 'press', title: 'Coverage', statement: LONG }],
};

/** Markdown that tries to run script, link to it, or inject markup. */
export const HOSTILE = {
  ...base,
  identity: { name: 'Mal Formed' },
  practice: {
    thesis: '[click](javascript:alert(1)) <script>alert(2)</script> <img src=x onerror=alert(3)>',
  },
  signature: 'trap',
  works: [
    {
      id: 'trap',
      slug: 'trap',
      title: 'Trap',
      medium: 'software',
      summary: '[run](javascript:alert(4)) and [data](data:text/html,<b>x</b>)',
      caseStudy: { challenge: '<iframe src="https://evil.test"></iframe> [x](JaVaScRiPt:alert(5))' },
    },
  ],
  sections: [{ kind: 'practice', id: 'thesis', part: 'thesis' }],
};
