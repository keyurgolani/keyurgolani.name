// The stylesheets of every document that shows a portfolio (#7, Slice 1): the
// site's layout, the 404 page a URL no route matches gets, and a preview's
// document, so a preview loads exactly what a visitor's page does. Studio's
// styles aren't among them: only Studio's layout loads studio.css. The
// variant's own stylesheet, the shared section renderers' layout first, is
// one registry generation compiles, and the presentation boundary links it
// for the variant that renders and no other (#6, Slice 2).
import '../app/experience-base.css';
