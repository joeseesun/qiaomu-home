import { beforeAll, describe, expect, it } from "vitest";
import { TFile } from "obsidian";
import { renderQuadrantBody } from "../src/quadrant-ui";

/** The few Obsidian DOM helpers the card uses; the real app patches them onto HTMLElement. */
beforeAll(() => {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  const apply = <T extends HTMLElement>(element: T, options?: { cls?: string; text?: string; attr?: Record<string, string> }): T => {
    if (options?.cls) element.className = options.cls;
    if (options?.text !== undefined) element.textContent = options.text;
    if (options?.attr) for (const [name, value] of Object.entries(options.attr)) element.setAttribute(name, value);
    return element;
  };
  proto.empty = function (this: HTMLElement): void { this.replaceChildren(); };
  proto.createDiv = function (this: HTMLElement, options?: never): HTMLElement {
    const element = apply(document.createElement("div"), options); this.appendChild(element); return element;
  };
  proto.createEl = function (this: HTMLElement, tag: string, options?: never): HTMLElement {
    const element = apply(document.createElement(tag), options); this.appendChild(element); return element;
  };
  proto.createSpan = function (this: HTMLElement, options?: never): HTMLElement {
    return (this as unknown as { createEl(tag: string, options?: never): HTMLElement }).createEl("span", options);
  };
  proto.addClass = function (this: HTMLElement, cls: string): void { this.classList.add(cls); };
  proto.removeClass = function (this: HTMLElement, cls: string): void { this.classList.remove(cls); };
  proto.hasClass = function (this: HTMLElement, cls: string): boolean { return this.classList.contains(cls); };
  proto.setAttr = function (this: HTMLElement, name: string, value: string): void { this.setAttribute(name, value); };
  proto.toggleClass = function (this: HTMLElement, cls: string, value?: boolean): void { this.classList.toggle(cls, value); };
});

function fakePlugin(content: string) {
  const file = new TFile();
  Object.assign(file, { path: "Home/Tasks.md" });
  return {
    app: { vault: {
      getAbstractFileByPath: () => file,
      cachedRead: async () => content,
      modify: async () => undefined,
      create: async () => undefined,
    } },
    registerDomEvent: () => undefined,
    legacyQuadrantTasks: [] as { text: string; quadrant: string; completed: boolean; completedAt: number | null }[],
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("quadrant card", () => {
  it("shows two tasks, then all of them after clicking the more button", async () => {
    const body = document.createElement("div");
    const plugin = fakePlugin(["- [ ] a #q1", "- [ ] b #q1", "- [ ] c #q1", "- [ ] d #q1"].join("\n"));
    renderQuadrantBody(body, plugin as never, "Home/Tasks.md");
    await settle();

    const items = () => body.querySelectorAll(".qh-q-cell-q1 .qh-q-item").length;
    expect(items()).toBe(2);

    const more = body.querySelector<HTMLButtonElement>(".qh-q-cell-q1 .qh-q-more");
    expect(more).not.toBeNull();
    expect(more?.textContent).toContain("2");
    more?.dispatchEvent(new MouseEvent("click"));

    expect(items()).toBe(4);
    expect(body.querySelector(".qh-q-cell-q1 .qh-q-more")?.textContent).toBe("收起");
  });

  it("keeps a task without a quadrant tag in the first quadrant", async () => {
    const body = document.createElement("div");
    const plugin = fakePlugin("- [ ] 别人的任务");
    renderQuadrantBody(body, plugin as never, "Home/Tasks.md");
    await settle();
    expect(body.querySelectorAll(".qh-q-cell-q1 .qh-q-item").length).toBe(1);
  });
});