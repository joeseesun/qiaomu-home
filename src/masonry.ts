const GAP = 14;

/**
 * Pinterest-style packing on top of CSS grid: rows are 1px tall and every card spans as many rows as its own
 * height, so each card lands in the shortest column while DOM order (and so drag reordering) is untouched.
 * Returns a disposer.
 */
export function attachMasonry(grid: HTMLElement): () => void {
  grid.addClass("qh-masonry");
  const sized = new Set<HTMLElement>();
  const spans = new WeakMap<HTMLElement, number>();
  // Writing only changed spans keeps a resize from invalidating the grid again for nothing.
  const apply = (card: HTMLElement, height: number) => {
    const span = Math.max(1, Math.ceil(height) + GAP);
    if (spans.get(card) === span) return;
    spans.set(card, span);
    card.style.gridRowEnd = `span ${span}`;
  };
  const observer = new ResizeObserver((entries) => {
    // The observer already measured the cards: no layout reads here.
    for (const entry of entries) {
      const box = entry.borderBoxSize?.[0];
      apply(entry.target as HTMLElement, box ? box.blockSize : (entry.target as HTMLElement).getBoundingClientRect().height);
    }
  });
  const sync = () => {
    const cards = new Set(Array.from(grid.children).flatMap((child) =>
      child.classList.contains("qh-card") ? [child as HTMLElement]
        : Array.from(child.querySelectorAll<HTMLElement>(":scope > .qh-card"))));
    for (const card of sized) if (!cards.has(card)) { observer.unobserve(card); sized.delete(card); }
    const added = [...cards].filter((card) => !sized.has(card));
    // Measure every new card first, then write: one layout instead of one per card.
    const heights = added.map((card) => card.getBoundingClientRect().height);
    added.forEach((card, index) => { sized.add(card); observer.observe(card); apply(card, heights[index]); });
  };
  // Only cards entering or leaving matter; text changes inside cards are handled by the ResizeObserver.
  let queued = false;
  const mutations = new MutationObserver((records) => {
    if (queued || !records.some((record) => record.type === "childList" && (record.target === grid || (record.target as HTMLElement).parentElement === grid))) return;
    queued = true;
    queueMicrotask(() => { queued = false; sync(); });
  });
  mutations.observe(grid, { childList: true, subtree: true });
  sync();
  return () => { observer.disconnect(); mutations.disconnect(); grid.removeClass("qh-masonry"); };
}
