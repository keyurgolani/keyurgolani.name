import test from 'node:test';
import assert from 'node:assert/strict';
import { sniffImageType } from './sniff';
import { avif, gif, jpeg, png, tiff, webp } from '../../store/test-support/images';

// A source's type comes from its bytes alone (#10, slice 2 item 3).

/** An ISO BMFF ftyp box with `major` and `compatible` brands. */
function ftyp(major: string, ...compatible: string[]): Uint8Array {
  const brands = [major, '\0\0\0\0', ...compatible].join('');
  const box = Buffer.alloc(8 + brands.length);
  box.writeUInt32BE(box.length, 0);
  box.write('ftyp', 4, 'latin1');
  box.write(brands, 8, 'latin1');
  return new Uint8Array(Buffer.concat([box, Buffer.alloc(16)]));
}

test('JPEG, PNG, WebP, and AVIF are known by their first bytes', async () => {
  const picture = { width: 4, height: 4 };
  assert.equal(sniffImageType(await jpeg(picture)), 'image/jpeg');
  assert.equal(sniffImageType(await png(picture)), 'image/png');
  assert.equal(sniffImageType(await webp(picture)), 'image/webp');
  assert.equal(sniffImageType(await avif(picture)), 'image/avif');
  assert.equal(sniffImageType(ftyp('mif1', 'avif', 'miaf')), 'image/avif');
  assert.equal(sniffImageType(ftyp('avis')), 'image/avif');
});

test('everything else is no image, whatever it would be called', async () => {
  const picture = { width: 4, height: 4 };
  for (const bytes of [
    await gif(picture),
    await tiff(picture),
    ftyp('heic', 'mif1', 'heic'),
    ftyp('isom', 'mp41'),
    new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    new TextEncoder().encode('RIFF\0\0\0\0WAVEfmt '),
    new Uint8Array([0xff, 0xd8]),
    new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    new Uint8Array(0),
  ]) {
    assert.equal(sniffImageType(bytes), null);
  }
  // An ftyp box whose size lies about itself.
  const lying = ftyp('avif');
  new DataView(lying.buffer).setUint32(0, 4096);
  assert.equal(sniffImageType(lying), null);
});
