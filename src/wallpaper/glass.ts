/**
 * Frosted glass without a live `backdrop-filter`.
 *
 * `backdrop-filter: blur()` re-blurs whatever is behind every card, search box and button on each frame the page
 * scrolls or repaints. Without hardware acceleration (a common Obsidian setting) that runs on the CPU at full
 * Retina resolution, and scrolling Home drops to about 20 fps. The wallpaper behind those surfaces does not move,
 * so it is blurred once here, at a quarter of the size, and painted as a fixed background aligned with the photo.
 */

/** CSS `blur(22px) saturate(1.25)`, the `--qh-blur` the stylesheet uses on photo backgrounds. */
const BLUR_PX = 22;
const SATURATE = 1.25;
/** A blurred image has no detail to lose: bake small, let the browser scale it up. */
const SCALE = 0.25;
const REBAKE_DELAY_MS = 180;

export interface GlassSize { width: number; height: number }

/** Where `background-size: cover; background-position: center` puts an image inside a box. */
export function coverRect(image: GlassSize, box: GlassSize): { x: number; y: number; width: number; height: number } {
  const scale = Math.max(box.width / image.width, box.height / image.height);
  const width = image.width * scale, height = image.height * scale;
  return { x: (box.width - width) / 2, y: (box.height - height) / 2, width, height };
}

/** The `.qh-shade` gradient, as canvas color stops. */
export function shadeStops(dim: number): Array<[number, string]> {
  return [[0, `rgba(0,0,0,${dim * 0.75})`], [0.55, `rgba(0,0,0,${dim})`], [1, `rgba(0,0,0,${dim + 0.15})`]];
}

function loadImage(url: string): Promise<HTMLImageElement> {
  const img = createEl("img");
  // Vault files (app://) and Unsplash both allow CORS, so the canvas stays readable.
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  img.src = url;
  return img.decode().then(() => img);
}

/** Paints photo + shade, extends the edges so the blur does not darken them, then blurs. */
function bake(img: HTMLImageElement, box: GlassSize, dim: number): Promise<Blob | null> {
  const width = Math.max(1, Math.ceil(box.width * SCALE)), height = Math.max(1, Math.ceil(box.height * SCALE));
  const radius = BLUR_PX * SCALE, pad = Math.ceil(radius * 3);
  const source = createEl("canvas");
  source.width = width + pad * 2; source.height = height + pad * 2;
  const ctx = source.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  const fit = coverRect({ width: img.naturalWidth, height: img.naturalHeight }, { width, height });
  ctx.drawImage(img, pad + fit.x, pad + fit.y, fit.width, fit.height);
  const shade = ctx.createLinearGradient(0, pad, 0, pad + height);
  for (const [stop, color] of shadeStops(dim)) shade.addColorStop(stop, color);
  ctx.fillStyle = shade;
  ctx.fillRect(pad, pad, width, height);
  // Clamp: stretch the outermost pixels into the padding.
  ctx.drawImage(source, pad, pad, 1, height, 0, pad, pad, height);
  ctx.drawImage(source, pad + width - 1, pad, 1, height, pad + width, pad, pad, height);
  ctx.drawImage(source, 0, pad, width + pad * 2, 1, 0, 0, width + pad * 2, pad);
  ctx.drawImage(source, 0, pad + height - 1, width + pad * 2, 1, 0, pad + height, width + pad * 2, pad);
  const out = createEl("canvas");
  out.width = width; out.height = height;
  const blurred = out.getContext("2d");
  if (!blurred || !("filter" in blurred)) return Promise.resolve(null);
  blurred.filter = `blur(${radius}px) saturate(${SATURATE})`;
  blurred.drawImage(source, -pad, -pad);
  return new Promise((resolve) => {
    try { out.toBlob(resolve, "image/png"); } catch { resolve(null); }
  });
}

/**
 * Owns the baked glass of one Home page. Adds `qh-glass` to the root once the glass matches the shown photo;
 * without it the stylesheet keeps the live `backdrop-filter`, so any failure looks exactly like before.
 */
export class GlassLayer {
  private url = "";
  private dim = 0;
  private objectUrl = "";
  private generation = 0;
  private baked = "";
  private rebakeTimer: number | null = null;
  /** A photo whose pixels cannot be read (no CORS) keeps the live blur; do not retry it on every resize. */
  private failed = "";
  private readonly observer: ResizeObserver;
  /** Re-measures the card panes of the attached grid; panes are only laid out once the glass is shown. */
  private placePanes: (() => void) | null = null;

  /** `show` calls still waiting for glass: their root had no size yet, or a newer bake took over. */
  private waiting: Array<() => void> = [];

  constructor(private readonly root: HTMLElement) {
    this.observer = new ResizeObserver(() => this.reposition(true));
    this.observer.observe(root);
  }

  /** Shows glass for this photo (null: no photo). Resolves once it is in place or has been given up. */
  async show(url: string | null, dim: number): Promise<void> {
    await this.update(url, dim);
    const done = this.root.hasClass("qh-glass") && this.baked.startsWith(`${this.url}|${this.dim}|`)
      || !this.url || this.failed === `${this.url}|${this.dim}`;
    if (done) { this.settle(); return; }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  private settle(): void {
    const waiting = this.waiting;
    this.waiting = [];
    for (const resolve of waiting) resolve();
  }

  private async update(url: string | null, dim: number): Promise<void> {
    const generation = ++this.generation;
    this.url = url ?? ""; this.dim = dim;
    if (!url) { this.clear(); return; }
    if (this.failed === `${url}|${dim}`) return;
    const box = this.reposition(false);
    // A Home tab in the background has no size. Glass for another photo would be wrong: show the live blur
    // until the tab is visible again, when the resize observer bakes it.
    if (box.width < 2 || box.height < 2) {
      if (this.baked.startsWith(`${url}|${dim}|`)) return;
      this.root.removeClass("qh-glass");
      return;
    }
    const key = `${url}|${dim}|${box.width}x${box.height}`;
    if (key === this.baked && this.root.hasClass("qh-glass")) return;
    const blob = await this.render(url, dim, box);
    if (generation !== this.generation) return;
    if (!blob) { this.failed = `${url}|${dim}`; this.clear(); return; }
    const view = this.root.ownerDocument.defaultView ?? window;
    const next = view.URL.createObjectURL(blob);
    // Decode before switching so the swap is a single paint.
    try { await loadImage(next); } catch { /* the background still loads it */ }
    if (generation !== this.generation) { view.URL.revokeObjectURL(next); return; }
    if (this.objectUrl) view.URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = next;
    this.baked = key;
    this.root.style.setProperty("--qh-glass", `url("${next}")`);
    this.root.addClass("qh-glass");
    this.placePanes?.();
  }

  private async render(url: string, dim: number, box: GlassSize): Promise<Blob | null> {
    try { return await bake(await loadImage(url), box, dim); }
    catch { return null; }
  }

  /** Keeps the fixed background over the root; a size change also re-crops the photo, so it is baked again. */
  reposition(rebake: boolean): GlassSize {
    const rect = this.root.getBoundingClientRect();
    const style = this.root.style;
    style.setProperty("--qh-glass-x", `${rect.left}px`);
    style.setProperty("--qh-glass-y", `${rect.top}px`);
    style.setProperty("--qh-glass-w", `${rect.width}px`);
    style.setProperty("--qh-glass-h", `${rect.height}px`);
    const box = { width: Math.round(rect.width), height: Math.round(rect.height) };
    this.placePanes?.();
    const wanted = `${this.url}|${this.dim}|${box.width}x${box.height}`;
    if (rebake && this.url && this.failed !== `${this.url}|${this.dim}` && box.width >= 2 && box.height >= 2 && wanted !== this.baked) {
      // Without glass (just shown again) bake now; while a pane is being resized, wait for it to settle.
      const delay = this.root.hasClass("qh-glass") ? REBAKE_DELAY_MS : 0;
      if (this.rebakeTimer !== null) window.clearTimeout(this.rebakeTimer);
      this.rebakeTimer = window.setTimeout(() => { this.rebakeTimer = null; void this.show(this.url, this.dim); }, delay);
    }
    return box;
  }

  private clear(): void {
    this.root.removeClass("qh-glass");
    this.root.style.removeProperty("--qh-glass");
    this.baked = "";
    if (this.objectUrl) (this.root.ownerDocument.defaultView ?? window).URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = "";
  }

  /**
   * Cards fill most of the page and scroll with it. A fixed background would be repainted on every scroll frame,
   * so each card gets a clipped pane whose image a scroll-driven animation moves back by exactly the scroll
   * offset: the compositor keeps it still over the photo and the main thread paints nothing while scrolling.
   * Returns a disposer. Without scroll timelines the cards keep the fixed background instead.
   */
  attachGrid(grid: HTMLElement, page: HTMLElement): () => void {
    const win = this.root.ownerDocument.defaultView ?? window;
    if (!win.CSS?.supports?.("animation-timeline: scroll()")) return () => {};
    this.root.addClass("qh-glass-panes");
    const images = new Map<HTMLElement, HTMLElement>();
    let frame = 0;
    const place = () => {
      frame = 0;
      // Hidden panes measure as zero; `show` places them once the glass is visible.
      if (!grid.isConnected || !this.root.hasClass("qh-glass")) return;
      // One read pass, then one write pass.
      const root = this.root.getBoundingClientRect(), scroll = page.scrollTop;
      const range = Math.max(0, page.scrollHeight - page.clientHeight);
      const spots = [...images].map(([card, image]) => [image, card.querySelector<HTMLElement>(":scope > .qh-glass-pane")?.getBoundingClientRect()] as const);
      page.style.setProperty("--qh-scroll-range", `${range}px`);
      for (const [image, pane] of spots) {
        if (!pane) continue;
        // Cards only move vertically, so each image is one column of the photo, as wide as its card:
        // a quarter of the layer memory of a full-page image per card.
        image.style.width = `${pane.width}px`;
        image.style.backgroundPositionX = `${root.left - pane.left}px`;
        image.style.top = `${root.top - pane.top - scroll}px`;
      }
    };
    const schedule = () => { if (!frame) frame = win.requestAnimationFrame(place); };
    this.placePanes = schedule;
    const sizes = new ResizeObserver(schedule);
    const ensure = () => {
      const cards = new Set(Array.from(grid.querySelectorAll<HTMLElement>(".qh-card")).filter((card) => card.closest(".qh-grid") === grid));
      for (const card of [...images.keys()]) if (!cards.has(card)) { images.delete(card); sizes.unobserve(card); }
      for (const card of cards) {
        // A card that re-rendered itself with `empty()` loses its pane; give it back.
        let pane = card.querySelector<HTMLElement>(":scope > .qh-glass-pane");
        if (!pane) {
          pane = card.createDiv({ cls: "qh-glass-pane" });
          images.set(card, pane.createDiv({ cls: "qh-glass-image" }));
          card.prepend(pane);
        } else if (!images.has(card)) images.set(card, pane.firstElementChild as HTMLElement);
        sizes.observe(card);
      }
      schedule();
    };
    // Anything above the grid that changes height moves every card.
    for (const child of Array.from(page.children)) sizes.observe(child);
    sizes.observe(this.root);
    const mutations = new MutationObserver((records) => {
      if (records.some((record) => Array.from(record.removedNodes).concat(Array.from(record.addedNodes))
        .some((node) => node.instanceOf(HTMLElement) && (node.matches(".qh-card, .qh-slot, .qh-glass-pane") || !!node.querySelector(".qh-card"))))) ensure();
    });
    mutations.observe(grid, { childList: true, subtree: true });
    ensure();
    return () => {
      if (frame) win.cancelAnimationFrame(frame);
      if (this.placePanes === schedule) this.placePanes = null;
      sizes.disconnect(); mutations.disconnect();
      for (const card of images.keys()) card.querySelector(":scope > .qh-glass-pane")?.remove();
      images.clear();
    };
  }

  destroy(): void {
    this.generation++;
    this.settle();
    this.observer.disconnect();
    if (this.rebakeTimer !== null) window.clearTimeout(this.rebakeTimer);
    this.clear();
  }
}
