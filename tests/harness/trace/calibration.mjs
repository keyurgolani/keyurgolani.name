// The calibration block of runtime-budgets.json (#6, Slice 1), which
// tests/trace/calibrate.mjs writes one entry of at a time from a pnpm
// test:trace report (report.mjs calibrationEntry makes the entry).

export const CALIBRATION_DESCRIPTION =
  'Runtime budgets (#6). calibration holds the traces the limits are set from: pnpm test:trace measures, and tests/trace/calibrate.mjs writes each entry from its report.';

/**
 * calibrate.mjs's command line: the entry's name, the report, and options.
 *
 * @param {string[]} argv
 */
export function parseCalibrateArgs(argv) {
  const [name, report, ...rest] = argv;
  if (!name || !report || name.startsWith('--') || report.startsWith('--')) {
    throw new Error(
      'usage: calibrate.mjs <name> <trace-report.json> --commit <sha> --command <command>',
    );
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`An entry's name is an id; got ${name}`);
  const options = { name, report, notes: {} };
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flag === '--commit') options.commit = value;
    else if (flag === '--command') options.command = value;
    else if (flag === '--date') options.date = value;
    else if (flag === '--route') options.route = value;
    else if (flag === '--note') {
      const at = value.indexOf('=');
      if (at < 1) throw new Error(`--note is key=text; got ${value}`);
      options.notes[value.slice(0, at)] = value.slice(at + 1);
    } else throw new Error(`unknown option ${flag}`);
  }
  if (!/^[0-9a-f]{40}$/.test(options.commit ?? '')) {
    throw new Error('--commit is the full SHA of the commit that was traced');
  }
  if (!options.command) throw new Error('--command is the command that traced it');
  if (options.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(options.date)) {
    throw new Error(`--date is YYYY-MM-DD; got ${options.date}`);
  }
  return options;
}

/**
 * `budgets` (the parsed file, or null for none yet) with calibration[name]
 * set to `entry`, every other key kept, and the entries in name order.
 */
export function withCalibration(budgets, name, entry) {
  const calibration = { ...(budgets?.calibration ?? {}), [name]: entry };
  return {
    description: CALIBRATION_DESCRIPTION,
    ...budgets,
    calibration: Object.fromEntries(
      Object.entries(calibration).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
}
