/**
 * Where the visitor's appearance control goes. A variant renders exactly one,
 * at its manifest's `visitorControl.placement`, and positions it with its own
 * layout. #19 fills it; until then it's an empty element.
 */
export function VisitorControlSlot() {
  return <div data-visitor-control-slot="" />;
}
