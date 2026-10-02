/** Scroll only the repository viewport, with the card taking priority over its floating tray. */
export function revealRepository(row: HTMLElement) {
  const list = row.closest<HTMLElement>('.repo-grid');
  if (!list) return;
  const viewport = list.getBoundingClientRect(), card = row.getBoundingClientRect();
  const scale = viewport.height / list.offsetHeight || 1;
  const top = viewport.top + list.clientTop * scale + 3;
  const bottom = viewport.top + (list.clientTop + list.clientHeight) * scale - 3;
  const tray = row.querySelector<HTMLElement>('.row-panel')?.getBoundingClientRect();
  const targetBottom = tray && Math.max(card.bottom, tray.bottom) - card.top <= bottom - top ? Math.max(card.bottom, tray.bottom) : card.bottom;
  if (card.top < top) list.scrollTop += (card.top - top) / scale;
  else if (targetBottom > bottom) list.scrollTop += Math.min(targetBottom - bottom, card.top - top) / scale;
}
