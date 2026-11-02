import {
  deeper,
  formatNames,
  Heading,
  present,
  renderContext,
  RichText,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import { Button, Facts, Out, TileHead, Words } from '../parts';
import { ThesisTile } from './identity';

// The practice tiles. Skills are a spec sheet, a ruled row a group with its
// items as one sentence. Tools are a materials list, a ruled row a group,
// its tools on one line with their versions. Services are a menu, a ruled
// row an offer: its name and terms, what it is, and what it includes.

type PracticeProps = SectionRendererProps<SectionOf<'practice'>>;

function Skills({ section, input, level }: PracticeProps) {
  const ctx = renderContext(input, section, level);
  const groups = input.portfolio.practice?.skills ?? [];
  return (
    <>
      <TileHead title={section.title} subtitle={section.subtitle} level={level} />
      <dl className="sb-spec sb-ruled">
        {groups.map((group, index) => (
          <div key={index}>
            {present(group.name) ? <dt className="sb-strong">{group.name}</dt> : null}
            {present(group.description) ? <dd className="sb-label">{group.description}</dd> : null}
            <dd>{formatNames(group.items, ctx)}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

function Tools({ section, input, level }: PracticeProps) {
  const ctx = renderContext(input, section, level);
  const groups = input.portfolio.practice?.tools ?? [];
  return (
    <>
      <TileHead title={section.title} subtitle={section.subtitle} level={level} />
      <dl className="sb-spec sb-ruled">
        {groups.map((group, index) => (
          <div key={index}>
            {present(group.name) ? <dt className="sb-strong">{group.name}</dt> : null}
            {present(group.description) ? <dd className="sb-label">{group.description}</dd> : null}
            <dd>
              <ul className="sb-materials" role="list">
                {group.items.map((tool) => (
                  <li key={tool.name}>
                    {present(tool.url) ? (
                      <Out url={tool.url} ctx={ctx}>
                        {tool.name}
                      </Out>
                    ) : (
                      tool.name
                    )}
                    {present(tool.version) ? (
                      <span className="sb-materials__version"> {tool.version}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}

/** What an offer's own address asks of the visitor: to write, or to read on. */
const askWords = (url: string) => (/^mailto:/i.test(url) ? 'Email about this' : 'See the details');

function Services({ section, input, level }: PracticeProps) {
  const ctx = renderContext(input, section, level);
  const groups = input.portfolio.practice?.services ?? [];
  return (
    <>
      <TileHead title={section.title} subtitle={section.subtitle} level={level} />
      {groups.map((group, index) => (
        <div key={index} className="sb-menu">
          {present(group.name) ? (
            <Heading level={ctx.itemLevel} className="sb-strong">
              {group.name}
            </Heading>
          ) : null}
          {present(group.description) ? <p className="sb-quiet">{group.description}</p> : null}
          <ul className="sb-menu__offers sb-ruled" role="list">
            {group.items.map((offer, index) => (
              <li key={offer.name} className="sb-menu__offer">
                <div className="sb-menu__name">
                  <Heading
                    level={present(group.name) ? deeper(ctx.itemLevel) : ctx.itemLevel}
                    className="sb-title"
                  >
                    {offer.name}
                  </Heading>
                  <Facts className="sb-label" parts={[offer.pricing]} />
                </div>
                <div className="sb-menu__what">
                  {present(offer.description) ? (
                    <RichText source={offer.description} input={input} />
                  ) : null}
                  {offer.highlights?.length ? (
                    <ul className="sb-checks" role="list">
                      {offer.highlights.filter(present).map((highlight) => (
                        <li key={highlight}>{highlight}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                {present(offer.url) ? (
                  <p className="sb-menu__ask">
                    <Button url={offer.url} ctx={ctx} tone={index === 0 ? 'strong' : 'ghost'}>
                      <Words ctx={ctx}>{askWords(offer.url)}</Words>
                    </Button>
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

export function Practice(props: PracticeProps) {
  switch (props.section.part) {
    case 'thesis':
      return <ThesisTile {...props} />;
    case 'skills':
      return <Skills {...props} />;
    case 'tools':
      return <Tools {...props} />;
    case 'services':
      return <Services {...props} />;
  }
}
