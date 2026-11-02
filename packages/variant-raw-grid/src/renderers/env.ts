import type { HomeModel } from '../model';

/** What every renderer knows besides its section: the page's plan. */
export interface Env {
  readonly model: Pick<HomeModel, 'pinned' | 'uiLang'>;
}
