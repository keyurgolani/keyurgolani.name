'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Projects } from '@portfolio/schema';
import { cn, formatPeriod } from '@portfolio/kit';
import { SectionFrame } from '../primitives/section-frame';
import { ActionLink } from '../primitives/action-link';

type ProjectBadge = 'hackathon' | 'published' | 'opensource';

const BADGE_RULES: Record<ProjectBadge, RegExp[]> = {
  hackathon: [/\b(hackathon|prize|winning|won)\b/i],
  published: [/\b(published|publication|featured|paper)\b/i],
  opensource: [/\b(open[- ]?source|github\.com|oss)\b/i],
};

const BADGE_LABEL: Record<ProjectBadge, string> = {
  hackathon: 'Hackathon',
  published: 'Published',
  opensource: 'Open Source',
};

function deriveProjectBadges(item: Projects['items'][number]): ProjectBadge[] {
  const haystack = [
    item.name,
    item.summary ?? '',
    item.description ?? '',
    ...(item.highlights ?? []),
    ...(item.links ?? []).map((l) => `${l.platform ?? ''} ${l.url}`),
  ]
    .join(' ')
    .toLowerCase();

  const badges: ProjectBadge[] = [];
  for (const kind of Object.keys(BADGE_RULES) as ProjectBadge[]) {
    if (BADGE_RULES[kind].some((re) => re.test(haystack))) badges.push(kind);
  }
  return badges;
}

export function ProjectsRenderer({ section }: { section: Projects }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  if (section.items.length === 0) {
    return (
      <SectionFrame section={section} fallbackTitle="Projects" gradientTitle>
        <p className="kc-empty">No projects yet.</p>
      </SectionFrame>
    );
  }

  return (
    <SectionFrame section={section} fallbackTitle="Featured Projects" gradientTitle>
      <div className="kc-projects">
        {section.items.map((project, i) => {
          const isExpanded = expandedIdx === i;
          return (
            <motion.article
              key={`${project.name}-${i}`}
              layout
              className={cn('kc-card kc-card--hoverable kc-project', isExpanded && 'kc-project--expanded')}
              onClick={() => setExpandedIdx(isExpanded ? null : i)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setExpandedIdx(isExpanded ? null : i);
                }
              }}
              aria-expanded={isExpanded}
            >
              <header className="kc-project__head">
                <h3 className="kc-project__name">{project.name}</h3>
                {project.period ? (
                  <span className="kc-project__period">{formatPeriod(project.period)}</span>
                ) : null}
              </header>
              {(() => {
                const badges = deriveProjectBadges(project);
                return badges.length > 0 ? (
                  <div className="kc-project__badges">
                    {badges.map((b) => (
                      <span key={b} className={`kc-project__badge kc-project__badge--${b}`}>
                        {BADGE_LABEL[b]}
                      </span>
                    ))}
                  </div>
                ) : null;
              })()}
              {project.summary ? <p className="kc-project__summary">{project.summary}</p> : null}
              {project.technologies && project.technologies.length > 0 ? (
                <ul className="kc-project__tech">
                  {project.technologies.slice(0, isExpanded ? undefined : 5).map((tech, j) => (
                    <li key={j} className="kc-project__tech-chip">{tech}</li>
                  ))}
                </ul>
              ) : null}
              <AnimatePresence>
                {isExpanded ? (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="kc-project__expanded"
                  >
                    {project.description ? (
                      <p className="kc-project__description">{project.description}</p>
                    ) : null}
                    {project.highlights && project.highlights.length > 0 ? (
                      <ul className="kc-project__highlights">
                        {project.highlights.map((h, j) => (
                          <li key={j}>{h}</li>
                        ))}
                      </ul>
                    ) : null}
                    {project.links && project.links.length > 0 ? (
                      <div
                        className="kc-project__links"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {project.links.map((link, j) => (
                          <ActionLink
                            key={`${link.url}-${j}`}
                            link={link}
                            variant={j === 0 ? 'primary' : 'ghost'}
                          />
                        ))}
                      </div>
                    ) : null}
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </motion.article>
          );
        })}
      </div>
    </SectionFrame>
  );
}
