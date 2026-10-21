import { cn } from '../cn';
import { renderInlineMarkdown, renderMarkdown } from '../markdown';

/**
 * Markdown from the content. It's the one way a variant renders markdown, so
 * #10's sanitizer goes here and nowhere else. `inline` renders a phrase,
 * without paragraphs, for inside a heading or a sentence.
 */
export function RichText({
  source,
  inline = false,
  className,
}: {
  source: string;
  inline?: boolean;
  className?: string;
}) {
  return inline ? (
    <span
      className={cn('pf-rich-text', className)}
      dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(source) }}
    />
  ) : (
    <div
      className={cn('pf-rich-text', className)}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(source) }}
    />
  );
}
