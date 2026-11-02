// How the variant specs compare a screenshot with its baseline (#5, Slice
// 6): every pixel the same, within pixelmatch's colour threshold. The
// variants job renders on one platform, ubuntu-24.04 x64 in the pinned
// Playwright image, so nothing but the page differs between its runs. #11
// owns the thresholds. screenshots.test.mjs holds these options to that: a
// blank page, or one with a line of its text gone, fails against every
// committed baseline.

/** What tests/variants/playwright.config.ts gives toHaveScreenshot. */
export const SCREENSHOT_COMPARISON = Object.freeze({ maxDiffPixels: 0, threshold: 0.2 });
