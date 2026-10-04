/** Small native SVG gauge shared by Home cards; values remain readable without SVG. */
export function renderGauge(parent: HTMLElement, value: number, label: string, text?: string, compact = false): HTMLElement {
  const fraction = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const dial = parent.createDiv({ cls: `qh-gauge${compact ? " is-compact" : ""}` });
  dial.setAttr("role", "progressbar");
  dial.setAttr("aria-valuemin", "0"); dial.setAttr("aria-valuemax", "100"); dial.setAttr("aria-valuenow", String(Math.round(fraction * 100)));
  const id = `qh-gauge-${crypto.randomUUID()}`;
  dial.setAttr("aria-labelledby", id);
  const svg = dial.createSvg("svg", { attr: { viewBox: "0 0 100 100", "aria-hidden": "true" } });
  svg.createSvg("circle", { cls: "qh-gauge-track", attr: { cx: "50", cy: "50", r: "42" } });
  svg.createSvg("circle", { cls: "qh-gauge-arc", attr: { cx: "50", cy: "50", r: "42", pathLength: "100", "stroke-dasharray": "100 100", "stroke-dashoffset": String(100 * (1 - fraction)), transform: "rotate(-90 50 50)" } });
  dial.createDiv({ cls: "qh-gauge-value", text: text ?? `${Math.floor(fraction * 100)}%` });
  const caption = parent.createDiv({ cls: "qh-gauge-caption", text: label }); caption.id = id;
  return dial;
}

export function renderClockFace(parent: HTMLElement, time: string): void {
  const [hours, minutes] = time.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return;
  const svg = parent.createSvg("svg", { cls: "qh-clock-face", attr: { viewBox: "0 0 40 40", "aria-hidden": "true" } });
  svg.createSvg("circle", { cls: "qh-gauge-track", attr: { cx: "20", cy: "20", r: "17" } });
  for (let index = 0; index < 12; index++) {
    const angle = index * Math.PI / 6;
    svg.createSvg("line", { cls: "qh-gauge-tick", attr: { x1: String(20 + Math.sin(angle) * 14), y1: String(20 - Math.cos(angle) * 14), x2: String(20 + Math.sin(angle) * 16), y2: String(20 - Math.cos(angle) * 16) } });
  }
  const hand = (angle: number, length: number, cls: string) => {
    svg.createSvg("line", { cls, attr: { x1: "20", y1: "20", x2: String(20 + Math.sin(angle) * length), y2: String(20 - Math.cos(angle) * length) } });
  };
  hand(((hours % 12) + minutes / 60) * Math.PI / 6, 9, "qh-clock-hour");
  hand(minutes * Math.PI / 30, 13, "qh-clock-minute");
}
