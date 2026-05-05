import { marked } from 'marked';

marked.setOptions({
  gfm: true,
  breaks: false,
});

export function renderMarkdown(source: string | undefined | null): string {
  if (!source) return '';
  return marked.parse(source, { async: false }) as string;
}

export function renderInlineMarkdown(source: string | undefined | null): string {
  if (!source) return '';
  return marked.parseInline(source, { async: false }) as string;
}
