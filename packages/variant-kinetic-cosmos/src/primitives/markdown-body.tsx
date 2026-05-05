import { cn, renderInlineMarkdown, renderMarkdown } from '@portfolio/kit';

interface MarkdownBodyProps {
  source: string | undefined | null;
  inline?: boolean;
  className?: string;
}

export function MarkdownBody({ source, inline, className }: MarkdownBodyProps) {
  if (!source) return null;
  const html = inline ? renderInlineMarkdown(source) : renderMarkdown(source);
  if (!html) return null;
  if (inline) {
    return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return (
    <div
      className={cn('kc-prose', className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
