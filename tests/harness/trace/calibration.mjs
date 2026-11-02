// runtime-budgets.json's calibration block (#6, Slice 1), which
// tests/trace/calibrate.mjs writes one entry of at a time from a pnpm
// test:trace report (report.mjs calibrationEntry makes the entry).

export const BUDGETS_VERSION = 1;

export const CALIBRATION_DESCRIPTION =
  'Runtime budgets (#6). calibration holds the traces the limits are set from: pnpm test:trace measures, and tests/trace/calibrate.mjs writes each entry from its report. Each entry names what it traced by content: the base commit the app sat on and the git tree ids of its apps and packages.';

/** What slice 3 has to know to read the calibration. */
export const CALIBRATION_NOTES = {
  unmapped:
    '(unmapped) is chunk bytes no source mapping covers: module wrappers, the bundler glue, and line breaks. It belongs to no package; slice 3 decides whether it counts as platform JS.',
  dataUrls:
    'Playwright reports no request for a data: URL, so the complete fixture, whose images are all data URLs, shows 0 image requests and 0 image bytes: those bytes are in the document. Image budgets need a fixture with image files.',
  analyzeBytes:
    "A PORTFOLIO_ANALYZE=1 build's chunks end in sourceMappingURL comments, so their bytes run a little over the default build's: take byte limits from a default build, and attribution from an analyze build.",
  conditions:
    "Each viewport's conditions are what its case ran under. webgl says whether getContext('webgl') and getContext('webgl2') gave a context; false is null, as in the headless shell with no GPU, so a variant that draws with WebGL draws nothing there and its frame, canvas, and long-task numbers understate it. dpr is window.devicePixelRatio, and loadAverage the machine's 1-minute load as the case ended.",
};

/**
 * calibrate.mjs's command line: the entry's name, the report, and options.
 *
 * @param {string[]} argv
 */
export function parseCalibrateArgs(argv) {
  const [name, report, ...rest] = argv;
  if (!name || !report || name.startsWith('--') || report.startsWith('--')) {
    throw new Error(
      'usage: calibrate.mjs <name> <trace-report.json> --base <sha> --command <command>',
    );
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`An entry's name is an id; got ${name}`);
  const options = { name, report, notes: {} };
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flag === '--base') options.base = value;
    else if (flag === '--command') options.command = value;
    else if (flag === '--date') options.date = value;
    else if (flag === '--route') options.route = value;
    else if (flag === '--evidence') options.evidence = value;
    else if (flag === '--note') {
      const at = value.indexOf('=');
      if (at < 1) throw new Error(`--note is key=text; got ${value}`);
      options.notes[value.slice(0, at)] = value.slice(at + 1);
    } else throw new Error(`unknown option ${flag}`);
  }
  if (!/^[0-9a-f]{40}$/.test(options.base ?? '')) {
    throw new Error('--base is the full SHA of the commit the traced app sat on');
  }
  if (!options.command) throw new Error('--command is the command that reproduces the entry');
  if (options.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(options.date)) {
    throw new Error(`--date is YYYY-MM-DD; got ${options.date}`);
  }
  return options;
}

/**
 * baseline.mjs's evidence, as an entry keeps it: what the trap and
 * offline-fetch refused, and every socket the build, the server, and the
 * browser held, with any outside loopback. Throws on anything else.
 */
export function egressEvidence(evidence) {
  for (const key of ['trap', 'offlineFetch', 'sockets']) {
    if (!(key in (evidence ?? {}))) throw new Error(`The evidence has no ${key}.`);
  }
  return {
    commit: evidence.commit,
    method: evidence.method,
    trapAttempts: evidence.trap,
    offlineFetchRefusals: evidence.offlineFetch,
    sockets: evidence.sockets,
  };
}

/**
 * `budgets` (the parsed file, or null for none yet) with calibration[name]
 * set to `entry`, its other entries and keys kept, entries in name order,
 * and the tool's own version, description, and notes.
 */
export function withCalibration(budgets, name, entry) {
  const own = ['version', 'description', 'notes', 'calibration'];
  const rest = Object.entries(budgets ?? {}).filter(([key]) => !own.includes(key));
  const calibration = { ...(budgets?.calibration ?? {}), [name]: entry };
  return {
    version: BUDGETS_VERSION,
    description: CALIBRATION_DESCRIPTION,
    notes: CALIBRATION_NOTES,
    ...Object.fromEntries(rest),
    calibration: Object.fromEntries(
      Object.entries(calibration).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
}
