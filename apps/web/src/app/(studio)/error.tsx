'use client';

import { useStudioProfile } from './_components/sign-out-form';
import { StudioErrorView } from './_components/studio-error-view';

// Shown when a Studio page fails to render, inside Studio's layout (row 88c): "Studio couldn't
// load." with Reload Studio, and under owner, Sign out (row 88c-RC2). StudioErrorView says how.
export default function StudioError({ error }: { error: Error & { digest?: string } }) {
  return <StudioErrorView error={error} profile={useStudioProfile()} />;
}
