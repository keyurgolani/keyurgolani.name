// The preview specs' store steps (#7, Slice 2), in a process of their own.
// @portfolio/core/owner imports server-only, which loads only under the
// react-server condition, as in Next's server, and a Playwright worker runs
// plain Node. So preview-grants.ts starts this file under that condition,
// once per worker, as the worker loads it, and sends it one task per line.
// It runs them in turn, answers each with one JSON line, its id and what the
// step returned or why it failed, and ends with its input.
//
//   node --conditions=react-server --import tsx preview-store.ts
import { createInterface } from 'node:readline';
import { openStore, preflight, type DraftId, type UnitInput } from '../../packages/core/src/owner';
import { validatePublicationUnit } from '../../packages/schema/src/index';

export type StoreStep =
  /**
   * Makes or replaces the working draft, holding `documents`, and returns
   * it, with `blobs` (base64) put in the AssetStore first, as #10's
   * ingestion puts a draft's renditions before the draft names them.
   */
  | {
      readonly op: 'seed';
      readonly documents: UnitInput;
      readonly blobs?: readonly { readonly base64: string; readonly mediaType: string }[];
    }
  /** Publishes a draft as the operator would, which removes it, and returns the new revision. */
  | { readonly op: 'publish'; readonly draftId: DraftId; readonly draftVersion: number };

export interface StoreTask {
  readonly id: number;
  readonly dataDir: string;
  readonly step: StoreStep;
}

export type StoreAnswer =
  | { readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly id: number; readonly ok: false; readonly error: string };

/** The server's revision store, opened as the operator's CLI opens it. */
async function storeOf(dataDir: string) {
  const problem = await preflight({ dataDir });
  if (problem) throw new Error(`preflight: ${problem}`);
  return openStore({
    dataDir,
    checks: { validate: (pair) => validatePublicationUnit(pair), appVersion: 'test' },
  });
}

async function run({ dataDir, step }: Omit<StoreTask, 'id'>): Promise<unknown> {
  const store = await storeOf(dataDir);
  if (step.op === 'seed') {
    for (const { base64, mediaType } of step.blobs ?? []) {
      await store.assets.put(Buffer.from(base64, 'base64'), mediaType);
    }
    const working = await store.drafts.getWorking();
    const outcome = await store.drafts.create(
      {
        documents: step.documents,
        ...(working ? { expectedVersion: working.version } : {}),
      },
      'operator',
    );
    if (outcome.kind !== 'saved') throw new Error(`draft: ${JSON.stringify(outcome)}`);
    return outcome.draft;
  }
  const live = await store.publication.status();
  const outcome = await store.publication.publish(
    {
      draftId: step.draftId,
      draftVersion: step.draftVersion,
      expectedLiveRevisionId: live.liveRevisionId,
    },
    'operator',
  );
  if (outcome.kind !== 'committed') throw new Error(`publish: ${JSON.stringify(outcome)}`);
  return outcome.revisionId;
}

let turn = Promise.resolve();
const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const task = JSON.parse(line) as StoreTask;
  turn = turn.then(async () => {
    let answer: StoreAnswer;
    try {
      answer = { id: task.id, ok: true, value: await run(task) };
    } catch (error) {
      answer = { id: task.id, ok: false, error: String((error as Error).stack ?? error) };
    }
    process.stdout.write(`${JSON.stringify(answer)}\n`);
  });
});
lines.on('close', () => {
  void turn.then(() => process.exit(0));
});
