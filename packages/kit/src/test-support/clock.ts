// For tests: runs code with the clock and Math.random() stopped, so anything
// that reads either throws. A Date built from a value, or from parts, still
// works. The code must be synchronous: the clock is back by the time an async
// function's awaits resume.

export function withoutClock<T>(run: () => T): T {
  const RealDate = Date;
  const random = Math.random;
  class StoppedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) throw new Error('read the clock: new Date()');
      super(...(args as [number, number]));
    }
    static override now(): number {
      throw new Error('read the clock: Date.now()');
    }
  }
  globalThis.Date = StoppedDate as unknown as DateConstructor;
  Math.random = () => {
    throw new Error('read Math.random()');
  };
  let result: T;
  try {
    result = run();
  } finally {
    globalThis.Date = RealDate;
    Math.random = random;
  }
  if (isThenable(result)) {
    throw new TypeError(
      'withoutClock() runs synchronous code. An async function reads the clock after it returns, once the clock is back.',
    );
  }
  return result;
}

function isThenable(value: unknown): boolean {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}
