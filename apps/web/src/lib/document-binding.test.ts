import test from 'node:test';
import assert from 'node:assert/strict';
import { pageBinding } from './document-binding';

// K-4 (d), the delta review's N1: a page without the visitor's control, such
// as a preview, keeps the binding's modifier keys and drops `/`, which nothing
// there could turn off.

const manifest = (keys: string[]) => ({
  keyBindings: [
    { region: 'chapters', keys: ['ArrowLeft'], action: 'Moves back.' },
    { region: 'document', keys, action: 'palette.open' },
  ],
});

test("a preview's ExperienceDocument keeps mod+k and drops /, where a visitor page keeps both", () => {
  assert.deepEqual(pageBinding(manifest(['mod+k', '/']), { visitorControl: false }), {
    keys: ['mod+k'],
    action: 'palette.open',
  });
  assert.deepEqual(pageBinding(manifest(['mod+k', '/']), { visitorControl: true }), {
    keys: ['mod+k', '/'],
    action: 'palette.open',
  });
});

test('a binding with / alone binds nothing where no control could turn it off, and none binds nothing', () => {
  assert.equal(pageBinding(manifest(['/']), { visitorControl: false }), undefined);
  assert.deepEqual(pageBinding(manifest(['/']), { visitorControl: true }), {
    keys: ['/'],
    action: 'palette.open',
  });
  assert.equal(pageBinding({}, { visitorControl: true }), undefined);
});
