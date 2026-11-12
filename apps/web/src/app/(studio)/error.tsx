'use client';

import { useEffect, useState } from 'react';
import { signedIn } from './_components/sign-out-form';
import { StudioErrorView } from './_components/studio-error-view';

// Shown when a Studio page fails to render, inside Studio's layout (row 88c): "Studio couldn't
// load." with Reload Studio, and Sign out once one auth.session query answers 200: signed in, so
// owner (row 88c-RC2 (b)). Demo, signed out, or no answer: no Sign out. StudioErrorView says how.
export default function StudioError({ error }: { error: Error & { digest?: string } }) {
  const [owner, setOwner] = useState(false);
  useEffect(() => {
    let current = true;
    void signedIn((url, init) => window.fetch(url, init)).then((yes) => {
      if (current) setOwner(yes);
    });
    return () => {
      current = false;
    };
  }, []);
  return <StudioErrorView error={error} profile={owner ? 'owner' : null} />;
}
