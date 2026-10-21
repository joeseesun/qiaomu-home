import { Modal, Notice, setIcon } from "obsidian";
import type QiaomuHomePlugin from "./main";
import { L, t } from "./i18n";
import { guardFormComposition } from "./input-ui";
import type { Quadrant, QuadrantTask } from "./quadrant-data";

const QUADRANT_META: Record<Quadrant, { zh: string; en: string; icon: string }> = {
  q1: { zh: "重要紧急", en: "Urgent & important", icon: "siren" },
  q2: { zh: "重要不紧急", en: "Important, not urgent", icon: "target" },
  q3: { zh: "紧急不重要", en: "Urgent, not important", icon: "alarm-clock" },
  q4: { zh: "不重要不紧急", en: "Neither urgent nor important", icon: "circle" },
};
const QUADRANTS = Object.keys(QUADRANT_META) as Quadrant[];

class QuadrantHistoryModal extends Modal {
  private saving = false;

  constructor(private plugin: QiaomuHomePlugin, private refresh: () => void) {
    super(plugin.app);
    this.modalEl.addClass("qh-ui");
  }

  onOpen(): void {
    this.setTitle(L("已完成任务", "Completed tasks"));
    const { contentEl } = this;
    contentEl.empty();
    const completed = this.plugin.settings.quadrant.tasks.filter(task => task.completed)
      .sort((a, b) => (b.completedAt ?? b.createdAt) - (a.completedAt ?? a.createdAt));
    if (!completed.length) {
      contentEl.createDiv({ cls: "qh-card-empty", text: L("暂无已完成任务", "No completed tasks") });
      return;
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const weekStart = new Date(today); weekStart.setDate(today.getDate() - (now.getDay() || 7) + 1);
    const groups: [string, QuadrantTask[]][] = [
      [L("今天", "Today"), []], [L("昨天", "Yesterday"), []],
      [L("本周", "This week"), []], [L("更早", "Earlier"), []],
    ];
    for (const task of completed) {
      const at = task.completedAt ?? task.createdAt;
      groups[at >= today.getTime() ? 0 : at >= yesterday.getTime() ? 1 : at >= weekStart.getTime() ? 2 : 3][1].push(task);
    }
    for (const [label, tasks] of groups) {
      if (!tasks.length) continue;
      contentEl.createEl("h3", { cls: "qh-q-history-title", text: `${label} (${tasks.length})` });
      for (const task of tasks) {
        const row = contentEl.createDiv({ cls: "qh-q-history-row" });
        row.createSpan({ cls: "qh-q-item-text", text: task.text });
        const restore = row.createEl("button", { cls: "qh-icon-button", attr: { "aria-label": L("恢复 {v}", "Restore {v}", { v: task.text }) } });
        setIcon(restore, "rotate-ccw");
        restore.addEventListener("click", () => {
          if (this.saving) return;
          this.saving = true;
          restore.disabled = true;
          void this.plugin.updateQuadrantTasks(current => current.map(item => item.id === task.id ? { ...item, completed: false, completedAt: null } : item))
            .then(() => { this.refresh(); this.close(); })
            .catch(() => { new Notice(t("layout.saveFailed")); })
            .finally(() => { this.saving = false; restore.disabled = false; });
        });
      }
    }
  }

  onClose(): void { this.contentEl.empty(); }
}

export function renderQuadrantBody(body: HTMLElement, plugin: QiaomuHomePlugin): void {
  let currentQuad: Quadrant = "q1";
  let saving = false;
  const expanded = new Set<Quadrant>();
  body.addClass("qh-quadrant");

  function commit(change: (tasks: QuadrantTask[]) => QuadrantTask[], afterSave: () => void = () => {}): void {
    if (saving) return;
    saving = true;
    const controls = body.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("input, button, select");
    controls.forEach(control => { control.disabled = true; });
    void plugin.updateQuadrantTasks(change).then(() => {
      afterSave();
      if (body.isConnected) renderAll();
    }).catch(() => {
      // Keep the input draft and the last persisted task state available for retry.
      body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(checkbox => { checkbox.checked = false; });
      new Notice(t("layout.saveFailed"));
    }).finally(() => { saving = false; controls.forEach(control => { control.disabled = false; }); });
  }

  function renderAll(): void {
    const draft = body.querySelector<HTMLInputElement>('input[type="text"]')?.value ?? "";
    body.empty();
    const tasks = plugin.settings.quadrant.tasks;
    const form = body.createEl("form", { cls: "qh-q-add-form" });
    guardFormComposition(form);
    const input = form.createEl("input", { type: "text", attr: { placeholder: L("添加任务…", "Add task…"), "aria-label": L("任务内容", "Task text") } });
    input.value = draft;
    const select = form.createEl("select", { cls: "dropdown qh-q-select", attr: { "aria-label": L("任务象限", "Task quadrant") } });
    for (const q of QUADRANTS) select.createEl("option", { value: q, text: L(QUADRANT_META[q].zh, QUADRANT_META[q].en) });
    select.value = currentQuad;
    select.addEventListener("change", () => { currentQuad = select.value as Quadrant; });
    const submit = form.createEl("button", { type: "submit", cls: "qh-q-add-btn", attr: { "aria-label": L("添加任务", "Add task") } });
    setIcon(submit, "plus");
    form.addEventListener("submit", event => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text || saving) return;
      const task: QuadrantTask = { id: crypto.randomUUID(), text, quadrant: currentQuad, completed: false, createdAt: Date.now(), completedAt: null };
      commit(current => [task, ...current], () => { input.value = ""; });
    });

    const grid = body.createDiv({ cls: "qh-q-grid" });
    for (const q of QUADRANTS) {
      const meta = QUADRANT_META[q];
      const qTasks = tasks.filter(task => !task.completed && task.quadrant === q);
      const cell = grid.createDiv({ cls: `qh-q-cell qh-q-cell-${q}` });
      const head = cell.createDiv({ cls: "qh-q-head" });
      setIcon(head.createSpan({ cls: "qh-q-dot" }), meta.icon);
      head.createSpan({ cls: "qh-q-label", text: L(meta.zh, meta.en) });
      if (qTasks.length) head.createSpan({ cls: "qh-q-count", text: String(qTasks.length) });
      const list = cell.createDiv({ cls: "qh-q-list" });
      for (const task of expanded.has(q) ? qTasks : qTasks.slice(0, 2)) {
        const item = list.createDiv({ cls: "qh-q-item" });
        const label = item.createEl("label", { cls: "qh-q-task-label" });
        const checkbox = label.createEl("input", { type: "checkbox" });
        label.createSpan({ cls: "qh-q-item-text", text: task.text });
        checkbox.addEventListener("change", () => {
          const completedAt = Date.now();
          commit(current => current.map(entry => entry.id === task.id ? { ...entry, completed: true, completedAt } : entry));
        });
        const remove = item.createEl("button", { cls: "qh-q-del-btn qh-icon-button", attr: { "aria-label": L("删除 {v}", "Delete {v}", { v: task.text }) } });
        setIcon(remove, "trash");
        remove.addEventListener("click", () => commit(current => current.filter(entry => entry.id !== task.id)));
      }
      if (!qTasks.length) list.createDiv({ cls: "qh-q-empty", text: L("暂无", "—") });
      if (qTasks.length > 2) {
        const more = cell.createEl("button", { cls: "qh-q-more", text: expanded.has(q) ? L("收起", "Show less") : L("+{n} 更多", "+{n} more", { n: qTasks.length - 2 }), attr: { "aria-expanded": String(expanded.has(q)) } });
        more.addEventListener("click", () => { if (expanded.has(q)) expanded.delete(q); else expanded.add(q); renderAll(); });
      }
    }
    const completedCount = tasks.filter(task => task.completed).length;
    if (completedCount) {
      const footer = body.createDiv({ cls: "qh-q-footer" });
      const history = footer.createEl("button", { cls: "qh-q-footer-btn", text: L("已完成 {n} 项", "{n} done", { n: completedCount }) });
      history.addEventListener("click", () => new QuadrantHistoryModal(plugin, () => { if (body.isConnected) renderAll(); }).open());
    }
  }

  renderAll();
}
