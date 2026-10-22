import { registerHostModules } from '@portfolio/kit/sections';
import { EXTENSION_RENDERERS } from './generated/registry.renderers';

// The package code the kit reaches on the server (#5, Slice 3): each content
// extension's section renderers. Importing this module registers them;
// render-composition.tsx does, before any variant renders, and so does
// render parity's react-dom/server render (Slice 6).
//
// The enhancement loaders are host-modules-client.tsx's alone. <Enhancement>
// renders nothing on the server, so it never loads one there, and a server
// module that imported them would make each enhancement a client reference
// of the page, whose chunk the page then names and loads at once instead of
// once the page has hydrated (Slice 6, which test:external-variant checks).

registerHostModules({ extensionRenderers: EXTENSION_RENDERERS });
