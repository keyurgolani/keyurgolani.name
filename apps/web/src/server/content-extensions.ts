import type { ContentExtension } from '@portfolio/schema';

// The content extensions this host checks documents against. #5's registry
// discovers extension packages; until it lands, the host lists them here.
// It lists none, so extension data in a document is kept as written,
// unchecked, logged as a config.warning, and never rendered.

export const CONTENT_EXTENSIONS: readonly ContentExtension[] = [];
