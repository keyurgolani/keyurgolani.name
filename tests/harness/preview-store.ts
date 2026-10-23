// The preview specs' store steps (#7, Slice 2), each in a process of its own.
// @portfolio/core/owner imports server-only, which loads only under the
// react-server condition, as in Next's server, and a Playwright worker runs
// plain Node. So preview-grants.ts runs a step here under that condition:
// the task as JSON in argv[2], what the step returns as one JSON line out.
//
//   node --conditions=react-server --import tsx preview-store.ts '{"dataDir":"...","step":{...}}'
import { openStore, preflight, type DraftId, type UnitInput } from '../../packages/core/src/owner';
import { validatePublicationUnit } from '../../packages/schema/src/index';

export type StoreStep =
  /** Makes or replaces the working draft, holding `documents`, and returns it. */
  | { readonly op: 'seed'; readonly documents: UnitInput }
  /** Publishes a draft as the operator would, which removes it, and returns the new revision. */
  | { readonly op: 'publish'; readonly draftId: DraftId; readonly draftVersion: number };

export interface StoreTask {
  readonly dataDir: string;
  readonly step: StoreStep;
}

/** The server's revision store, opened as the operator's CLI opens it. */
async function storeOf(dataDir: string) {
  const problem = await preflight({ dataDir });
  if (problem) throw new Error(`preflight: ${problem}`);
  return openStore({
    dataDir,
    checks: { validate: (pair) => validatePublicationUnit(pair), appVersion: 'test' },
  });
}

async function run({ dataDir, step }: StoreTask): Promise<unknown> {
  const store = await storeOf(dataDir);
  if (step.op === 'seed') {
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

run(JSON.parse(process.argv[2] ?? '{}') as StoreTask).then(
  (result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  },
  (error: unknown) => {
    process.stderr.write(`${String((error as Error).stack ?? error)}\n`);
    process.exitCode = 1;
  },
);
