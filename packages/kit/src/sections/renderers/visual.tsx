import type { Discography, Gallery } from '@portfolio/schema';
import { formatTrackDuration } from '../../format';
import {
  ContentImage,
  DateText,
  deeper,
  Heading,
  LinkList,
  MaybeLink,
  Meta,
  renderContext,
  SectionHeader,
  TagList,
} from '../primitives';
import { RichText } from '../rich-text';
import type { SectionRendererProps } from '../types';

/** Images in the section's layout: plates, a grid, or columns, which styles.css lays out. */
export function GallerySection({ section, input, level }: SectionRendererProps<Gallery>) {
  const ctx = renderContext(input, section, level);
  return (
    <>
      <SectionHeader section={section} ctx={ctx} fallback="Gallery" />
      <ul className="pf-gallery" data-layout={section.layout}>
        {section.items.map((item, index) => {
          const meta = [
            item.takenAt !== undefined && <DateText key="taken" raw={item.takenAt} ctx={ctx} />,
            item.location,
          ];
          const hasCaption =
            item.caption !== undefined || meta.some(Boolean) || Boolean(item.tags?.length);
          return (
            <li key={index}>
              <ContentImage
                image={item.image}
                caption={
                  hasCaption ? (
                    <>
                      {item.caption !== undefined ? (
                        <p className="pf-caption">{item.caption}</p>
                      ) : null}
                      <Meta parts={meta} />
                      <TagList items={item.tags} />
                    </>
                  ) : undefined
                }
              />
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function DiscographySection({ section, input, level }: SectionRendererProps<Discography>) {
  const ctx = renderContext(input, section, level);
  return (
    <>
      <SectionHeader section={section} ctx={ctx} fallback="Discography" />
      <ul className="pf-list">
        {section.items.map((item, index) => (
          <li key={index} className="pf-item">
            {item.cover ? <ContentImage image={item.cover} className="pf-cover" /> : null}
            <Heading level={deeper(level)} className="pf-item__title">
              {item.title}
            </Heading>
            <Meta
              parts={[
                item.artist,
                item.role,
                item.releasedAt !== undefined && (
                  <DateText key="released" raw={item.releasedAt} ctx={ctx} />
                ),
                item.label,
              ]}
            />
            {item.description !== undefined ? <RichText source={item.description} /> : null}
            {item.tracks?.length ? (
              <ol className="pf-tracks">
                {item.tracks.map((track, trackIndex) => (
                  <li key={trackIndex}>
                    <MaybeLink url={track.url} ctx={ctx}>
                      {track.title}
                    </MaybeLink>
                    {track.durationSeconds !== undefined ? (
                      <>
                        {' '}
                        <span className="pf-track__duration">
                          {formatTrackDuration(track.durationSeconds)}
                        </span>
                      </>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : null}
            <LinkList links={item.links} ctx={ctx} />
          </li>
        ))}
      </ul>
    </>
  );
}
