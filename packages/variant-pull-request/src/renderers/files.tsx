import {
  recordAnchor,
  renderContext,
  worksOf,
  type SectionOf,
  type SectionRenderer,
} from '@portfolio/kit/sections';
import { FileBlock } from '../diff';
import { fileOf } from '../model';
import { reviewOf } from '../parts';

// The files changed (issue #270, behaviour 3): one file a work, in the
// section's order. A work two sections list is a file in each; only the
// first carries its anchor, so a link to it lands once.

export const Files: SectionRenderer<SectionOf<'works'>> = ({ section, input, level }) => {
  const ctx = renderContext(input, section, level);
  const review = reviewOf(input);
  return (
    <div className="pr-files">
      {worksOf(section, input).map((work) => {
        const file = review.files.find((each) => each.id === work.id) ?? fileOf(work, section.id);
        return (
          <FileBlock
            key={work.id}
            file={file}
            work={work}
            section={section}
            input={input}
            review={review}
            level={ctx.itemLevel as 3 | 4}
            anchor={recordAnchor(section, work, input)}
          />
        );
      })}
    </div>
  );
};
