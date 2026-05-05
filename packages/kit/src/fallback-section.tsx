import type { Portfolio, Section } from '@portfolio/schema';
import { ensureSectionId, formatPeriod, formatDate, formatList, formatStatValue } from './format';
import { renderInlineMarkdown, renderMarkdown } from './markdown';

/**
 * Generic typographic renderer for any section kind. Variants that declare
 * partial `supportedKinds` can dispatch unsupported kinds to this component.
 *
 * Intentionally simple: title, body, list. Inherits the variant's CSS tokens
 * so it looks like part of the variant rather than foreign chrome.
 */
export function FallbackSection({ section, portfolio }: { section: Section; portfolio: Portfolio }) {
  if (section.hidden) return null;
  const id = ensureSectionId(section.id, section.title ?? section.kind);

  const heading = section.title ?? defaultHeading(section.kind);

  return (
    <section id={id} data-fallback-kind={section.kind} style={style.section}>
      {heading ? <h2 style={style.heading}>{heading}</h2> : null}
      {section.subtitle ? <p style={style.subtitle}>{section.subtitle}</p> : null}
      <FallbackBody section={section} portfolio={portfolio} />
    </section>
  );
}

function defaultHeading(kind: Section['kind']): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function FallbackBody({ section, portfolio }: { section: Section; portfolio: Portfolio }) {
  switch (section.kind) {
    case 'hero': {
      const name = section.name ?? portfolio.identity.name;
      return (
        <div>
          {section.greeting ? <p style={style.muted}>{section.greeting}</p> : null}
          <h1 style={style.heroName}>{name}</h1>
          {section.tagline ? <p style={style.lede}>{section.tagline}</p> : null}
        </div>
      );
    }
    case 'lede':
    case 'now':
      return (
        <div
          style={style.prose}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(section.body) }}
        />
      );
    case 'experience':
    case 'education': {
      const items = section.items;
      return (
        <ul style={style.list}>
          {items.map((item, i) => {
            const isExp = section.kind === 'experience';
            const title = isExp
              ? (item as { role: string }).role
              : `${(item as { degree: string }).degree}${
                  (item as { field?: string }).field ? `, ${(item as { field: string }).field}` : ''
                }`;
            const subtitle = isExp
              ? (item as { organization: string }).organization
              : (item as { institution: string }).institution;
            return (
              <li key={i} style={style.entry}>
                <strong>{title}</strong>
                {' — '}
                <em>{subtitle}</em>
                <div style={style.muted}>{formatPeriod(item.period)}</div>
                {item.description ? (
                  <p
                    style={style.proseInline}
                    dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(item.description) }}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      );
    }
    case 'projects':
      return (
        <ul style={style.list}>
          {section.items.map((item, i) => (
            <li key={i} style={style.entry}>
              <strong>{item.name}</strong>
              {item.summary ? <span> — {item.summary}</span> : null}
              {item.technologies?.length ? (
                <div style={style.muted}>{formatList([...item.technologies])}</div>
              ) : null}
            </li>
          ))}
        </ul>
      );
    case 'writings':
    case 'publications':
    case 'talks':
    case 'awards':
    case 'patents':
    case 'episodes': {
      const items = section.items;
      return (
        <ul style={style.list}>
          {items.map((item, i) => {
            const t = (item as { title?: string; name?: string }).title ?? (item as { name?: string }).name ?? '';
            const date =
              (item as { publishedAt?: string }).publishedAt ??
              (item as { presentedAt?: string }).presentedAt ??
              (item as { receivedAt?: string }).receivedAt ??
              (item as { grantedAt?: string }).grantedAt;
            const venue =
              (item as { publication?: string }).publication ??
              (item as { venue?: string }).venue ??
              (item as { organization?: string }).organization;
            return (
              <li key={i} style={style.entry}>
                <strong>{t}</strong>
                {venue ? (
                  <>
                    {' — '}
                    <em>{venue}</em>
                  </>
                ) : null}
                {date ? <div style={style.muted}>{formatDate(date)}</div> : null}
              </li>
            );
          })}
        </ul>
      );
    }
    case 'gallery':
      return (
        <ul style={style.list}>
          {section.items.map((item, i) => (
            <li key={i} style={style.entry}>
              {item.image.alt ?? item.caption ?? `Image ${i + 1}`}
              {item.location ? <span style={style.muted}> — {item.location}</span> : null}
            </li>
          ))}
        </ul>
      );
    case 'discography':
      return (
        <ul style={style.list}>
          {section.items.map((item, i) => (
            <li key={i} style={style.entry}>
              <strong>{item.title}</strong>
              {item.role ? <span> — {item.role}</span> : null}
              {item.releasedAt ? <div style={style.muted}>{formatDate(item.releasedAt)}</div> : null}
            </li>
          ))}
        </ul>
      );
    case 'testimonials':
      return (
        <ul style={style.list}>
          {section.items.map((item, i) => (
            <li key={i} style={style.entry}>
              <blockquote style={style.quote}>&ldquo;{item.quote}&rdquo;</blockquote>
              <div style={style.muted}>
                — {item.author}
                {item.authorOrganization ? `, ${item.authorOrganization}` : ''}
              </div>
            </li>
          ))}
        </ul>
      );
    case 'press':
      return (
        <ul style={style.list}>
          {section.items.map((item, i) => (
            <li key={i} style={style.entry}>
              {item.url ? <a href={item.url}>{item.title}</a> : <strong>{item.title}</strong>}
              {' — '}
              <em>{item.publication}</em>
              {item.publishedAt ? <div style={style.muted}>{formatDate(item.publishedAt)}</div> : null}
            </li>
          ))}
        </ul>
      );
    case 'quote':
      return (
        <blockquote style={style.quote}>
          &ldquo;{section.text}&rdquo;
          {section.attribution ? <footer style={style.muted}>— {section.attribution}</footer> : null}
        </blockquote>
      );
    case 'skills':
      if (section.groups?.length) {
        return (
          <ul style={style.list}>
            {section.groups.map((group, i) => (
              <li key={i} style={style.entry}>
                <strong>{group.name}</strong> — {formatList([...group.items])}
              </li>
            ))}
          </ul>
        );
      }
      return <p>{formatList(section.items ?? [])}</p>;
    case 'stack':
      return (
        <ul style={style.list}>
          {section.groups.map((group, i) => (
            <li key={i} style={style.entry}>
              <strong>{group.name}</strong> — {formatList(group.items.map((item) => item.name))}
            </li>
          ))}
        </ul>
      );
    case 'services':
      return (
        <ul style={style.list}>
          {section.items.map((item, i) => (
            <li key={i} style={style.entry}>
              <strong>{item.name}</strong>
              {item.description ? <span> — {item.description}</span> : null}
              {item.pricing ? <div style={style.muted}>{item.pricing}</div> : null}
            </li>
          ))}
        </ul>
      );
    case 'contact': {
      const links = section.links?.length ? section.links : portfolio.links;
      return (
        <div>
          {section.message ? <p>{section.message}</p> : null}
          {links.length > 0 ? (
            <ul style={style.list}>
              {links.map((link, i) => (
                <li key={i}>
                  <a href={link.url}>{link.label ?? link.platform ?? link.url}</a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      );
    }
    case 'cta':
      return (
        <div>
          {section.description ? <p>{section.description}</p> : null}
          {section.primaryAction ? (
            <a href={section.primaryAction.url}>{section.primaryAction.label ?? 'Learn more'}</a>
          ) : null}
        </div>
      );
    case 'stats':
      return (
        <ul style={style.list}>
          {section.items.map((item, i) => (
            <li key={i} style={style.entry}>
              <strong>{formatStatValue(item.value)}</strong> — {item.label}
            </li>
          ))}
        </ul>
      );
    case 'focus':
      return (
        <ul style={style.list}>
          {section.items.map((item, i) => (
            <li key={i} style={style.entry}>
              {item}
            </li>
          ))}
        </ul>
      );
    case 'fun-facts':
      return (
        <ul style={style.list}>
          {section.items.map((item, i) => (
            <li key={i} style={style.entry}>
              {item}
            </li>
          ))}
        </ul>
      );
    case 'tenure':
      return (
        <div>
          {section.years != null ? (
            <div style={style.heroName}>{section.years}+ years</div>
          ) : null}
          {section.summary ? <p style={style.lede}>{section.summary}</p> : null}
        </div>
      );
    case 'external-portfolios':
      return (
        <ul style={style.list}>
          {section.items.map((item, i) => (
            <li key={i} style={style.entry}>
              <a href={item.url}>
                <strong>{item.brandName}</strong>
              </a>
              {item.locationLabel ? <span style={style.muted}> — {item.locationLabel}</span> : null}
              {item.description ? (
                <p style={style.proseInline}>{item.description}</p>
              ) : null}
            </li>
          ))}
        </ul>
      );
    case 'github':
      return (
        <p>
          <a href={`https://github.com/${section.username}`}>@{section.username} on GitHub</a>
        </p>
      );
    default: {
      const _exhaustive: never = section;
      void _exhaustive;
      return null;
    }
  }
}

const style = {
  section: { padding: '2rem 0', borderTop: '1px solid currentColor' } as const,
  heading: { fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.18em', opacity: 0.6, margin: '0 0 1rem' } as const,
  subtitle: { fontStyle: 'italic', opacity: 0.7, margin: '0 0 1rem' } as const,
  heroName: { fontSize: '3rem', margin: '0 0 0.5rem', fontWeight: 600 } as const,
  lede: { fontSize: '1.25rem', opacity: 0.85, margin: 0 } as const,
  prose: { maxWidth: '40rem', lineHeight: 1.6 } as const,
  proseInline: { margin: '0.5rem 0', maxWidth: '40rem' } as const,
  list: { listStyle: 'none', margin: 0, padding: 0 } as const,
  entry: { padding: '0.5rem 0', borderBottom: '1px solid currentColor', borderColor: 'rgba(0,0,0,0.06)' } as const,
  muted: { fontSize: '0.875rem', opacity: 0.6, margin: '0.25rem 0 0' } as const,
  quote: { borderLeft: '2px solid currentColor', paddingLeft: '1rem', margin: '1rem 0', fontStyle: 'italic', opacity: 0.85 } as const,
};
