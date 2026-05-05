import type { Projects } from '@portfolio/schema';
import { formatPeriod } from '@portfolio/kit';
import { SectionFrame } from '../primitives/section-frame';
import { MarkdownBody } from '../primitives/markdown-body';

export function ProjectsRenderer({ section }: { section: Projects }) {
  return (
    <SectionFrame section={section} fallbackTitle="Projects">
      {section.items.map((item, i) => {
        const image = item.image ?? item.images?.[0];
        return (
          <article key={`${item.name}-${i}`} className="editorial-project">
            <h3 className="editorial-project__title">{item.name}</h3>
            <div className="editorial-project__meta">
              {item.period ? <span>{formatPeriod(item.period, { short: true })}</span> : null}
              {item.role ? <span>{item.role}</span> : null}
              {item.organization ? <span>{item.organization}</span> : null}
            </div>
            <div className="editorial-project__body">
              {image ? (
                <figure className="editorial-project__image">
                  <img
                    src={image.src}
                    alt={image.alt ?? item.name}
                    width={image.width}
                    height={image.height}
                    loading="lazy"
                    decoding="async"
                  />
                  {image.credit ? <figcaption>{image.credit}</figcaption> : null}
                </figure>
              ) : null}
              {item.summary ? <MarkdownBody source={item.summary} className="editorial-prose" /> : null}
              {item.description ? <MarkdownBody source={item.description} /> : null}
              {item.highlights && item.highlights.length > 0 ? (
                <ul className="editorial-entry__highlights">
                  {item.highlights.map((h, j) => (
                    <li key={j}>{h}</li>
                  ))}
                </ul>
              ) : null}
            </div>
            {item.technologies && item.technologies.length > 0 ? (
              <div className="editorial-project__tags">
                {item.technologies.map((t, j) => (
                  <span key={j} className="editorial-project__tag">
                    {t}
                  </span>
                ))}
              </div>
            ) : null}
            {item.links && item.links.length > 0 ? (
              <div className="editorial-project__links">
                {item.links.map((l, j) => (
                  <a key={j} href={l.url} target="_blank" rel="noopener noreferrer">
                    {l.label ?? l.platform ?? l.url}
                  </a>
                ))}
              </div>
            ) : null}
          </article>
        );
      })}
    </SectionFrame>
  );
}
