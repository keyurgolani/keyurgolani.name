// The URL rule for every url, src, and *Url field: https, http, mailto, and
// tel URLs, relative references other than //host, and #fragments. Image
// sources may also be data:image URLs in raster formats. Everything else is
// refused, javascript: included. No dependencies, so any code can use it.

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
/** Two slashes, either way round, start a reference to another host. */
const NETWORK_PATH = /^[\\/]{2}/;
const HTTP_URL = /^https?:\/\/[^/\\?#]/i;
const DATA_IMAGE = /^data:image\/(?:png|jpeg|gif|webp|avif)[;,]/i;

export interface UrlRules {
  /** Also allow data:image/png, jpeg, gif, webp, and avif URLs (image sources). */
  readonly dataImages?: boolean;
}

export function isAllowedUrl(value: string, rules: UrlRules = {}): boolean {
  // Browsers drop tabs and newlines and trim spaces before they parse a URL,
  // so "java\tscript:" would run. No allowed URL needs one unencoded.
  if (value === '' || hasControlOrSpace(value)) return false;
  const scheme = SCHEME.exec(value)?.[1]?.toLowerCase();
  if (scheme === undefined) return !NETWORK_PATH.test(value);
  switch (scheme) {
    case 'https':
    case 'http':
      return isHttpUrl(value);
    case 'mailto':
    case 'tel':
      return value.length > scheme.length + 1;
    case 'data':
      return rules.dataImages === true && DATA_IMAGE.test(value);
    default:
      return false;
  }
}

function isHttpUrl(value: string): boolean {
  if (!HTTP_URL.test(value)) return false;
  try {
    return new URL(value).hostname !== '';
  } catch {
    return false;
  }
}

function hasControlOrSpace(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}
