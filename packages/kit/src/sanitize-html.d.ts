// The part of sanitize-html 2.18's API the Markdown post-pass uses
// (markdown-sanitize.ts). The package ships no types of its own, and
// @types/sanitize-html isn't a dependency.

declare module 'sanitize-html' {
  namespace sanitizeHtml {
    type Attributes = Record<string, string>;
    interface Transformed {
      tagName: string;
      attribs: Attributes;
    }
    interface Options {
      allowedTags: string[];
      allowedAttributes: Record<string, string[]>;
      allowedClasses?: Record<string, string[]>;
      allowedStyles?: Record<string, Record<string, RegExp[]>>;
      allowedSchemes?: string[];
      allowedSchemesByTag?: Record<string, string[]>;
      allowedSchemesAppliedToAttributes?: string[];
      allowProtocolRelative?: boolean;
      allowVulnerableTags?: boolean;
      disallowedTagsMode?: 'discard' | 'escape' | 'recursiveEscape';
      parser?: { decodeEntities?: boolean; lowerCaseTags?: boolean };
      transformTags?: Record<string, (tagName: string, attribs: Attributes) => Transformed>;
    }
  }
  function sanitizeHtml(dirty: string, options: sanitizeHtml.Options): string;
  export = sanitizeHtml;
}
