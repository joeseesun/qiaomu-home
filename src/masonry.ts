const GAP = 14;

/**
 * Pinterest-style packing on top of CSS grid: rows are 1px tall and every card spans as many rows as its own
 * height, so each card lands in the shortest column while DOM order (and so drag reordering) is untouched.
 * Returns a disposer.
 */
export function attachMasonry(grid: HTMLElement): () => void {
  grid.addClass("qh-masonry");
  const sized = new Set<HTMLElement>();
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) place(entry.target as HTMLElement);
  });
  const place = (card: HTMLElement) => {
    const height = card.getBoundingClientRect().height;
    card.style.gridRowEnd = `span ${Math.max(1, Math.ceil(height) + GAP)}`;
  };
  const sync = () => {
    const cards = new Set(Array.from(grid.children).flatMap((child) =>
      child.classList.contains("qh-card") ? [child as HTMLElement]
        : Array.from(child.querySelectorAll<HTMLElement>(":scope > .qh-card"))));
    for (const card of sized) if (!cards.has(card)) { observer.unobserve(card); sized.delete(card); }
    for (const card of cards) if (!sized.has(card)) { sized.add(card); observer.observe(card); place(card); }
  };
  const mutations = new MutationObserver(sync);
  mutations.observe(grid, { childList: true, subtree: true });
  sync();
  return () => { observer.disconnect(); mutations.disconnect(); grid.removeClass("qh-masonry"); };
}
