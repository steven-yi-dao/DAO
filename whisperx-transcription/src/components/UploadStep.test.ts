import { createElement, createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { UploadStep } from './UploadStep';
import { ALLOWED_EXTENSIONS } from '../lib/utils';

const noop = () => {};

function render(): string {
  return renderToStaticMarkup(
    createElement(UploadStep, {
      headingRef: createRef<HTMLHeadingElement>(),
      stagedFiles: [],
      queueFiles: [],
      fileInputRef: createRef<HTMLInputElement>(),
      onDragOver: noop,
      onDrop: noop,
      onOpenPicker: noop,
      onFileInputChange: noop,
      onRemoveFile: noop,
      onAddToQueue: noop,
      onBackToTools: noop,
    }),
  );
}

/** Text content of the element carrying `id="<id>"`, tags stripped. */
function textOf(html: string, id: string): string {
  const open = html.match(new RegExp(`<(\\w+)[^>]*\\bid="${id.replace(/[^\w]/g, '\\$&')}"[^>]*>`));
  if (!open || open.index === undefined) throw new Error(`no element with id ${id}`);
  const rest = html.slice(open.index + open[0].length);
  const close = rest.indexOf(`</${open[1]}>`);
  return rest.slice(0, close).replace(/<[^>]+>/g, '');
}

// Issue #5: the drop zone's aria-label hides its inner text, so the
// instructions must reach screen readers through aria-describedby.
describe('UploadStep drop zone', () => {
  const html = render();
  const zone = html.match(/<div role="button"[^>]*>/)?.[0] ?? '';

  it('has a concise accessible name', () => {
    expect(zone).toContain('aria-label="Upload audio files"');
  });

  it('is described by the visible instructions, including every supported format', () => {
    const ids = zone.match(/aria-describedby="([^"]+)"/)?.[1].split(' ') ?? [];
    expect(ids).toHaveLength(2);
    const description = ids.map((id) => textOf(html, id)).join(' ');
    expect(description).toContain('Drag and drop audio files here');
    for (const ext of ALLOWED_EXTENSIONS) expect(description).toContain(ext.toUpperCase());
  });

  it('filters the picker by extension so .mp4 is selectable', () => {
    expect(html).toContain('accept=".mp3,.wav,.m4a,.flac,.ogg,.mp4,.aac"');
  });
});
