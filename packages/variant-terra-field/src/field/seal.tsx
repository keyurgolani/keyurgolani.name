import type { Seal as SealModel } from '../model';

// The seal: the hero's one proof, set on the arc's lowest point. It's sized
// to its content (TF-M2): its label never breaks a word, because the label
// is at least as wide as its widest word, and the circle grows with it, so
// a long unit makes a larger seal, never "engineeri / ng". Its widest word
// sizes the circle from the opening (hero.tsx), which also clears its
// content above it. The model has already fallen back to the unit alone
// where the clause won't fit.

export function Seal({ seal }: { seal: SealModel }) {
  const body = (
    <>
      <span className="tf-seal__value tf-num">{seal.value}</span>
      {seal.label !== undefined ? <span className="tf-seal__label">{seal.label}</span> : null}
    </>
  );
  // The circle is the ground; the link is a circle inset inside it, so its
  // focus ring falls wholly on the seal's own ground, never across the field.
  return (
    <p className="tf-seal" lang={seal.lang}>
      {seal.href ? (
        <a className="tf-seal__link" href={seal.href}>
          {body}
        </a>
      ) : (
        <span className="tf-seal__link">{body}</span>
      )}
    </p>
  );
}
