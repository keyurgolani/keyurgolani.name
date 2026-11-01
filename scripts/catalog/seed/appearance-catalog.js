export const LANGUAGE_TOKEN_KEYS = Object.freeze([
  'surface-material',
  'radius-control',
  'radius-card',
  'radius-overlay',
  'radius-media',
  'radius-badge',
  'border-control',
  'border-card',
  'border-divider',
  'shadow-card',
  'shadow-overlay',
  'shadow-raised',
  'shadow-inset',
  'surface-opacity',
  'backdrop-blur',
  'control-height',
  'space-control-inline',
  'space-control-block',
  'space-surface-inline',
  'space-surface-block',
  'focus-width',
  'focus-offset',
  'focus-style',
  'state-hover-transform',
  'state-active-transform',
  'state-selected-emphasis',
  'state-disabled-opacity',
  'state-loading-opacity',
  'state-validation-emphasis',
  'icon-stroke-width',
  'icon-fill',
  'motion-fast',
  'motion-standard',
  'motion-slow',
  'motion-easing',
  'motion-enter',
  'motion-exit',
  'motion-emphasis',
  'texture',
]);

export const COLOR_TOKEN_KEYS = Object.freeze([
  'canvas',
  'surface-subtle',
  'surface-default',
  'surface-prominent',
  'surface-overlay',
  'text-primary',
  'text-secondary',
  'text-muted',
  'text-inverse',
  'border-subtle',
  'border-default',
  'border-strong',
  'accent',
  'accent-hover',
  'accent-active',
  'on-accent',
  'focus',
  'selection',
  'positive',
  'warning',
  'danger',
  'information',
  'on-status',
  'data-categorical-1',
  'data-categorical-2',
  'data-categorical-3',
  'data-categorical-4',
  'data-categorical-5',
  'data-categorical-6',
  'data-sequential-start',
  'data-sequential-middle',
  'data-sequential-end',
]);

export const TYPOGRAPHY_ROLES = Object.freeze([
  'display',
  'headline',
  'title',
  'body',
  'body-compact',
  'label',
  'caption',
  'quote',
  'code',
  'numeric',
]);

export const TYPOGRAPHY_ROLE_FIELDS = Object.freeze([
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'font-variation-settings',
]);

export const TYPOGRAPHY_TOKEN_KEYS = Object.freeze([
  ...TYPOGRAPHY_ROLES.flatMap((role) =>
    TYPOGRAPHY_ROLE_FIELDS.map((field) => `${role}-${field}`),
  ),
  'measure-body',
  'measure-compact',
]);

const SHAPES = Object.freeze({
  square: ['0', '0', '0', '0', '0'],
  tight: ['4px', '8px', '10px', '6px', '999px'],
  soft: ['10px', '18px', '24px', '16px', '999px'],
  pill: ['999px', '24px', '28px', '20px', '999px'],
  organic: [
    '16px 24px',
    '28px 18px 30px 16px',
    '30px 20px',
    '24px 16px',
    '999px',
  ],
  skeuo: ['6px', '12px', '14px', '10px', '999px'],
  deco: ['2px 12px', '2px 18px', '2px 20px', '0', '999px'],
  cut: ['0 10px', '0 16px', '0 20px', '0 12px', '0'],
  pixel: ['0', '0', '0', '0', '0'],
});

const BORDERS = Object.freeze({
  none: ['0 solid', '0 solid', '0 solid', 'solid'],
  hairline: ['1px solid', '1px solid', '1px solid', 'solid'],
  strong: ['2px solid', '2px solid', '2px solid', 'solid'],
  raw: ['3px solid', '3px solid', '3px solid', 'solid'],
  double: ['3px double', '3px double', '1px solid', 'double'],
  dashed: ['1px dashed', '1px dashed', '1px dashed', 'dashed'],
  bevel: ['2px outset', '2px outset', '2px groove', 'solid'],
});

const FOCUS_BY_BORDER = Object.freeze({
  none: ['2px', '2px'],
  hairline: ['2px', '2px'],
  strong: ['3px', '3px'],
  raw: ['4px', '3px'],
  double: ['3px', '3px'],
  dashed: ['3px', '3px'],
  bevel: ['3px', '3px'],
});

const MATERIALS = Object.freeze({
  solid: ['solid', '100%', '0px'],
  translucent: ['translucent', '92%', '8px'],
  frosted: ['frosted', '78%', '18px'],
  refractive: ['refractive', '66%', '28px'],
  'soft-extruded': ['soft-extruded', '100%', '0px'],
  clay: ['clay', '100%', '0px'],
  skeuomorphic: ['skeuomorphic', '100%', '0px'],
  paper: ['paper', '100%', '0px'],
  metallic: ['metallic', '96%', '4px'],
  glossy: ['glossy', '86%', '16px'],
});

const MATERIAL_FORMULAS = Object.freeze({
  solid:
    'linear-gradient(var(--appearance-surface-default), var(--appearance-surface-default))',
  translucent:
    'linear-gradient(color-mix(in srgb, var(--appearance-surface-default) 92%, transparent), color-mix(in srgb, var(--appearance-surface-default) 92%, transparent))',
  frosted:
    'linear-gradient(145deg, color-mix(in srgb, var(--appearance-surface-prominent) 52%, transparent), color-mix(in srgb, var(--appearance-surface-default) 74%, transparent))',
  refractive:
    'linear-gradient(135deg, color-mix(in srgb, var(--appearance-accent) 14%, transparent), color-mix(in srgb, var(--appearance-information) 10%, transparent), color-mix(in srgb, var(--appearance-surface-default) 70%, transparent))',
  'soft-extruded':
    'linear-gradient(145deg, var(--appearance-surface-prominent), var(--appearance-surface-subtle))',
  clay:
    'linear-gradient(160deg, var(--appearance-surface-prominent), var(--appearance-surface-default))',
  skeuomorphic:
    'linear-gradient(180deg, var(--appearance-surface-prominent), var(--appearance-surface-default) 48%, var(--appearance-surface-subtle))',
  paper:
    'linear-gradient(175deg, var(--appearance-surface-prominent), var(--appearance-surface-default))',
  metallic:
    'linear-gradient(135deg, var(--appearance-surface-subtle), var(--appearance-surface-prominent) 45%, var(--appearance-surface-default) 55%, var(--appearance-surface-subtle))',
  glossy:
    'linear-gradient(165deg, color-mix(in srgb, var(--appearance-text-inverse) 22%, transparent), transparent 38%), linear-gradient(var(--appearance-surface-prominent), var(--appearance-surface-default))',
});

const DENSITIES = Object.freeze({
  compact: ['2rem', '0.625rem', '0.375rem', '0.75rem', '0.625rem'],
  normal: ['2.5rem', '0.875rem', '0.625rem', '1rem', '1rem'],
  comfortable: ['2.875rem', '1.125rem', '0.75rem', '1.25rem', '1.25rem'],
  editorial: ['2.75rem', '1rem', '0.75rem', '1.5rem', '1.5rem'],
});

const ICONS = Object.freeze({
  'outline-150': ['1.5', 'none'],
  'outline-175': ['1.75', 'none'],
  'outline-200': ['2', 'none'],
  filled: ['1.5', 'currentColor'],
  pixel: ['2', 'currentColor'],
});

const SHADOW = Object.freeze({
  line: '0 1px 0 var(--appearance-border-subtle)',
  low:
    '0 2px 8px color-mix(in srgb, var(--appearance-text-primary) 12%, transparent)',
  medium:
    '0 10px 28px color-mix(in srgb, var(--appearance-text-primary) 16%, transparent)',
  high:
    '0 22px 60px color-mix(in srgb, var(--appearance-text-primary) 22%, transparent)',
  inset:
    'inset 2px 2px 5px color-mix(in srgb, var(--appearance-text-primary) 16%, transparent)',
  hard: '5px 5px 0 var(--appearance-border-strong)',
  hardStrong: '8px 8px 0 var(--appearance-border-strong)',
});

const ELEVATIONS = Object.freeze({
  none: ['none', 'none', 'none', 'none'],
  line: [SHADOW.line, SHADOW.low, SHADOW.low, 'none'],
  low: [SHADOW.low, SHADOW.medium, SHADOW.medium, SHADOW.inset],
  medium: [SHADOW.medium, SHADOW.high, SHADOW.high, SHADOW.inset],
  high: [SHADOW.high, SHADOW.high, SHADOW.high, SHADOW.inset],
  inset: [SHADOW.inset, SHADOW.medium, SHADOW.low, SHADOW.inset],
  hard: [SHADOW.hard, SHADOW.hardStrong, SHADOW.hardStrong, 'none'],
});

const MOTION = Object.freeze({
  still: [
    'none',
    'none',
    '2px',
    '0.45',
    '0.65',
    '2px',
    '0.01ms',
    '0.01ms',
    '0.01ms',
    'linear',
    'none',
    'none',
    'none',
  ],
  precise: [
    'translateY(-1px)',
    'scale(0.98)',
    '2px',
    '0.45',
    '0.65',
    '2px',
    '100ms',
    '160ms',
    '220ms',
    'cubic-bezier(0.2, 0, 0, 1)',
    'fade-rise',
    'fade',
    'pulse-once',
  ],
  fluid: [
    'translateY(-2px)',
    'scale(0.985)',
    '2px',
    '0.45',
    '0.65',
    '2px',
    '140ms',
    '240ms',
    '360ms',
    'cubic-bezier(0.2, 0.8, 0.2, 1)',
    'fade-rise',
    'fade',
    'float-once',
  ],
  spring: [
    'translateY(-2px) scale(1.01)',
    'scale(0.96)',
    '3px',
    '0.45',
    '0.65',
    '3px',
    '160ms',
    '320ms',
    '480ms',
    'cubic-bezier(0.16, 1, 0.3, 1)',
    'spring-in',
    'fade',
    'bounce-once',
  ],
  kinetic: [
    'translate(-2px, -2px)',
    'translate(1px, 1px)',
    '3px',
    '0.5',
    '0.7',
    '3px',
    '120ms',
    '220ms',
    '420ms',
    'cubic-bezier(0.16, 1, 0.3, 1)',
    'slide-cut',
    'fade',
    'glitch-once',
  ],
  stepped: [
    'translate(-2px, -2px)',
    'translate(2px, 2px)',
    '3px',
    '0.5',
    '0.7',
    '3px',
    '80ms',
    '160ms',
    '240ms',
    'steps(4, end)',
    'pixel-in',
    'pixel-out',
    'blink-once',
  ],
});

const TEXTURES = Object.freeze({
  none: 'none',
  grain:
    'radial-gradient(circle, color-mix(in srgb, var(--appearance-text-primary) 12%, transparent) 0 0.5px, transparent 0.75px)',
  grid:
    'linear-gradient(var(--appearance-border-subtle) 1px, transparent 1px), linear-gradient(90deg, var(--appearance-border-subtle) 1px, transparent 1px)',
  iridescent:
    'linear-gradient(120deg, color-mix(in srgb, var(--appearance-accent) 18%, transparent), transparent 32%, color-mix(in srgb, var(--appearance-information) 16%, transparent) 68%, transparent)',
  paper:
    'repeating-linear-gradient(0deg, transparent 0 3px, color-mix(in srgb, var(--appearance-border-subtle) 35%, transparent) 3px 4px)',
  noise:
    'radial-gradient(circle, color-mix(in srgb, var(--appearance-text-primary) 20%, transparent) 0 1px, transparent 1.25px)',
  halftone:
    'radial-gradient(circle, var(--appearance-border-strong) 0 1px, transparent 1.5px)',
  geometric:
    'conic-gradient(from 45deg, color-mix(in srgb, var(--appearance-accent) 12%, transparent) 0 25%, transparent 0 50%, color-mix(in srgb, var(--appearance-information) 10%, transparent) 0 75%, transparent 0)',
  etched:
    'repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in srgb, var(--appearance-border-subtle) 50%, transparent) 5px 6px)',
  pattern:
    'radial-gradient(circle at 25% 25%, color-mix(in srgb, var(--appearance-accent) 20%, transparent) 0 8%, transparent 9%), radial-gradient(circle at 75% 70%, color-mix(in srgb, var(--appearance-information) 18%, transparent) 0 10%, transparent 11%)',
  scanline:
    'repeating-linear-gradient(0deg, transparent 0 3px, color-mix(in srgb, var(--appearance-text-primary) 10%, transparent) 3px 4px)',
  dither:
    'radial-gradient(circle, var(--appearance-border-default) 0 1px, transparent 1px)',
  bubbles:
    'radial-gradient(circle at 18% 22%, color-mix(in srgb, var(--appearance-accent) 18%, transparent) 0 8%, transparent 9%), radial-gradient(circle at 82% 68%, color-mix(in srgb, var(--appearance-information) 16%, transparent) 0 12%, transparent 13%)',
});

const LANGUAGE_RECIPE_BLUEPRINTS = Object.freeze({
  neutral: ['soft', 'hairline', 'solid', 'normal', 'low', 'precise', 'none', 'outline-175'],
  material: ['pill', 'hairline', 'solid', 'comfortable', 'medium', 'fluid', 'none', 'outline-200'],
  'organic-material': ['organic', 'hairline', 'solid', 'comfortable', 'medium', 'spring', 'none', 'filled'],
  fluent: ['soft', 'hairline', 'translucent', 'normal', 'low', 'fluid', 'grain', 'outline-150'],
  carbon: ['tight', 'hairline', 'solid', 'compact', 'none', 'precise', 'grid', 'outline-200'],
  spectrum: ['soft', 'hairline', 'solid', 'normal', 'low', 'precise', 'none', 'outline-150'],
  primer: ['tight', 'hairline', 'solid', 'compact', 'low', 'precise', 'none', 'outline-150'],
  commerce: ['soft', 'hairline', 'solid', 'normal', 'low', 'precise', 'none', 'outline-175'],
  enterprise: ['tight', 'hairline', 'solid', 'compact', 'none', 'precise', 'none', 'outline-175'],
  ant: ['tight', 'hairline', 'solid', 'compact', 'low', 'precise', 'none', 'outline-150'],
  radix: ['soft', 'hairline', 'solid', 'normal', 'low', 'precise', 'none', 'outline-150'],
  flat: ['square', 'hairline', 'solid', 'normal', 'none', 'still', 'none', 'outline-200'],
  dense: ['tight', 'hairline', 'solid', 'compact', 'none', 'precise', 'none', 'outline-175'],
  organic: ['organic', 'hairline', 'solid', 'comfortable', 'low', 'spring', 'grain', 'outline-150'],
  grid: ['square', 'strong', 'solid', 'compact', 'none', 'precise', 'grid', 'outline-200'],
  monochrome: ['tight', 'hairline', 'solid', 'compact', 'line', 'still', 'none', 'outline-200'],
  glass: ['soft', 'hairline', 'frosted', 'normal', 'medium', 'fluid', 'none', 'outline-150'],
  refractive: ['organic', 'hairline', 'refractive', 'comfortable', 'high', 'fluid', 'iridescent', 'outline-150'],
  soft: ['soft', 'none', 'soft-extruded', 'comfortable', 'inset', 'fluid', 'none', 'outline-150'],
  clay: ['pill', 'strong', 'clay', 'comfortable', 'high', 'spring', 'grain', 'filled'],
  skeuomorphic: ['skeuo', 'strong', 'skeuomorphic', 'comfortable', 'high', 'spring', 'grain', 'filled'],
  paper: ['tight', 'hairline', 'paper', 'editorial', 'low', 'still', 'paper', 'outline-175'],
  'raw-brutal': ['square', 'raw', 'solid', 'compact', 'none', 'still', 'noise', 'outline-200'],
  'neo-brutal': ['tight', 'raw', 'solid', 'normal', 'hard', 'spring', 'halftone', 'filled'],
  bauhaus: ['square', 'strong', 'solid', 'normal', 'none', 'precise', 'geometric', 'filled'],
  deco: ['deco', 'double', 'metallic', 'normal', 'low', 'precise', 'etched', 'outline-200'],
  memphis: ['organic', 'strong', 'solid', 'comfortable', 'hard', 'spring', 'pattern', 'filled'],
  luxury: ['tight', 'hairline', 'translucent', 'editorial', 'medium', 'fluid', 'grain', 'outline-150'],
  industrial: ['tight', 'strong', 'metallic', 'compact', 'inset', 'precise', 'grid', 'outline-200'],
  blueprint: ['square', 'dashed', 'translucent', 'compact', 'none', 'precise', 'grid', 'outline-150'],
  terminal: ['square', 'hairline', 'translucent', 'compact', 'none', 'precise', 'scanline', 'outline-150'],
  'retro-web': ['square', 'bevel', 'skeuomorphic', 'compact', 'inset', 'still', 'dither', 'filled'],
  pixel: ['pixel', 'raw', 'solid', 'compact', 'hard', 'stepped', 'dither', 'pixel'],
  aero: ['soft', 'hairline', 'glossy', 'comfortable', 'high', 'fluid', 'bubbles', 'outline-150'],
  y2k: ['pill', 'hairline', 'frosted', 'comfortable', 'medium', 'spring', 'iridescent', 'outline-150'],
  synthwave: ['square', 'strong', 'translucent', 'normal', 'hard', 'kinetic', 'grid', 'outline-200'],
  vaporwave: ['soft', 'hairline', 'frosted', 'comfortable', 'medium', 'fluid', 'grain', 'outline-150'],
  cyber: ['cut', 'strong', 'translucent', 'compact', 'hard', 'kinetic', 'grid', 'outline-200'],
  holographic: ['organic', 'hairline', 'refractive', 'comfortable', 'high', 'fluid', 'iridescent', 'outline-150'],
  collage: ['cut', 'raw', 'paper', 'editorial', 'hard', 'still', 'paper', 'filled'],
});

function buildLanguageTokens(recipeName) {
  const [
    shapeName,
    borderName,
    materialName,
    densityName,
    elevationName,
    motionName,
    textureName,
    iconName,
  ] = LANGUAGE_RECIPE_BLUEPRINTS[recipeName];
  const [radiusControl, radiusCard, radiusOverlay, radiusMedia, radiusBadge] =
    SHAPES[shapeName];
  const [borderControl, borderCard, borderDivider, focusStyle] =
    BORDERS[borderName];
  const [surfaceMaterialName, surfaceOpacity, backdropBlur] =
    MATERIALS[materialName];
  const [
    controlHeight,
    spaceControlInline,
    spaceControlBlock,
    spaceSurfaceInline,
    spaceSurfaceBlock,
  ] = DENSITIES[densityName];
  const [shadowCard, shadowOverlay, shadowRaised, shadowInset] =
    ELEVATIONS[elevationName];
  const [focusWidth, focusOffset] = FOCUS_BY_BORDER[borderName];
  const [
    stateHoverTransform,
    stateActiveTransform,
    stateSelectedEmphasis,
    stateDisabledOpacity,
    stateLoadingOpacity,
    stateValidationEmphasis,
    motionFast,
    motionStandard,
    motionSlow,
    motionEasing,
    motionEnter,
    motionExit,
    motionEmphasis,
  ] = MOTION[motionName];
  const [iconStrokeWidth, iconFill] = ICONS[iconName];

  return Object.freeze({
    'surface-material': MATERIAL_FORMULAS[surfaceMaterialName],
    'radius-control': radiusControl,
    'radius-card': radiusCard,
    'radius-overlay': radiusOverlay,
    'radius-media': radiusMedia,
    'radius-badge': radiusBadge,
    'border-control': borderControl,
    'border-card': borderCard,
    'border-divider': borderDivider,
    'shadow-card': shadowCard,
    'shadow-overlay': shadowOverlay,
    'shadow-raised': shadowRaised,
    'shadow-inset': shadowInset,
    'surface-opacity': surfaceOpacity,
    'backdrop-blur': backdropBlur,
    'control-height': controlHeight,
    'space-control-inline': spaceControlInline,
    'space-control-block': spaceControlBlock,
    'space-surface-inline': spaceSurfaceInline,
    'space-surface-block': spaceSurfaceBlock,
    'focus-width': focusWidth,
    'focus-offset': focusOffset,
    'focus-style': focusStyle,
    'state-hover-transform': stateHoverTransform,
    'state-active-transform': stateActiveTransform,
    'state-selected-emphasis': stateSelectedEmphasis,
    'state-disabled-opacity': stateDisabledOpacity,
    'state-loading-opacity': stateLoadingOpacity,
    'state-validation-emphasis': stateValidationEmphasis,
    'icon-stroke-width': iconStrokeWidth,
    'icon-fill': iconFill,
    'motion-fast': motionFast,
    'motion-standard': motionStandard,
    'motion-slow': motionSlow,
    'motion-easing': motionEasing,
    'motion-enter': motionEnter,
    'motion-exit': motionExit,
    'motion-emphasis': motionEmphasis,
    texture: TEXTURES[textureName],
  });
}

const LANGUAGE_BLUEPRINTS = [
  ['platform-neutral', 'product-system', 'neutral'],
  ['material-3-inspired', 'product-system', 'material'],
  ['material-expressive-inspired', 'product-system', 'organic-material'],
  ['fluent-2-inspired', 'product-system', 'fluent'],
  ['carbon-inspired', 'product-system', 'carbon'],
  ['spectrum-2-inspired', 'product-system', 'spectrum'],
  ['primer-inspired', 'product-system', 'primer'],
  ['polaris-inspired', 'product-system', 'commerce'],
  ['atlassian-inspired', 'product-system', 'enterprise'],
  ['ant-inspired', 'product-system', 'ant'],
  ['radix-inspired', 'product-system', 'radix'],
  ['minimal-flat', 'modern-foundation', 'flat'],
  ['utility-dense', 'modern-foundation', 'dense'],
  ['soft-organic', 'modern-foundation', 'organic'],
  ['international-grid', 'modern-foundation', 'grid'],
  ['monochrome-functional', 'modern-foundation', 'monochrome'],
  ['glassmorphism', 'material-effect', 'glass'],
  ['refractive-glass', 'material-effect', 'refractive'],
  ['neumorphic', 'material-effect', 'soft'],
  ['claymorphic', 'material-effect', 'clay'],
  ['skeuomorphic', 'material-effect', 'skeuomorphic'],
  ['paper-tactile', 'material-effect', 'paper'],
  ['raw-brutalist', 'graphic-movement', 'raw-brutal'],
  ['neobrutalist', 'graphic-movement', 'neo-brutal'],
  ['bauhaus-geometric', 'graphic-movement', 'bauhaus'],
  ['art-deco', 'graphic-movement', 'deco'],
  ['memphis', 'graphic-movement', 'memphis'],
  ['atelier-luxury', 'graphic-movement', 'luxury'],
  ['industrial', 'technical', 'industrial'],
  ['blueprint', 'technical', 'blueprint'],
  ['terminal-chrome', 'technical', 'terminal'],
  ['retro-web', 'technical', 'retro-web'],
  ['pixel-interface', 'technical', 'pixel'],
  ['frutiger-aero', 'expressive', 'aero'],
  ['y2k-translucent', 'expressive', 'y2k'],
  ['synthwave', 'expressive', 'synthwave'],
  ['vaporwave', 'expressive', 'vaporwave'],
  ['cyberpunk', 'expressive', 'cyber'],
  ['holographic-iridescent', 'expressive', 'holographic'],
  ['handcrafted-collage', 'expressive', 'collage'],
];

const STABLE_LANGUAGE_IDS = new Set([
  'platform-neutral',
  'material-3-inspired',
  'fluent-2-inspired',
  'carbon-inspired',
  'spectrum-2-inspired',
  'primer-inspired',
  'minimal-flat',
  'soft-organic',
  'international-grid',
  'glassmorphism',
  'paper-tactile',
  'neobrutalist',
]);

const EXTENDED_LANGUAGE_IDS = new Set([
  'material-expressive-inspired',
  'polaris-inspired',
  'atlassian-inspired',
  'ant-inspired',
  'radix-inspired',
  'utility-dense',
  'monochrome-functional',
  'refractive-glass',
  'raw-brutalist',
  'bauhaus-geometric',
  'art-deco',
  'memphis',
  'atelier-luxury',
  'industrial',
  'blueprint',
  'terminal-chrome',
  'frutiger-aero',
  'handcrafted-collage',
]);

const SYSTEM_SOURCES = Object.freeze({
  'material-3-inspired': ['Material Design', 'https://m3.material.io/'],
  'material-expressive-inspired': [
    'Material Design',
    'https://m3.material.io/',
  ],
  'fluent-2-inspired': ['Fluent 2', 'https://fluent2.microsoft.design/'],
  'carbon-inspired': ['Carbon', 'https://carbondesignsystem.com/'],
  'spectrum-2-inspired': ['Spectrum 2', 'https://spectrum.adobe.com/'],
  'primer-inspired': ['Primer', 'https://primer.style/'],
  'polaris-inspired': ['Polaris', 'https://polaris.shopify.com/'],
  'atlassian-inspired': ['Atlassian', 'https://atlassian.design/'],
  'ant-inspired': ['Ant Design', 'https://ant.design/'],
  'radix-inspired': ['Radix Themes', 'https://www.radix-ui.com/themes'],
});

function titleCaseId(id) {
  const overrides = {
    'material-3-inspired': 'Material 3 Inspired',
    'material-expressive-inspired': 'Material Expressive Inspired',
    'fluent-2-inspired': 'Fluent 2 Inspired',
    'spectrum-2-inspired': 'Spectrum 2 Inspired',
    'y2k-translucent': 'Y2K Translucent',
  };
  return (
    overrides[id] ??
    id
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  );
}

export const DESIGN_LANGUAGES = Object.freeze(
  LANGUAGE_BLUEPRINTS.map(([id, family, recipe]) => {
    const source = SYSTEM_SOURCES[id];
    return Object.freeze({
      id,
      name: titleCaseId(id),
      family,
      status: STABLE_LANGUAGE_IDS.has(id)
        ? 'stable'
        : EXTENDED_LANGUAGE_IDS.has(id)
          ? 'extended'
          : 'experimental',
      version: 'review-1',
      tokenContractVersion: 'review-1',
      researchedAt: '2026-10-17',
      referenceOnly: false,
      recipe,
      material: LANGUAGE_RECIPE_BLUEPRINTS[recipe][2],
      texture: LANGUAGE_RECIPE_BLUEPRINTS[recipe][6],
      tokens: buildLanguageTokens(recipe),
      source: Object.freeze({
        name: source?.[0] ?? 'Internal review synthesis',
        url: source?.[1] ?? null,
        licenseState: source
          ? 'independent-inspired-interpretation'
          : 'internal-prototype',
        note: source
          ? 'Independent visual interpretation; no official components bundled.'
          : 'Original prototype language assembled for this review.',
      }),
    });
  }),
);

function parseAnchor(anchor) {
  if (!anchor) return null;
  const [canvas, text, accent, secondary] = anchor.split('/');
  return {
    canvas: `#${canvas}`,
    text: `#${text}`,
    accent: `#${accent}`,
    secondary: `#${secondary}`,
  };
}

function mix(a, b, percentB) {
  return `color-mix(in srgb, ${a} ${100 - percentB}%, ${b} ${percentB}%)`;
}

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b]
    .map((value) => Math.round(value).toString(16).padStart(2, '0'))
    .join('')}`;
}

function channelLuminance(value) {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  );
}

function contrastRatio(first, second) {
  const lighter = Math.max(luminance(first), luminance(second));
  const darker = Math.min(luminance(first), luminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

function mixHex(first, second, amount) {
  const a = hexToRgb(first);
  const b = hexToRgb(second);
  return rgbToHex({
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount,
  });
}

function ensureContrastOnBlack(color, target = 7) {
  let candidate = color;
  for (let amount = 0; amount <= 1 && contrastRatio(candidate, '#000000') < target; amount += 0.05) {
    candidate = mixHex(color, '#ffffff', amount);
  }
  return candidate;
}

function higherContrast(first, second, background) {
  return contrastRatio(first, background) >= contrastRatio(second, background)
    ? first
    : second;
}

function deriveColorTokens(seed, mode) {
  const dark = mode === 'dark';
  const surfacePercentages = dark ? [6, 10, 16, 12] : [3, 6, 10, 2];
  const borderPercentages = dark ? [18, 30, 48] : [12, 24, 40];
  const positive = dark ? '#78d39b' : '#2e8b57';
  const warning = dark ? '#ffc264' : '#9b5700';
  const danger = dark ? '#ff8e9c' : '#b53143';
  const onAccent = higherContrast(seed.text, seed.canvas, seed.accent);
  const onStatus = higherContrast(seed.text, seed.canvas, positive);

  return Object.freeze({
    canvas: seed.canvas,
    'surface-subtle': mix(seed.canvas, seed.text, surfacePercentages[0]),
    'surface-default': mix(seed.canvas, seed.text, surfacePercentages[1]),
    'surface-prominent': mix(seed.canvas, seed.text, surfacePercentages[2]),
    'surface-overlay': mix(seed.canvas, seed.text, surfacePercentages[3]),
    'text-primary': seed.text,
    'text-secondary': mix(seed.text, seed.canvas, 28),
    'text-muted': mix(seed.text, seed.canvas, dark ? 34 : 44),
    'text-inverse': seed.canvas,
    'border-subtle': mix(seed.canvas, seed.text, borderPercentages[0]),
    'border-default': mix(seed.canvas, seed.text, borderPercentages[1]),
    'border-strong': mix(seed.canvas, seed.text, borderPercentages[2]),
    accent: seed.accent,
    'accent-hover': mix(seed.accent, seed.text, 12),
    'accent-active': mix(seed.accent, seed.text, 22),
    'on-accent': onAccent,
    focus: seed.accent,
    selection: mix(seed.canvas, seed.accent, 34),
    positive,
    warning,
    danger,
    information: seed.secondary,
    'on-status': onStatus,
    'data-categorical-1': seed.accent,
    'data-categorical-2': seed.secondary,
    'data-categorical-3': positive,
    'data-categorical-4': warning,
    'data-categorical-5': danger,
    'data-categorical-6': seed.secondary,
    'data-sequential-start': mix(seed.canvas, seed.accent, 28),
    'data-sequential-middle': mix(seed.canvas, seed.accent, 58),
    'data-sequential-end': mix(seed.canvas, seed.accent, 88),
  });
}

function deriveHighContrastTokens(light, dark) {
  const seed = dark ?? light;
  const accent = ensureContrastOnBlack(seed.accent);
  const information = ensureContrastOnBlack(seed.secondary);
  const positive = ensureContrastOnBlack('#2e8b57');
  const warning = ensureContrastOnBlack('#b66a00');
  const danger = ensureContrastOnBlack('#c43d4d');

  return Object.freeze({
    derivedMode: 'high-contrast-v1',
    canvas: '#000000',
    'surface-subtle': '#0a0a0a',
    'surface-default': '#111111',
    'surface-prominent': '#1a1a1a',
    'surface-overlay': '#000000',
    'text-primary': '#ffffff',
    'text-secondary': '#ffffff',
    'text-muted': '#e8e8e8',
    'text-inverse': '#000000',
    'border-subtle': '#ffffff',
    'border-default': '#ffffff',
    'border-strong': '#ffffff',
    accent,
    'accent-hover': mixHex(accent, '#ffffff', 0.12),
    'accent-active': mixHex(accent, '#ffffff', 0.22),
    'on-accent': '#000000',
    focus: '#ffffff',
    selection: accent,
    positive,
    warning,
    danger,
    information,
    'on-status': '#000000',
    'data-categorical-1': accent,
    'data-categorical-2': information,
    'data-categorical-3': positive,
    'data-categorical-4': warning,
    'data-categorical-5': danger,
    'data-categorical-6': '#ffffff',
    'data-sequential-start': mixHex('#000000', accent, 0.4),
    'data-sequential-middle': mixHex('#000000', accent, 0.7),
    'data-sequential-end': accent,
  });
}

const COLOR_BLUEPRINTS = [
  ['neutral-slate', 'neutral', 'dual', 'f7f8fa/18202c/315fbd/64748b', '11151c/edf2f7/7aa2f7/94a3b8'],
  ['graphite', 'neutral', 'dual', 'f4f4f3/1c1d1f/555b66/8a5a44', '151618/f0f1f2/a8b0bd/d09a7a'],
  ['zinc', 'neutral', 'dual', 'fafafa/18181b/52525b/7c3aed', '09090b/fafafa/a1a1aa/a78bfa'],
  ['paper-ink', 'neutral', 'dual', 'fbf7ef/1f1c18/a4432d/315b62', '1c1915/f7efe1/e28b6d/7fb0b7'],
  ['warm-parchment', 'neutral', 'dual', 'f6eddc/2b241c/b95f32/5f7653', '251f19/f4e8d2/f09d70/9db38d'],
  ['oled-black', 'neutral', 'native-dark', null, '000000/f5f5f2/67e8f9/c084fc'],
  ['high-contrast', 'accessible', 'dual', 'ffffff/000000/0047ff/7a00cc', '000000/ffffff/66a3ff/ff7ad9'],
  ['low-stimulus-warm', 'accessible', 'dual', 'f4efe6/342f29/806857/6d7567', '26231f/e8e0d4/b89c86/a5ad9b'],
  ['blue-orange-color-safe', 'accessible', 'dual', 'fffaf2/17243a/0067b9/d46b08', '101827/f7f4ed/5eb3ff/ffad5c'],
  ['cool-color-safe', 'accessible', 'dual', 'f7fbff/132238/1769aa/6f4aa8', '0f1824/eef7ff/68b5e8/b99ae8'],
  ['reduced-chroma', 'accessible', 'dual', 'f3f2ef/2e3033/69717a/85776e', '232426/e7e5e0/9ca6ad/b2a49a'],
  ['forest-moss', 'natural', 'dual', 'f2f5ec/1f2b20/3f6b45/8a6b3f', '142017/edf4e9/7fb487/c29a62'],
  ['everforest', 'natural', 'dual', 'fdf6e3/5c6a72/8da101/dfa000', '2d353b/d3c6aa/a7c080/dbbc7f'],
  ['botanical-sage', 'natural', 'dual', 'f4f6ef/243028/668b6b/ad7f65', '17211b/edf3ea/91b997/d2a088'],
  ['ocean-abyss', 'natural', 'dual', 'eef8fb/102d3a/007d91/4c5fa8', '071b24/e8f8fb/42c6d7/8497ef'],
  ['arctic-aurora', 'natural', 'dual', 'f1f8fb/16323c/2e8fa3/8b63b8', '0b1d28/e7fbff/59d6cb/c18beb'],
  ['desert-terracotta', 'natural', 'dual', 'fbf0e2/3c2820/b55436/a68547', '2b1d19/f9e5d0/e47c58/d1b16c'],
  ['earthy-clay', 'natural', 'dual', 'f3eadf/382b24/9b5d45/677054', '2a211d/efe2d4/c98568/9ba080'],
  ['sunset-ember', 'expressive', 'dual', 'fff1e6/3a1d26/e4583e/7c4ea3', '21101a/fff0e5/ff7963/b690e8'],
  ['jewel-twilight', 'expressive', 'dual', 'f4eef8/251b35/7b3fa1/087f78', '171020/f5ecfb/c47ee8/42c9bd'],
  ['lavender-dusk', 'expressive', 'dual', 'f6f0fb/2d2541/8064b4/b05c82', '211a31/f4eafb/bba0eb/dd8aac'],
  ['coral-lagoon', 'expressive', 'dual', 'fff3ef/24343a/e85d55/078f96', '10272c/f3ffff/ff8b80/4cc7cb'],
  ['pastel-sorbet', 'expressive', 'dual', 'fff7fb/33263b/e477a8/6ea8a1', '302437/fff3fa/f3a1c6/9bcfc8'],
  ['neon-city', 'expressive', 'native-dark', null, '090814/f4f3ff/ff42b3/28e7f2'],
  ['iridescent-pearl', 'expressive', 'native-light', 'faf8ff/282638/8c72d9/4caeb3', null],
  ['sepia-film', 'expressive', 'dual', 'f4e2c5/30251b/9a4f32/6e7658', '241a13/f0d8b6/cb7654/a0a77d'],
  ['catppuccin', 'established-open-source', 'dual', 'eff1f5/4c4f69/8839ef/179299', '1e1e2e/cdd6f4/cba6f7/89dceb'],
  ['solarized', 'established-open-source', 'dual', 'fdf6e3/657b83/268bd2/2aa198', '002b36/839496/268bd2/2aa198'],
  ['gruvbox', 'established-open-source', 'dual', 'fbf1c7/3c3836/b57614/427b58', '282828/ebdbb2/fabd2f/83a598'],
  ['rose-pine', 'established-open-source', 'dual', 'faf4ed/575279/d7827e/286983', '191724/e0def4/ebbcba/31748f'],
  ['tokyo-night', 'established-open-source', 'dual', 'e1e2e7/3760bf/2e7de9/9854f1', '1a1b26/c0caf5/7aa2f7/bb9af7'],
  ['kanagawa', 'established-open-source', 'dual', 'f2ecbc/545464/c84053/6f894e', '1f1f28/dcd7ba/e46876/98bb6c'],
  ['nord', 'established-open-source', 'native-dark', null, '2e3440/eceff4/88c0d0/b48ead'],
  ['dracula', 'established-open-source', 'native-dark', null, '282a36/f8f8f2/bd93f9/8be9fd'],
  ['ayu', 'established-open-source', 'dual', 'fafafa/5c6166/ff9940/399ee6', '0b0e14/bfbdb6/ffb454/59c2ff'],
  ['one-dark', 'community', 'native-dark', null, '282c34/abb2bf/61afef/c678dd'],
  ['night-owl', 'community', 'dual', 'fbfbfb/403f53/4876d6/994cc3', '011627/d6deeb/82aaff/c792ea'],
  ['papercolor', 'community', 'dual', 'eeeeee/444444/0087af/8700af', '1c1c1c/d0d0d0/5fafd7/af87d7'],
  ['github-primer', 'community', 'dual', 'ffffff/1f2328/0969da/8250df', '0d1117/e6edf3/2f81f7/a371f7'],
  ['tomorrow', 'community', 'dual', 'ffffff/4d4d4c/4271ae/8959a8', '1d1f21/c5c8c6/81a2be/b294bb'],
  ['zenburn', 'community', 'native-dark', null, '3f3f3f/dcdccc/f0dfaf/93e0e3'],
  ['cobalt', 'community', 'native-dark', null, '002240/ffffff/ffc600/0088ff'],
  ['oceanic', 'community', 'native-dark', null, '1b2b34/c0c5ce/6699cc/c594c5'],
  ['palenight', 'community', 'native-dark', null, '292d3e/a6accd/82aaff/c792ea'],
  ['horizon', 'community', 'native-dark', null, '1c1e26/d5d8da/e95678/25b0bc'],
  ['brand-seed', 'generated', 'generated', 'f7f7fb/202235/5b5bd6/0f9f88', '11121a/f0f1fb/8d8df0/4bc7b3'],
  ['profile-image', 'generated', 'generated', 'f7f4f1/242a32/315c8c/b66a4d', '15181d/f4eee9/6f9dce/dd967b'],
  ['portfolio-artwork', 'generated', 'generated', 'fbf4f8/312335/7a3f92/d56b3f', '1c121e/f8edf5/b97ad0/ef9a78'],
  ['material-hct', 'generated', 'generated', 'fffbfe/1d1b20/6750a4/006a6a', '1c1b1f/e6e1e5/d0bcff/4fd8d8'],
  ['radix-scale', 'generated', 'generated', 'fdfcff/211f26/6e56cf/12a594', '17151f/eeeadd/9e8cfc/4ccbb5'],
  ['open-color', 'generated', 'generated', 'f8f9fa/212529/4263eb/12b886', '16191d/f1f3f5/91a7ff/63e6be'],
  ['tailwind-oklch', 'generated', 'generated', 'f8fafc/0f172a/4f46e5/0d9488', '0f172a/f8fafc/818cf8/2dd4bf'],
];

const STABLE_SCHEME_IDS = new Set([
  'neutral-slate',
  'graphite',
  'paper-ink',
  'warm-parchment',
  'high-contrast',
  'low-stimulus-warm',
  'blue-orange-color-safe',
  'cool-color-safe',
  'reduced-chroma',
  'forest-moss',
  'botanical-sage',
  'ocean-abyss',
  'desert-terracotta',
  'earthy-clay',
  'sunset-ember',
  'jewel-twilight',
  'lavender-dusk',
  'sepia-film',
]);

const EXPERIMENTAL_SCHEME_IDS = new Set([
  'neon-city',
  'profile-image',
  'portfolio-artwork',
]);

const RESEARCH_SCHEME_IDS = new Set([
  'everforest',
  'catppuccin',
  'solarized',
  'gruvbox',
  'rose-pine',
  'tokyo-night',
  'kanagawa',
  'nord',
  'dracula',
  'ayu',
  'one-dark',
  'night-owl',
  'papercolor',
  'github-primer',
  'tomorrow',
  'zenburn',
  'cobalt',
  'oceanic',
  'palenight',
  'horizon',
  'radix-scale',
  'open-color',
  'tailwind-oklch',
]);

const SCHEME_SOURCES = Object.freeze({
  everforest: 'https://github.com/sainnhe/everforest',
  catppuccin: 'https://github.com/catppuccin/catppuccin',
  solarized: 'https://github.com/altercation/solarized',
  gruvbox: 'https://github.com/morhetz/gruvbox',
  'rose-pine': 'https://github.com/rose-pine/rose-pine-palette',
  'tokyo-night': 'https://github.com/folke/tokyonight.nvim',
  kanagawa: 'https://github.com/rebelot/kanagawa.nvim',
  nord: 'https://github.com/nordtheme/nord',
  dracula: 'https://github.com/dracula/dracula-theme',
  ayu: 'https://github.com/ayu-theme/ayu-colors',
  'night-owl': 'https://github.com/sdras/night-owl-vscode-theme',
  'radix-scale': 'https://www.radix-ui.com/colors',
  'open-color': 'https://github.com/yeun/open-color',
  'tailwind-oklch': 'https://tailwindcss.com/docs/colors',
});

function schemeStatus(id) {
  if (STABLE_SCHEME_IDS.has(id)) return 'stable';
  if (EXPERIMENTAL_SCHEME_IDS.has(id)) return 'experimental';
  if (RESEARCH_SCHEME_IDS.has(id)) return 'research';
  return 'extended';
}

function schemeName(id) {
  const overrides = {
    'oled-black': 'OLED Black',
    'github-primer': 'GitHub Primer',
    'material-hct': 'Material HCT',
    'tailwind-oklch': 'Tailwind OKLCH',
  };
  return overrides[id] ?? titleCaseId(id);
}

export const COLOR_SCHEMES = Object.freeze(
  COLOR_BLUEPRINTS.map(([id, family, coverage, lightAnchor, darkAnchor]) => {
    const light = parseAnchor(lightAnchor);
    const dark = parseAnchor(darkAnchor);
    const status = schemeStatus(id);
    const sourceUrl = SCHEME_SOURCES[id] ?? null;
    const modes = {
      ...(light ? { light: deriveColorTokens(light, 'light') } : {}),
      ...(dark ? { dark: deriveColorTokens(dark, 'dark') } : {}),
      'high-contrast': deriveHighContrastTokens(light, dark),
    };
    const generated = family === 'generated';

    return Object.freeze({
      id,
      name: schemeName(id),
      family,
      status,
      version: 'review-1',
      tokenContractVersion: 'review-1',
      researchedAt: '2026-10-17',
      referenceOnly: status === 'research',
      generator: generated ? 'review-seed-v1' : null,
      modeCoverage: Object.freeze(Object.keys(modes)),
      modes: Object.freeze(modes),
      nativeMode:
        coverage === 'native-dark'
          ? 'dark'
          : coverage === 'native-light'
            ? 'light'
            : undefined,
      swatches: Object.freeze([
        light?.canvas ?? dark.canvas,
        light?.text ?? dark.text,
        light?.accent ?? dark.accent,
        light?.secondary ?? dark.secondary,
      ]),
      seeds: generated
        ? Object.freeze({
            primary: light.accent,
            secondary: light.secondary,
            neutral: light.text,
          })
        : null,
      source: Object.freeze({
        name:
          status === 'research'
            ? schemeName(id)
            : generated
              ? 'Deterministic review generator'
              : 'Internal review synthesis',
        url: sourceUrl,
        licenseState:
          status === 'research' ? 'unverified' : generated ? 'generated' : 'internal-prototype',
        note:
          status === 'research'
            ? 'Reference palette for local review; not eligible for publication.'
            : 'Prototype semantic mapping for visual evaluation.',
      }),
    });
  }),
);

const SYSTEM_STACKS = Object.freeze({
  neutral:
    '"Avenir Next", Avenir, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  humanist: '"Trebuchet MS", "Segoe UI", sans-serif',
  serif: '"Iowan Old Style", "Palatino Linotype", Georgia, serif',
  literary: 'Charter, "Bitstream Charter", Georgia, serif',
  geometric: 'Futura, "Century Gothic", "Avenir Next", sans-serif',
  technical: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
  accessible: 'Verdana, Tahoma, "Segoe UI", sans-serif',
  multilingual:
    'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
});

const TYPOGRAPHY_BLUEPRINTS = [
  ['neutral-ui', 'neutral', 'neutral', 'neutral', 'technical'],
  ['humanist-ui', 'humanist', 'humanist', 'humanist', 'technical'],
  ['editorial-serif', 'serif', 'serif', 'neutral', 'technical'],
  ['literary-reading', 'literary', 'literary', 'humanist', 'technical'],
  ['geometric-display', 'geometric', 'humanist', 'neutral', 'technical'],
  ['technical-sans-mono', 'technical', 'neutral', 'neutral', 'technical'],
  ['accessible-reading', 'accessible', 'accessible', 'accessible', 'technical'],
  ['multilingual-system', 'multilingual', 'multilingual', 'multilingual', 'technical'],
];

const ROLE_STACK = Object.freeze({
  display: 'display',
  headline: 'display',
  title: 'display',
  body: 'body',
  'body-compact': 'body',
  label: 'ui',
  caption: 'body',
  quote: 'display',
  code: 'code',
  numeric: 'code',
});

const ROLE_METRICS = Object.freeze({
  display: ['3.5rem', 700, 1.05, '-0.035em'],
  headline: ['2.25rem', 700, 1.12, '-0.025em'],
  title: ['1.375rem', 650, 1.25, '-0.015em'],
  body: ['1rem', 400, 1.65, '0em'],
  'body-compact': ['0.875rem', 400, 1.5, '0em'],
  label: ['0.8125rem', 650, 1.3, '0.04em'],
  caption: ['0.75rem', 500, 1.4, '0.02em'],
  quote: ['1.5rem', 400, 1.5, '-0.01em'],
  code: ['0.875rem', 400, 1.55, '0em'],
  numeric: ['0.875rem', 650, 1.2, '0.01em'],
});

const STABLE_TYPOGRAPHY_IDS = new Set([
  'neutral-ui',
  'humanist-ui',
  'editorial-serif',
  'technical-sans-mono',
  'accessible-reading',
  'multilingual-system',
]);

export const TYPOGRAPHY_PROFILES = Object.freeze(
  TYPOGRAPHY_BLUEPRINTS.map(
    ([id, displayStack, bodyStack, uiStack, codeStack]) => {
      const stacks = {
        display: SYSTEM_STACKS[displayStack],
        body: SYSTEM_STACKS[bodyStack],
        ui: SYSTEM_STACKS[uiStack],
        code: SYSTEM_STACKS[codeStack],
      };
      const roles = Object.fromEntries(
        TYPOGRAPHY_ROLES.map((role) => {
          const [fontSize, fontWeight, lineHeight, letterSpacing] =
            ROLE_METRICS[role];
          return [
            role,
            Object.freeze({
              fontFamily: stacks[ROLE_STACK[role]],
              fontSize,
              fontWeight,
              lineHeight,
              letterSpacing,
              fontVariationSettings: 'normal',
            }),
          ];
        }),
      );

      return Object.freeze({
        id,
        name: titleCaseId(id),
        family: id.includes('serif') || id.includes('literary')
          ? 'editorial'
          : id.includes('technical')
            ? 'technical'
            : id.includes('accessible') || id.includes('multilingual')
              ? 'inclusive'
              : 'interface',
        status: STABLE_TYPOGRAPHY_IDS.has(id) ? 'stable' : 'extended',
        version: 'review-1',
        tokenContractVersion: 'review-1',
        researchedAt: '2026-10-17',
        referenceOnly: false,
        roles: Object.freeze(roles),
        measures: Object.freeze({ body: '68ch', compact: '52ch' }),
        scripts: Object.freeze(
          id === 'multilingual-system'
            ? ['Latn', 'Cyrl', 'Grek', 'Arab', 'Deva', 'Hani', 'Kana', 'Hang']
            : ['Latn'],
        ),
        coverage:
          id === 'multilingual-system'
            ? 'platform-dependent-fallback'
            : 'declared-system-stack',
        fontAssets: Object.freeze([]),
        fallbacks: Object.freeze({
          strategy: 'complete-system-stack',
          blocking: false,
        }),
        source: Object.freeze({
          name: 'Installed system font stack',
          url: null,
          licenseState: 'provided-by-operating-system',
        }),
      });
    },
  ),
);

export const DISPLAY_MODES = Object.freeze([
  Object.freeze({ id: 'system', name: 'System' }),
  Object.freeze({ id: 'light', name: 'Light' }),
  Object.freeze({ id: 'dark', name: 'Dark' }),
  Object.freeze({ id: 'high-contrast', name: 'High contrast' }),
]);

export const APPEARANCE_DEFAULTS = Object.freeze({
  variant: 'editorial-evidence',
  designLanguage: 'platform-neutral',
  colorScheme: 'warm-parchment',
  typography: 'humanist-ui',
  displayMode: 'system',
});

export const APPEARANCE_RECIPES = Object.freeze([
  Object.freeze({
    id: 'quiet-product',
    name: 'Quiet Product',
    description: 'Neutral geometry, restrained color, and a humanist reading voice.',
    selection: Object.freeze({
      variant: 'editorial-evidence',
      designLanguage: 'platform-neutral',
      colorScheme: 'neutral-slate',
      typography: 'humanist-ui',
      displayMode: 'system',
    }),
  }),
  Object.freeze({
    id: 'editorial-warmth',
    name: 'Editorial Warmth',
    description: 'Paper tactility, literary hierarchy, and warm evidence-led composition.',
    selection: Object.freeze({
      variant: 'editorial-evidence',
      designLanguage: 'paper-tactile',
      colorScheme: 'warm-parchment',
      typography: 'editorial-serif',
      displayMode: 'light',
    }),
  }),
  Object.freeze({
    id: 'systems-clarity',
    name: 'Systems Clarity',
    description: 'Dense technical structure with measured graphite contrast.',
    selection: Object.freeze({
      variant: 'spatial-bento',
      designLanguage: 'carbon-inspired',
      colorScheme: 'graphite',
      typography: 'technical-sans-mono',
      displayMode: 'dark',
    }),
  }),
  Object.freeze({
    id: 'night-gallery',
    name: 'Night Gallery',
    description: 'A quiet atelier for visual systems and authored artifacts.',
    selection: Object.freeze({
      variant: 'obsidian-atelier',
      designLanguage: 'atelier-luxury',
      colorScheme: 'jewel-twilight',
      typography: 'editorial-serif',
      displayMode: 'dark',
    }),
  }),
  Object.freeze({
    id: 'material-portfolio',
    name: 'Material Portfolio',
    description: 'Approachable spatial cards with botanical, system-aware color.',
    selection: Object.freeze({
      variant: 'spatial-bento',
      designLanguage: 'material-3-inspired',
      colorScheme: 'botanical-sage',
      typography: 'neutral-ui',
      displayMode: 'system',
    }),
  }),
  Object.freeze({
    id: 'cinematic-archive',
    name: 'Cinematic Archive',
    description: 'A chapter-led analog archive with literary pacing.',
    selection: Object.freeze({
      variant: 'horizontal-cinema',
      designLanguage: 'paper-tactile',
      colorScheme: 'sepia-film',
      typography: 'literary-reading',
      displayMode: 'dark',
    }),
  }),
  Object.freeze({
    id: 'neon-maker',
    name: 'Neon Maker',
    description: 'Kinetic evidence, technical energy, and controlled neon contrast.',
    selection: Object.freeze({
      variant: 'kinetic-cosmos',
      designLanguage: 'cyberpunk',
      colorScheme: 'neon-city',
      typography: 'geometric-display',
      displayMode: 'dark',
    }),
  }),
  Object.freeze({
    id: 'accessible-evidence',
    name: 'Accessible Evidence',
    description: 'High-contrast clarity with generous, familiar reading forms.',
    selection: Object.freeze({
      variant: 'editorial-evidence',
      designLanguage: 'minimal-flat',
      colorScheme: 'high-contrast',
      typography: 'accessible-reading',
      displayMode: 'high-contrast',
    }),
  }),
]);
