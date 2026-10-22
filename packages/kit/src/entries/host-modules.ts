// @portfolio/kit/host-modules (#6, Slice 2): registerHostModules on a subpath
// of its own, so the host's client module that registers its loaders brings
// nothing else of the kit into the browser: not the section renderers, not
// marked, and not the schemas.

export {
  registerHostModules,
  type EnhancementComponent,
  type EnhancementLoader,
  type HostModules,
} from '../sections/host-modules';
