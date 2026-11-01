import { Words } from '../parts';

// The phone bar (brief §5.2, step 4): below 48rem the capsule is the phone
// bar, the name and one button, and the destinations live in the Index
// dialog. The button keeps one element and one accessible name per width:
// "Index" beside the destinations on wide screens, "Menu" alone on a phone,
// where only one of the two words displays.

export function MenuWord({ lang }: { lang: 'en' | undefined }) {
  return (
    <>
      <span className="ag-wide">
        <Words lang={lang}>Index</Words>
      </span>
      <span className="ag-narrow">
        <Words lang={lang}>Menu</Words>
      </span>
    </>
  );
}
