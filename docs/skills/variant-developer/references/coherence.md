# Coherence — metaphor to tokens to typography to motion

> The pipeline that produces a visually coherent variant. Loaded during
> Phase 1 when you're translating a metaphor into actual design decisions,
> and during Phase 2 Wave 1 when writing tokens.

## The pipeline

1. **Metaphor** → 2. **Token palette** → 3. **Typography pairing** → 4. **Motion vocabulary**

Each stage constrains the next. A "printed editorial" metaphor leads to paper/ink tokens, which pairs with display-serif + body-serif typography, which uses still motion (no animation beyond CSS transitions). A "CRT terminal" metaphor leads to phosphor-on-black tokens, which pairs with monospace, which uses scanline + flicker motion.

## Stage 1 — Metaphor

The metaphor is a single sentence. Drift-resistant if it's specific. Bad metaphors:

- "Modern and clean" — describes nothing.
- "Like Stripe.com" — copies; doesn't drive new decisions.
- "Bold and futuristic" — says nothing about typography or color.

Good metaphors:

- "A printed monograph spread — cream paper, deep ink, sienna accent."
- "A CRT terminal at 22:14 on a green-phosphor monitor."
- "An obsidian-luxury depth-parallax — black on black, gold filigree."
- "A bento grid card system — white space, soft shadows, unmissable hierarchy."

The metaphor names a real thing. The agent and user can both picture it.

## Stage 2 — Token palette

Derive tokens from the metaphor's noun. "Printed monograph" → cream paper, deep ink, single accent. "CRT terminal" → black background, phosphor green, amber alarm-tone for accent. "Bento grid" → white surface, soft gray neutrals, one branded accent.

### Token derivation rules

- **Paper / surface** — the dominant background. The metaphor's "paper."
- **Ink / text** — primary foreground. Must contrast 4.5:1 against paper for body text, 3:1 for large headings.
- **Accent** — used sparingly. The single deliberate departure from monochrome. Reserve for links, emphasis, ctas. Never for body text.
- **Muted variants** — paper-muted, ink-muted, accent-muted. Used for hierarchy.
- **Rule lines** — semi-transparent ink for divider lines.

For each color scheme, define the same tokens with different values. Schemes must SHARE the metaphor — they're recolorings of the same skeleton, not different skeletons.

### Contrast targets

- Body text on paper: ≥4.5:1
- Large headings on paper: ≥3:1
- Link / accent on paper: ≥4.5:1 if standalone; ≥3:1 if surrounded by ink context
- Dark theme: same ratios apply with paper/ink swapped.

## Stage 3 — Typography pairing

A variant declares 1+ typography preset, each with up to 4 roles:

- **Display** — large headings, hero. Often a serif or geometric sans with high opsz scaling.
- **Body** — paragraphs, bullet text. Optimized for reading at body size (15-17px).
- **UI** — small labels, nav, marginalia. Higher x-height; sans-serif; Inter / Söhne / SF Pro level.
- **Mono** — code, technical data. JetBrains Mono / IBM Plex Mono.

### Pairing principles

- **Contrast or harmony.** Two pairings work: high contrast (serif display + sans body — magazine) or harmony (single family with multiple weights — minimalist). Mixed pairings within one preset usually look chaotic.
- **One mono, one UI** is enough. Don't pick three sans-serifs.
- **Display + body must work together at 4× size difference.** If they look weird stacked, change one.

### Typography preset count

Multiple presets share the metaphor but vary the *texture*. Editorial ships two: Classic (Fraunces display + Source Serif body — magazine) and Modernist (Inter Display + Source Serif body — Bauhaus-leaning). Both feel editorial; the difference is decisive but small.

## Stage 4 — Motion vocabulary

Motion taxonomy: `still | subtle | animated | kinetic`.

- **Still** — no motion beyond CSS transitions on hover/focus. Editorial-leaning.
- **Subtle** — fade-ins on scroll, gentle parallax. Most general-purpose variants.
- **Animated** — purposeful motion: hero entrance, section reveals, hover effects with substance.
- **Kinetic** — motion is part of the expression. Particle fields, continuous parallax, scroll-driven scenes.

The metaphor implies motion. "Printed monograph" → still. "CRT terminal" → animated (cursor blink, scanline). "Obsidian luxury" → kinetic (depth parallax). Pick the lowest tier the metaphor allows. Higher tier = more performance cost + more reduced-motion handling.

### Reduced-motion handling

Whatever your tier, you MUST respect `prefers-reduced-motion`. CSS:

```css
@media (prefers-reduced-motion: reduce) {
  [data-variant='your-slug'] *,
  [data-variant='your-slug'] *::before,
  [data-variant='your-slug'] *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

For `kinetic` variants, also gate `<canvas>` mounting on `useReducedMotion()` so the GPU isn't taxed when the user has asked for stillness.
