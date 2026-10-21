import type { VariantRenderInput } from '@portfolio/variant-contract';
import { cn } from '../cn';
import { renderInlineMarkdown, renderMarkdown } from '../markdown';
import { hrefFor } from './primitives';

/**
 * Markdown from the content. It's the one way a variant renders markdown, so
 * #10's sanitizer goes here and nowhere else. `inline` renders a phrase,
 * without paragraphs, for inside a heading or a sentence. Given the render
 * input, a link to a `#fragment` or `/#fragment` takes the render's id
 * prefix and mount point, as link fields do, so it still lands on its section.
 */
export function RichText({
  source,
  inline = false,
  className,
  input,
}: {
  source: string;
  inline?: boolean;
  className?: string;
  input?: VariantRenderInput;
}) {
  const rendered = inline ? renderInlineMarkdown(source) : renderMarkdown(source);
  const html = input ? prefixFragments(rendered, input) : rendered;
  return inline ? (
    <span className={cn('pf-rich-text', className)} dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <div className={cn('pf-rich-text', className)} dangerouslySetInnerHTML={{ __html: html }} />
  );
}

/** Each `href="#id"` and `href="/#id"` in rendered markdown, through hrefFor(). */
function prefixFragments(html: string, input: VariantRenderInput): string {
  return html.replace(
    /(<a\b[^>]*?\shref=")(\/?#[^"]+)"/g,
    (_match, start: string, href: string) => `${start}${hrefFor(href, input)}"`,
  );
}
