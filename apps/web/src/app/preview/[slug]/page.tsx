import { notFound } from 'next/navigation';
import { loadPortfolio } from '~/lib/portfolio';
import { findManifest, loadVariantModule } from '~/lib/registry';
import { ErrorPage } from '~/components/error-page';
import { PreviewBanner } from '~/components/preview-banner';

export const dynamic = 'force-dynamic';

interface PreviewPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ scheme?: string; typography?: string }>;
}

export async function generateMetadata({ params }: PreviewPageProps) {
  const { slug } = await params;
  const m = findManifest(slug);
  return m ? { title: `Preview · ${m.name}` } : { title: 'Preview · not found' };
}

export default async function PreviewPage({ params, searchParams }: PreviewPageProps) {
  const { slug } = await params;
  const { scheme, typography } = await searchParams;

  const manifest = findManifest(slug);
  if (!manifest) notFound();

  let loaded;
  try {
    loaded = await loadPortfolio();
  } catch (error) {
    return (
      <ErrorPage
        title="Portfolio could not be loaded"
        message={error instanceof Error ? error.message : String(error)}
      />
    );
  }

  const mod = await loadVariantModule(slug);
  if (!mod) notFound();

  const Component = mod.default;
  return (
    <>
      <PreviewBanner manifest={manifest} colorScheme={scheme} typography={typography} />
      <Component portfolio={loaded.portfolio} colorScheme={scheme} typography={typography} />
    </>
  );
}
