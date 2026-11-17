import type { Page } from '@playwright/test';
import type { Delivered } from './observer-deliveries';

// Holds one IntersectionObserver's deliveries and hands them over in one call, so a test can build
// the delivery a busy main thread gives: every entry queued since the last, oldest first. Only an
// observer that watches the one box a selector names alone is held; every other observer delivers
// as the page gives it, into the same record observer-deliveries.ts reads. An observer
// disconnected while it holds entries drops them, as the browser drops its queue.

declare global {
  interface Window {
    /** The selector whose sole observers are held, and every observer the page has made. */
    __observerHold?: {
      selector: string | null;
      observers: {
        id: number;
        targets: Element[];
        connected: boolean;
        held: IntersectionObserverEntry[];
        deliver: (entries: IntersectionObserverEntry[]) => void;
      }[];
    };
  }
}

/** From the next load on, an IntersectionObserver's deliveries can be held: holdDeliveriesFor(). */
export const holdableObserverDeliveries = (page: Page) =>
  page.addInitScript(() => {
    type Hold = NonNullable<Window['__observerHold']>;
    type Watch = Hold['observers'][number];
    const Native = window.IntersectionObserver;
    const hold: Hold = { selector: null, observers: [] };
    window.__observerHold = hold;
    const records = new WeakMap<IntersectionObserver, Watch>();
    window.IntersectionObserver = class extends Native {
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        const record: Watch = {
          id: hold.observers.length,
          targets: [],
          connected: true,
          held: [],
          deliver: () => {},
        };
        super((entries) => {
          const box = hold.selector ? document.querySelector(hold.selector) : null;
          if (box && record.targets.length === 1 && record.targets[0] === box) {
            record.held.push(...entries);
          } else record.deliver(entries);
        }, options);
        record.deliver = (entries) => {
          (window.__coalescedDeliveries ??= []).push(
            entries.map((entry) => [
              entry.target,
              entry.isIntersecting,
              entry.intersectionRatio,
              entry.boundingClientRect.top,
              entry.rootBounds?.top ?? null,
            ]),
          );
          callback(entries, this);
        };
        records.set(this, record);
        hold.observers.push(record);
      }
      override observe(target: Element) {
        records.get(this)?.targets.push(target);
        super.observe(target);
      }
      override unobserve(target: Element) {
        const record = records.get(this);
        if (record) record.targets = record.targets.filter((each) => each !== target);
        super.unobserve(target);
      }
      override disconnect() {
        const record = records.get(this);
        if (record) Object.assign(record, { connected: false, held: [], targets: [] });
        super.disconnect();
      }
    };
  });

/** From now on, the deliveries of each observer that watches `selector`'s box alone are held. */
export const holdDeliveriesFor = (page: Page, selector: string) =>
  page.evaluate((selector) => {
    window.__observerHold!.selector = selector;
  }, selector);

/** Each connected observer that watches `selector`'s box alone: its id and the entries it holds. */
export const heldFor = (page: Page, selector: string) =>
  page.evaluate((selector) => {
    const box = document.querySelector(selector);
    return window
      .__observerHold!.observers.filter(
        ({ connected, targets }) => connected && targets.length === 1 && targets[0] === box,
      )
      .map(({ id, held }) => ({
        id,
        held: held.map((entry) => ({
          at: entry.isIntersecting,
          ratio: entry.intersectionRatio,
          top: entry.boundingClientRect.top,
          rootTop: entry.rootBounds?.top ?? null,
        })),
      }));
  }, selector) as Promise<{ id: number; held: Delivered[] }[]>;

/** Stops holding; each observer holding entries gets them all in one call, the oldest first. */
export const releaseDeliveries = (page: Page) =>
  page.evaluate(() => {
    const hold = window.__observerHold!;
    hold.selector = null;
    for (const record of hold.observers) {
      if (!record.connected || record.held.length === 0) continue;
      const delivery = record.held;
      record.held = [];
      record.deliver(delivery);
    }
  });
