import { hostModules, type NavigationMenuProps } from './host-modules';

/**
 * Where a composition's Menu goes on a narrow screen (stream A, global rule
 * 7): the navigation's links behind one button, in a modal dialog that
 * closes when one is followed. The host fills it with the Menu it registers
 * through registerHostModules(), a client component, so the composition
 * stays a server module that loads anywhere, and hands it the visitor's
 * control when the composition asks for it there (`visitorControl`). With
 * no Menu registered, as in a render outside the host, it's a plain link to
 * `href`, the composition's own index on the page, so every place is still
 * a real link away.
 */
export function NavigationMenuSlot(props: NavigationMenuProps) {
  const { navigationMenu: Menu, visitorControl: Control } = hostModules();
  if (Menu) {
    return (
      <Menu
        {...props}
        {...(props.visitorControl && Control ? { control: <Control inMenu /> } : {})}
      />
    );
  }
  return (
    <a href={props.href} lang={props.lang} data-navigation-menu-link="">
      {props.label}
    </a>
  );
}
