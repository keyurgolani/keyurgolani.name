import { useEnhancementRuntime } from '@portfolio/kit/runtime';

// The kit runtime's hook, as the live controller calls it, behind one
// object so a test can count the calls a plate makes: none. A plate renders
// the still markup before any of them, so it subscribes to no document
// input, observes nothing, and writes no attribute.

export const Runtime = { useEnhancementRuntime };
