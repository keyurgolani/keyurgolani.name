import type { Link as PortfolioLink } from '@portfolio/schema';
import { cn } from '@portfolio/kit';

interface ActionLinkProps {
  link: PortfolioLink;
  variant?: 'primary' | 'ghost';
  size?: 'md' | 'lg';
  icon?: React.ReactNode;
  className?: string;
}

export function ActionLink({
  link,
  variant = 'primary',
  size = 'md',
  icon,
  className,
}: ActionLinkProps) {
  if (!link.url) return null;
  const isExternal = /^https?:\/\//.test(link.url);
  return (
    <a
      className={cn(
        'kc-action',
        `kc-action--${variant}`,
        size === 'lg' && 'kc-action--lg',
        className,
      )}
      href={link.url}
      target={isExternal ? '_blank' : undefined}
      rel={isExternal ? 'noopener noreferrer' : undefined}
    >
      {icon ? <span className="kc-action__icon" aria-hidden="true">{icon}</span> : null}
      <span>{link.label || link.url}</span>
    </a>
  );
}
