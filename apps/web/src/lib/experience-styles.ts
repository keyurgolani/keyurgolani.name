// The stylesheets of every document that shows a portfolio (#7, Slice 1): the
// site's layout, the 404 page a URL no route matches gets, and a preview's
// document, so a preview loads exactly what a visitor's page does. Host
// chrome isn't among them: only Studio's layout loads host-chrome.css.
import '../app/experience-base.css';
// The shared section renderers' layout, then every registered variant's
// stylesheet, which `pnpm --filter @portfolio/web build:registry` lists.
import '@portfolio/kit/sections/styles.css';
import './generated/registry.styles';
