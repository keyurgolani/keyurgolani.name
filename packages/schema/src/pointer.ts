// RFC 6901 JSON pointers, kept free of other modules so the source reader
// and the secret scanner can both build them.

/** RFC 6901 JSON pointer for a path; '' is the whole document. */
export function toPointer(path: readonly PropertyKey[]): string {
  return path.map((part) => `/${String(part).replace(/~/g, '~0').replace(/\//g, '~1')}`).join('');
}

/** The keys an RFC 6901 pointer names, or null when it isn't one. */
export function parsePointer(pointer: string): string[] | null {
  if (pointer === '') return [];
  if (!pointer.startsWith('/') || /~(?![01])/.test(pointer)) return null;
  return pointer
    .slice(1)
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
}
