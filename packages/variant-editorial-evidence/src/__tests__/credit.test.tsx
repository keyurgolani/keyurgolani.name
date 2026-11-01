import test from 'node:test';
import assert from 'node:assert/strict';
import { CURATED } from '../__fixtures__/shapes';
import { pairOf, render } from './harness';

// A picture's credit and its rights (#10), as the issue writes an
// attribution: comma to comma on one line, never run together, and a name
// said once. An invented identity's home read "Marisol Quintero-AcháMarisol
// Quintero-AcháAll rights reserved": the kit sets the credit, the rights
// holder, and the license side by side with nothing between them, and her
// credit and her rights holder are the same name.

type Rights = { holder?: string; license?: string; attributionRequired?: boolean };

/** CURATED with Pl. 1's cover and the case study's two plates credited as given. */
function credited(cover: { credit?: string; rights?: Rights }) {
  return pairOf({
    ...CURATED,
    media: CURATED.media.map((asset) => ({ ...asset, ...cover })),
  });
}

/** Each figcaption of a picture, in order. */
const captions = (html: string) =>
  [...html.matchAll(/<figure class="pf-figure[^"]*" data-media-asset="[^"]+">[\s\S]*?<\/figure>/g)]
    .map(([figure]) => figure.match(/<figcaption>([\s\S]*?)<\/figcaption>/)?.[1])
    .filter((caption): caption is string => caption !== undefined);

/** Markup as a reader reads it: the text alone. */
const text = (html: string) => html.replace(/<[^>]+>/g, '');

const home = (pair: ReturnType<typeof pairOf>) => render(pair);
const casePage = (pair: ReturnType<typeof pairOf>) =>
  render(pair, { route: { route: 'work', slug: 'ledger' } });

test('a credit and its rights read as one line, comma to comma, on Pl. 1 and on the case study plates', () => {
  const pair = credited({
    credit: 'Inês Duarte',
    rights: { holder: 'Northwind Studio', license: 'CC BY 4.0', attributionRequired: true },
  });
  for (const [where, html] of [
    ['home', home(pair)],
    ['case study', casePage(pair)],
  ] as const) {
    const lines = captions(html);
    assert.ok(lines.length > 0, `${where} credits a picture`);
    for (const line of lines) {
      assert.equal(text(line), 'Inês Duarte, Northwind Studio, CC BY 4.0', where);
      // The kit's parts keep their classes, and the rights the flag that credit is required.
      assert.match(
        line,
        /^<small class="pf-credit">Inês Duarte<\/small>, <small class="pf-rights" data-attribution-required="true"><span class="pf-rights-holder">Northwind Studio<\/span>, <span class="pf-rights-license">CC BY 4\.0<\/span><\/small>$/,
        where,
      );
    }
  }
});

test('a rights holder who is the credit itself is said once; a different one is kept', () => {
  // The holder typed with a decomposed á and a double space is still the same name.
  const same = captions(
    home(
      credited({
        credit: 'Marisol Quintero-Achá',
        rights: {
          holder: ' Marisol  Quintero-Acha\u0301',
          license: 'All rights reserved',
          attributionRequired: true,
        },
      }),
    ),
  );
  assert.ok(same.length > 0);
  for (const line of same) {
    assert.equal(text(line), 'Marisol Quintero-Achá, All rights reserved');
    assert.doesNotMatch(line, /pf-rights-holder/);
    assert.match(line, /<small class="pf-rights" data-attribution-required="true">/);
  }

  // A name that only looks alike is another owner, so both stay.
  const other = captions(
    home(
      credited({ credit: 'Marisol Quintero-Achá', rights: { holder: 'Marisol Quintero-Acha' } }),
    ),
  );
  assert.ok(other.length > 0);
  for (const line of other) {
    assert.equal(text(line), 'Marisol Quintero-Achá, Marisol Quintero-Acha');
  }
});

test('a credit alone, or rights alone, reads as written, with no stray comma', () => {
  const alone = captions(home(credited({ credit: 'Inês Duarte' })));
  assert.ok(alone.length > 0);
  for (const line of alone) {
    assert.equal(line, '<small class="pf-credit">Inês Duarte</small>');
  }
  const rights = captions(
    home(credited({ rights: { holder: 'Northwind Studio', license: 'CC BY 4.0' } })),
  );
  assert.ok(rights.length > 0);
  for (const line of rights) {
    assert.equal(text(line), 'Northwind Studio, CC BY 4.0');
    assert.doesNotMatch(line, /pf-credit|data-attribution-required/);
  }
  // Nothing authored: no caption at all, as the kit leaves it.
  assert.deepEqual(captions(home(credited({}))), []);
});
