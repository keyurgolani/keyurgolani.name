import { notFound } from 'next/navigation';
import { ExperienceDocument } from '~/lib/experience-document';
import {
  environmentAttributes,
  environmentQuery,
  environmentValues,
} from '~/lib/preview-environment';
import { requireDeploymentConfig } from '~/server/config-store';
import { servedPage } from '~/server/page-guard';
import { devFixture } from '~/server/preview-dev';

export const dynamic = 'force-dynamic';

// The dev fixture route (#7, Slice 1, item 8): /preview/dev/<variant>/<fixture>
// renders one of #5's contract fixtures top level, in the preview document
// and under the preview's headers, with the display mode, contrast, motion,
// and enhancement its query asks for. Only `next dev` serves it
// (server/routes.ts PREVIEW_DEV). The route table has checked the variant,
// the fixture, and the query, and every link in the page keeps the query.

interface Props {
  readonly params: Promise<{ readonly variant: string; readonly fixture: string }>;
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}

export default servedPage(
  '/preview/dev/[variant]/[fixture]',
  async function DevFixturePage({ params, searchParams }: Props) {
    const { variant, fixture } = await params;
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(await searchParams)) {
      for (const each of [value ?? []].flat()) query.append(name, each);
    }
    const values = environmentValues(query);
    if (!values) notFound();
    const { view, composition } = devFixture(variant, fixture);
    return ExperienceDocument({
      unit: view,
      selection: composition,
      environment: environmentAttributes(values),
      linkBase: { basePath: `/preview/dev/${variant}/${fixture}`, query: environmentQuery(values) },
      route: { route: 'home' },
      origin: requireDeploymentConfig().origin,
    });
  },
);
