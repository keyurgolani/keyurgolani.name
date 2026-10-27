import { hostModules } from './host-modules';

/**
 * Where the visitor's appearance control goes. A variant renders exactly one,
 * at its manifest's `visitorControl.placement`, and positions it with its own
 * layout. The host fills it (#19, Slice 4) with the control it registers
 * through registerHostModules(); with none registered, or where the page
 * shows no control, it's an empty element.
 */
export function VisitorControlSlot() {
  const Control = hostModules().visitorControl;
  return <div data-visitor-control-slot="">{Control ? <Control /> : null}</div>;
}
