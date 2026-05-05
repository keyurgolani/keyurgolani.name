import type { Link as PortfolioLink } from '@portfolio/schema';
import { cn } from '@portfolio/kit';

interface ActionLinkProps {
  link: PortfolioLink;
  ghost?: boolean;
}

export function ActionLink({ link, ghost }: ActionLinkProps) {
  if (!link.url) return null;
  const isExternal = /^https?:\/\//.test(link.url);
  return (
    <a
      className={cn('editorial-action', ghost && 'editorial-action--ghost')}
      href={link.url}
      target={isExternal ? '_blank' : undefined}
      rel={isExternal ? 'noopener noreferrer' : undefined}
    >
      {link.label || link.url}
    </a>
  );
}
