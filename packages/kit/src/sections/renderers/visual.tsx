import type { Discography, Gallery } from '@portfolio/schema';
import { formatTrackDuration } from '../../format';
import {
  ContentImage,
  DateText,
  ItemTitle,
  LinkList,
  MaybeLink,
  Meta,
  present,
  renderContext,
  SectionHeader,
  TagList,
} from '../primitives';
import { RichText } from '../rich-text';
import type { SectionRendererProps } from '../types';

/**
 * Images in the section's layout: plates, a grid, or columns, which styles.css
 * lays out. An image without alt text takes its caption, since nothing else
 * says what it shows.
 */
export function GallerySection({ section, input, level }: SectionRendererProps<Gallery>) {
  const ctx = renderContext(input, section, level);
  return (
    <>
      <SectionHeader section={section} ctx={ctx} fallback="Gallery" />
      <ul className="pf-gallery" data-layout={section.layout} role="list">
        {section.items.map((item, index) => {
          const meta = [
            item.takenAt !== undefined && <DateText key="taken" raw={item.takenAt} ctx={ctx} />,
            item.location,
          ];
          const hasCaption =
            present(item.caption) ||
            meta.some((part) => (typeof part === 'string' ? present(part) : Boolean(part))) ||
            Boolean(item.tags?.some(present));
          return (
            <li key={index}>
              <ContentImage
                image={item.image}
                ctx={ctx}
                fallbackAlt={item.caption}
                caption={
                  hasCaption ? (
                    <>
                      {present(item.caption) ? <p className="pf-caption">{item.caption}</p> : null}
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
      <ul className="pf-list" role="list">
        {section.items.map((item, index) => (
          <li key={index} className="pf-item">
            {item.cover ? (
              // The title beside it names the release.
              <ContentImage image={item.cover} ctx={ctx} className="pf-cover" decorative />
            ) : null}
            <ItemTitle text={item.title} ctx={ctx} />
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
            {present(item.description) ? (
              <RichText source={item.description} input={input} />
            ) : null}
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
