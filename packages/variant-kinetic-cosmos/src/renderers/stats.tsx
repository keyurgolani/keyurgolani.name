import type { Stats } from '@portfolio/schema';
import { AnimatedCounter } from '@portfolio/kit';
import { SectionFrame } from '../primitives/section-frame';

function parseStatValue(raw: string | number): { num: number | null; prefix: string; suffix: string } {
  if (typeof raw === 'number') return { num: raw, prefix: '', suffix: '' };
  // Pull leading non-digit prefix (e.g. "$", "~"), digit run, trailing suffix ("+", "K", "B+", etc.).
  const m = /^([^\d-]*)(-?\d+(?:\.\d+)?)(.*)$/.exec(raw.trim());
  if (!m) return { num: null, prefix: '', suffix: raw };
  return {
    num: Number.parseFloat(m[2]!),
    prefix: m[1]!,
    suffix: m[3]!,
  };
}

export function StatsRenderer({ section }: { section: Stats }) {
  return (
    <SectionFrame section={section} fallbackTitle="By the Numbers" gradientTitle>
      <div className="kc-stats">
        {section.items.map((item, i) => {
          const { num, prefix, suffix } = parseStatValue(item.value);
          return (
            <div key={i} className="kc-card kc-stat">
              <div className="kc-stat__value">
                {num !== null ? (
                  <AnimatedCounter end={num} prefix={prefix} suffix={suffix} />
                ) : (
                  <span>{item.value}</span>
                )}
              </div>
              <div className="kc-stat__label">{item.label}</div>
              {item.description ? (
                <p className="kc-stat__description">{item.description}</p>
              ) : null}
            </div>
          );
        })}
      </div>
    </SectionFrame>
  );
}
