import { isAllowedUrl } from './url';

// Where a media asset's file is (#10, item 1): a path under the media root,
// such as atlas/cover.jpg, or an https URL. Slice 2 resolves a path only under
// the read-only media root, so the rule here keeps a path relative and inside
// it: no leading slash, no empty, `.`, or `..` segment, no backslash, and no
// `?`, `#`, or `:` that would make it read as a URL. No dependencies.

/** The longest source a media asset may name. */
export const MEDIA_SOURCE_MAX_LENGTH = 1024;

/** Whether a value is a path under the media root. */
export function isMediaRootPath(value: string): boolean {
  if (value === '' || value.length > MEDIA_SOURCE_MAX_LENGTH) return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    // Control characters, and the characters that would make a path a URL or a Windows path.
    if (code < 0x20 || code === 0x7f) return false;
  }
  if (/[\\?#:]/.test(value)) return false;
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/** Whether a value is an https URL a media asset may name. */
export function isHttpsMediaUrl(value: string): boolean {
  return (
    value.length <= MEDIA_SOURCE_MAX_LENGTH && /^https:\/\//i.test(value) && isAllowedUrl(value)
  );
}

/** Whether a value is a media asset's `source`: a media-root path or an https URL. */
export function isMediaSource(value: string): boolean {
  return /^https:/i.test(value) ? isHttpsMediaUrl(value) : isMediaRootPath(value);
}
