import { RichText, type SectionOf, type SectionRenderer } from '@portfolio/kit/sections';
import { Link, uiLangOf, Words } from '../parts';

// The practice, by its part (brief §5.6): `cat README.md` prints the thesis
// as prose; `ls <id>/` prints skill groups as directories of names;
// `tree <id>/` prints tool groups as a tree with versions; `man <id>`
// prints services as man-style blocks.

export const Practice: SectionRenderer<SectionOf<'practice'>> = ({ section, input }) => {
  const practice = input.portfolio.practice;
  const uiLang = uiLangOf(input);
  switch (section.part) {
    case 'thesis':
      return practice?.thesis ? (
        <RichText source={practice.thesis} input={input} className="sh-prose sh-readme" />
      ) : null;
    case 'skills':
      return (
        <div className="sh-dirs">
          {(practice?.skills ?? []).map((group, g) => (
            <div key={g}>
              {group.name ? (
                <p className="sh-dirs__dn sh-dir">
                  {group.name}/
                  {group.description ? (
                    <span className="sh-faint">
                      {' # '}
                      {group.description}
                    </span>
                  ) : null}
                </p>
              ) : null}
              <ul>
                {group.items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      );
    case 'tools':
      return (
        <div className="sh-trees">
          {(practice?.tools ?? []).map((group, g) => (
            <div className="sh-tree" key={g}>
              {group.name || group.description ? (
                <p className="sh-tree__dn">
                  {group.name ? <span className="sh-dir">{group.name}/</span> : null}
                  {group.description ? (
                    <span className="sh-faint">
                      {group.name ? ' # ' : '# '}
                      {group.description}
                    </span>
                  ) : null}
                </p>
              ) : null}
              <ul>
                {group.items.map((item, i) => (
                  <li key={i}>
                    <span>
                      {item.url ? (
                        <Link url={item.url} input={input}>
                          {item.name}
                        </Link>
                      ) : (
                        item.name
                      )}
                      {item.version ? <span className="sh-fig"> {item.version}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      );
    default:
      return (
        <div className="sh-svc">
          {(practice?.services ?? []).flatMap((group, g) => [
            group.name || group.description ? (
              <p key={`group-${g}`} className="sh-svc__grp">
                {group.name ? <b className="sh-dir">{group.name}/</b> : null}
                {group.description ? (
                  <span className="sh-faint">
                    {group.name ? ' # ' : '# '}
                    {group.description}
                  </span>
                ) : null}
              </p>
            ) : null,
            ...group.items.map((item, i) => (
              <div key={`${g}-${i}`}>
                <p className="sh-svc__nm">
                  <b>{item.name}</b>
                  {item.pricing ? <span className="sh-fig">{item.pricing}</span> : null}
                </p>
                <div className="sh-svc__body">
                  {item.description ? (
                    <RichText source={item.description} input={input} className="sh-prose sh-dim" />
                  ) : null}
                  {item.highlights?.length ? (
                    <ul className="sh-plus">
                      {item.highlights.map((text, h) => (
                        <li key={h}>{text}</li>
                      ))}
                    </ul>
                  ) : null}
                  {item.url ? (
                    <p>
                      <Link url={item.url} input={input}>
                        <Words lang={uiLang}>Ask about this</Words>
                      </Link>
                    </p>
                  ) : null}
                </div>
              </div>
            )),
          ])}
        </div>
      );
  }
};
