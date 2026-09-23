'use client';

import { useState } from 'react';
import { Share as ShareIcon } from '@/components/icons.tsx';

/** The system share sheet where there is one; otherwise copies the link. */
export function Share({ title }: { title: string }) {
  const [note, setNote] = useState<string | undefined>();
  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title, url });
      else {
        await navigator.clipboard.writeText(url);
        setNote('Link copied.');
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError')
        setNote('Couldn’t share. Copy the address bar instead.');
    }
  };
  return (
    <>
      <button type="button" className="btn btn-primary btn-lg" onClick={share}>
        <ShareIcon />
        Share save card
      </button>
      <span className="visually-hidden" role="status">
        {note}
      </span>
      {note && (
        <span className="faint" style={{ fontSize: 13, textAlign: 'center' }} aria-hidden="true">
          {note}
        </span>
      )}
    </>
  );
}
