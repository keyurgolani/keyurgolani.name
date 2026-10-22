// @portfolio/appearance/primitives (#19, Slice 3, item 2): the shared,
// accessible primitives every variant composes. They own behavior and
// semantics; design languages style them, color schemes color them, and
// typography profiles typeset them, all through the tokens and the slots in
// SLOTS. Native elements come first.
//
// Server code renders the static ones (Action, Surface, Badge, Disclosure,
// Field, Checkbox, Radio, Media, DataDisplay, Toast) and gives each its
// full id from boundaryId(input.ids, local). The 'use client' ones (Tabs,
// Dialog, Tooltip, ToastRegion, Select, and the landmarks, which only read
// their boundary) take a local id and add the boundary's prefix themselves.
// Every one renders on the server, and in a plate none attaches a listener.

export { Action, type ActionProps } from './action';
export {
  Badge,
  Disclosure,
  Surface,
  type BadgeProps,
  type DisclosureProps,
  type SurfaceProps,
} from './surface';
export {
  Checkbox,
  Field,
  Radio,
  type CheckboxProps,
  type FieldProps,
  type RadioOption,
  type RadioProps,
} from './form';
export { Select, type SelectChoice, type SelectGroup, type SelectProps } from './select';
export {
  DataDisplay,
  Media,
  type DataBars,
  type DataColumn,
  type DataDisplayProps,
  type DataRow,
  type MediaProps,
  type MediaRendition,
} from './media';
export { Tabs, type TabItem, type TabsProps } from './tabs';
export { Dialog, type DialogProps } from './dialog';
export { Tooltip, type TooltipProps } from './tooltip';
export { Toast, type ToastProps } from './toast-message';
export {
  ToastRegion,
  useToast,
  type ToastApi,
  type ToastRegionProps,
  type ToastRequest,
} from './toast';
export {
  Aside,
  Footer,
  Header,
  Main,
  Navigation,
  Region,
  type MainProps,
  type NavigationItem,
  type NavigationProps,
  type RegionProps,
} from './landmarks';
export { SkipLink, type SkipLinkProps } from './skip-link';
export {
  ACTION_EMPHASES,
  PRIMITIVES,
  SLOT_VALUES,
  SLOTS,
  STATUSES,
  SURFACE_EMPHASES,
  type ActionEmphasis,
  type SlotName,
  type SlotValue,
  type Status,
  type SurfaceEmphasis,
} from '../slots';
