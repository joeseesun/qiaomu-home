import { Modal, setIcon } from "obsidian";
import type QiaomuHomePlugin from "./main";
import { L } from "./i18n";

type Quadrant = "q1" | "q2" | "q3" | "q4";

interface Task {
  id: string;
  text: string;
  quadrant: Quadrant;
  completed: boolean;
  createdAt: number;
  completedAt: number | null;
}

const QUADRANT_META: Record<Quadrant, { zh: string; en: string; icon: string; color: string }> = {
  q1: { zh: "重要紧急", en: "Urgent & Important", icon: "siren", color: "#e74c3c" },
  q2: { zh: "重要不紧急", en: "Important", icon: "target", color: "#3498db" },
  q3: { zh: "紧急不重要", en: "Urgent", icon: "alarm-clock", color: "#f39c12" },
  q4: { zh: "不重要不紧急", en: "Not urgent", icon: "circle", color: "#95a5a6" },
};

let tasks: Task[] = [];

async function loadTasks(plugin: QiaomuHomePlugin): Promise<void> {
  try {
    const data: any = await (plugin as any).loadData?.();
    if (data?.quadrant?.tasks) tasks = data.quadrant.tasks;
  } catch (e) {}
}

async function saveTasks(plugin: QiaomuHomePlugin): Promise<void> {
  try {
    const all: any = await (plugin as any).loadData?.() ?? {};
    all.quadrant = { tasks };
    await (plugin as any).saveData?.(all);
  } catch (e) {}
}

class QuadrantHistoryModal extends Modal {
  constructor(private plugin: QiaomuHomePlugin, private refresh: () => void) {
    super(plugin.app);
    this.modalEl.addClass("qh-ui");
  }

  async onOpen(): Promise<void> {
    this.setTitle(L("已完成任务", "Completed tasks"));
    const { contentEl } = this;
    contentEl.empty();

    const completed = tasks.filter(t => t.completed);
    if (completed.length === 0) {
      contentEl.createDiv({ cls: "qh-empty", text: L("暂无已完成任务", "No completed tasks") });
      return;
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterday = today - 86400000;
    const weekStart = today - (now.getDay() === 0 ? 6 : now.getDay() - 1) * 86400000;

    const groups: [string, Task[]][] = [
      [L("今天", "Today"), []],
      [L("昨天", "Yesterday"), []],
      [L("本周", "This week"), []],
      [L("更早", "Earlier"), []],
    ];

    completed.forEach(t => {
      if (!t.completedAt) return;
      if (t.completedAt >= today) groups[0][1].push(t);
      else if (t.completedAt >= yesterday) groups[1][1].push(t);
      else if (t.completedAt >= weekStart) groups[2][1].push(t);
      else groups[3][1].push(t);
    });

    groups.forEach(([label, gTasks]) => {
      if (gTasks.length === 0) return;
      contentEl.createEl("h3", { cls: "qh-history-group-title", text: `${label} (${gTasks.length})` });
      gTasks.forEach(task => {
        const row = contentEl.createDiv({ cls: "qh-history-row" });
        row.createSpan({ cls: "qh-history-text", text: task.text });
        const restoreBtn = row.createEl("button", { cls: "qh-icon-button", attr: { "aria-label": L("恢复", "Restore") } });
        setIcon(restoreBtn, "rotate-ccw");
        restoreBtn.onclick = async () => {
          task.completed = false;
          task.completedAt = null;
          await saveTasks(this.plugin);
          this.refresh();
          this.close();
        };
      });
    });
  }

  onClose(): void { this.contentEl.empty(); }
}

export function renderQuadrantBody(body: HTMLElement, plugin: QiaomuHomePlugin): void {
  let currentQuad: Quadrant = "q1";

  function renderAll() {
    body.empty();

    // 1. 顶部：添加任务（极简风格，一行搞定）
    const form = body.createEl("form", { cls: "qh-q-add-form" });
    const input = form.createEl("input", {
      attr: { type: "text", placeholder: L("添加任务…", "Add task…") },
    });
    // 自定义下拉组件
    const selectBtn = form.createEl("button", { cls: "qh-q-select-btn", type: "button" });
    selectBtn.textContent = L(QUADRANT_META[currentQuad].zh, QUADRANT_META[currentQuad].en);
    const dropdown = form.createDiv({ cls: "qh-q-dropdown" });
    dropdown.style.display = "none";
    (Object.keys(QUADRANT_META) as Quadrant[]).forEach(q => {
      const item = dropdown.createDiv({ cls: "qh-q-dropdown-item" });
      item.textContent = L(QUADRANT_META[q].zh, QUADRANT_META[q].en);
      item.addEventListener("click", () => {
        currentQuad = q;
        selectBtn.textContent = L(QUADRANT_META[q].zh, QUADRANT_META[q].en);
        dropdown.style.display = "none";
      });
    });
    selectBtn.addEventListener("click", (e) => {
      e.preventDefault();
      dropdown.style.display = dropdown.style.display === "none" ? "block" : "none";
    });
    document.addEventListener("click", (e) => {
      if (!form.contains(e.target as Node)) {
        dropdown.style.display = "none";
      }
    });

    const submit = form.createEl("button", { type: "submit", cls: "qh-q-add-btn", attr: { "aria-label": L("添加", "Add") } });
    setIcon(submit, "plus");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      tasks.unshift({
        id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        text,
        quadrant: currentQuad,
        completed: false,
        createdAt: Date.now(),
        completedAt: null,
      });
      await saveTasks(plugin);
      input.value = "";
      renderAll();
    });

    updateTaskList();
  }

  function updateTaskList() {
    // 删掉旧的网格和底部
    body.querySelectorAll(".qh-q-grid, .qh-q-footer").forEach(el => el.remove());

    // 2. 中部：2×2 四象限网格
    const grid = body.createDiv({ cls: "qh-q-grid" });
    const quadrants: Quadrant[] = ["q1", "q2", "q3", "q4"];

    quadrants.forEach((q) => {
      const meta = QUADRANT_META[q];
      const qTasks = tasks.filter(t => !t.completed && t.quadrant === q);

      const cell = grid.createDiv({ cls: `qh-q-cell qh-q-cell-${q}` });

      // 象限标题
      const qHead = cell.createDiv({ cls: "qh-q-head" });
      setIcon(qHead.createSpan({ cls: "qh-q-dot" }), meta.icon);
      qHead.createSpan({ cls: "qh-q-label", text: L(meta.zh, meta.en) });
      if (qTasks.length > 0) {
        qHead.createSpan({ cls: "qh-q-count", text: String(qTasks.length) });
      }

      // 任务列表（最多显示 2 条）
      const list = cell.createDiv({ cls: "qh-q-list" });
      qTasks.slice(0, 2).forEach(task => {
        const item = list.createDiv({ cls: "qh-q-item" });
        const cb = item.createEl("input", { attr: { type: "checkbox" } });
        cb.addEventListener("change", async () => {
          task.completed = cb.checked;
          task.completedAt = cb.checked ? Date.now() : null;
          await saveTasks(plugin);
          renderAll();
        });
        item.createSpan({ cls: "qh-q-item-text", text: task.text });
        const delBtn = item.createEl("button", { cls: "qh-q-del-btn", attr: { "aria-label": "删除" } });
        setIcon(delBtn, "trash");
        delBtn.addEventListener("click", async () => {
          tasks = tasks.filter(t => t.id !== task.id);
          await saveTasks(plugin);
          renderAll();
        });
      });

      if (qTasks.length === 0) {
        list.createDiv({ cls: "qh-q-empty", text: L("暂无", "—") });
      } else if (qTasks.length > 2) {
        list.createDiv({ cls: "qh-q-more", text: L(`+${qTasks.length - 2} 更多`, `+${qTasks.length - 2} more`) });
      }
    });

    // 3. 底部：历史入口（极简）
    const completedCount = tasks.filter(t => t.completed).length;
    if (completedCount > 0) {
      const footer = body.createDiv({ cls: "qh-q-footer" });
      const viewBtn = footer.createEl("button", { cls: "qh-q-footer-btn", text: L(`已完成 ${completedCount} 项`, `${completedCount} done`) });
      viewBtn.onclick = () => new QuadrantHistoryModal(plugin, renderAll).open();
    }
  }

  renderAll();
  void loadTasks(plugin).then(renderAll);
}