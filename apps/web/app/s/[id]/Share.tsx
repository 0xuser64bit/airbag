'use client';

// The save card, shared. A dialog shows the card itself (the report's share image) with ways out
// that work in every browser: post on X, copy the link, download the PNG. Phones also get their
// share sheet, carrying the PNG. Desktop browsers aren't handed navigator.share: some expose it
// and then never open a sheet, which made the button look dead.

import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Cross, Download, External, Share as ShareIcon } from '@/components/icons.tsx';
import { LoaderMark } from '@/components/Loader.tsx';
import { SITE_URL } from '@/lib/config.ts';
import s from './save.module.css';

export function Share({ id, text }: { id: string; text: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState<string | undefined>();
  // Known only in the browser; reading it during render would break hydration.
  const [sheet, setSheet] = useState(false);
  const [file, setFile] = useState<File | undefined>();

  const url = `${SITE_URL}/s/${id}`;
  const image = `/s/${id}/opengraph-image`;
  const name = `airbag-save-${id}.png`;
  const post = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;

  useEffect(() => {
    setSheet(typeof navigator.share === 'function' && matchMedia('(pointer: coarse)').matches);
  }, []);

  // The share sheet must open inside the tap, so the PNG is fetched when the dialog opens.
  useEffect(() => {
    if (!open || !sheet || file) return;
    const ctl = new AbortController();
    fetch(image, { signal: ctl.signal })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => setFile(new File([b], name, { type: 'image/png' })))
      .catch(() => undefined);
    return () => ctl.abort();
  }, [open, sheet, file, image, name]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2_000);
    return () => clearTimeout(t);
  }, [copied]);

  const show = () => {
    setNote(undefined);
    setOpen(true);
    dialog.current?.showModal();
  };

  const copy = async () => {
    setNote(undefined);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      field.current?.select();
      setNote('Your browser blocked copying. The link is selected: copy it from there.');
    }
  };

  const native = async () => {
    setNote(undefined);
    const data: ShareData = { title: 'Airbag save report', text, url };
    if (file && navigator.canShare?.({ files: [file] })) data.files = [file];
    try {
      await navigator.share(data);
    } catch (err) {
      if ((err as Error).name !== 'AbortError')
        setNote('Your phone couldn’t open its share sheet. Use one of the other options.');
    }
  };

  return (
    <>
      <button type="button" className="btn btn-primary btn-lg" onClick={show}>
        <ShareIcon />
        Share save card
      </button>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: Escape is the keyboard close, native to a modal dialog */}
      <dialog
        ref={dialog}
        className={s.dialog}
        aria-labelledby="share-title"
        onClose={() => setOpen(false)}
        // A click on the backdrop lands on the dialog itself; inside, it lands on its content.
        onClick={(e) => {
          if (e.target === e.currentTarget) dialog.current?.close();
        }}
      >
        <div className="hazard" aria-hidden="true" />
        <div className={s.dialogHead}>
          <h2 id="share-title" className="title">
            Share your save card
          </h2>
          <button
            type="button"
            className={`btn btn-ghost btn-sm ${s.close}`}
            aria-label="Close"
            onClick={() => dialog.current?.close()}
          >
            <Cross />
          </button>
        </div>
        <div className={s.dialogBody}>
          <div className={`well ${s.card}`}>
            {open && (
              // biome-ignore lint/performance/noImgElement: a generated PNG, not an optimizable asset
              <img
                src={image}
                alt="The save card: what Airbag kept versus a liquidation"
                width={1200}
                height={675}
                onLoad={() => setDrawn(true)}
              />
            )}
            {!drawn && (
              <span className={s.cardWait}>
                <LoaderMark size={32} />
              </span>
            )}
          </div>
          <div className={s.shareActions}>
            {sheet && (
              <button type="button" className="btn btn-primary" onClick={native}>
                <ShareIcon />
                Share
              </button>
            )}
            <a className="btn btn-secondary" href={post} target="_blank" rel="noreferrer">
              Post on X
              <External />
            </a>
            <button type="button" className="btn btn-secondary" onClick={copy}>
              {copied ? <Check /> : <Copy />}
              {copied ? 'Link copied' : 'Copy link'}
            </button>
            <a className="btn btn-secondary" href={image} download={name}>
              <Download />
              Download PNG
            </a>
          </div>
          <input
            ref={field}
            className={`input ${s.link}`}
            value={url}
            readOnly
            aria-label="Link to this save report"
            onFocus={(e) => e.currentTarget.select()}
          />
          <p className="visually-hidden" role="status">
            {copied ? 'Link copied' : ''}
          </p>
          {note && (
            <p className={s.shareNote} role="alert">
              {note}
            </p>
          )}
        </div>
      </dialog>
    </>
  );
}
