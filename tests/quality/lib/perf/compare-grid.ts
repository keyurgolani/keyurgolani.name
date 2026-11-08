/**
 * The Compare grid's verdict (perf.spec.ts, Demo Studio's Compare grid): what its readings fail,
 * and what it reports without failing. Pure, so its rules are pinned by unit cases
 * (compare-grid.test.ts) apart from the browser run that takes the readings.
 */

/** One run's readings, as the Compare grid test takes them. */
export interface CompareGridReading {
  /** /studio's response status. */
  readonly status: number;
  /** Every iframe on the page with the grid open. */
  readonly frames: number;
  /** The page's heap after a collection at memory.sampleMs, in MiB. */
  readonly heapMiB: number;
  /** memory.heapMiB for the cell's tier. */
  readonly heapBudgetMiB: number;
  /** Each rest in the sweep that made its plate the heavy one, by its marker. */
  readonly handedOn: number;
  /** The sweep's rests: SWEEP_ORDER's length. */
  readonly rests: number;
  /** The sweep's total blocking time, in ms. */
  readonly tbtMs: number;
  /** vitals.tbtMs for the cell's tier. */
  readonly tbtCeilingMs: number;
}

export interface CompareGridVerdict {
  /** Each rule the readings break, in words: the test fails on any. */
  readonly failures: readonly string[];
  /** Readings recorded on the test as annotations, which never fail it. */
  readonly reported: readonly { readonly type: string; readonly description: string }[];
}

export function compareGridVerdict(reading: CompareGridReading): CompareGridVerdict {
  const failures: string[] = [];
  if (reading.status !== 200) failures.push(`/studio answers ${reading.status}, not 200`);
  if (reading.frames > 4) failures.push(`the grid holds ${reading.frames} frames, over four`);
  if (!Number.isFinite(reading.heapMiB)) failures.push('the heap was not read');
  else if (reading.heapMiB > reading.heapBudgetMiB)
    failures.push(
      `the heap is ${reading.heapMiB.toFixed(1)} MiB, over memory.heapMiB's ${reading.heapBudgetMiB}`,
    );
  if (reading.handedOn !== reading.rests)
    failures.push(
      `${reading.handedOn} of the sweep's ${reading.rests} rests handed the heavy slot on`,
    );
  // RC1 only (the coordinator's ruling, 2026-11-08, a listed exception): the sweep's TBT is
  // reported, not gated, until the grid's settle waits on the plates' own loads (RC2) and the bar
  // is hard again. perf.json keeps the reading and its ceiling.
  const reported =
    reading.tbtMs > reading.tbtCeilingMs
      ? [
          {
            type: 'compare grid sweep tbt (reported, not gated, for RC1)',
            description: `a sweep across the plates and back blocks ${reading.tbtMs} ms, over vitals.tbtMs's ${reading.tbtCeilingMs}`,
          },
        ]
      : [];
  return { failures, reported };
}
