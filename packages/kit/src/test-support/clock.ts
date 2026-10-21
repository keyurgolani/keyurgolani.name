// For tests: runs code with the clock and Math.random() stopped, so anything
// that reads either throws. A Date built from a value still works.

export function withoutClock<T>(run: () => T): T {
  const RealDate = Date;
  const random = Math.random;
  class StoppedDate extends RealDate {
    constructor(...args: [] | [string | number | Date]) {
      if (args.length === 0) throw new Error('read the clock: new Date()');
      super(args[0]);
    }
    static override now(): number {
      throw new Error('read the clock: Date.now()');
    }
  }
  globalThis.Date = StoppedDate as unknown as DateConstructor;
  Math.random = () => {
    throw new Error('read Math.random()');
  };
  try {
    return run();
  } finally {
    globalThis.Date = RealDate;
    Math.random = random;
  }
}
