export type Quadrant = "q1" | "q2" | "q3" | "q4";

export interface QuadrantTask {
  id: string;
  text: string;
  quadrant: Quadrant;
  completed: boolean;
  createdAt: number;
  completedAt: number | null;
}

/** Read the original PR's data.quadrant format as part of the settings snapshot. */
export function normalizeQuadrant(value: unknown): { tasks: QuadrantTask[]; migrationPath?: string } {
  const raw = value && typeof value === "object" ? value as { tasks?: unknown; migrationPath?: unknown } : {};
  const tasks: QuadrantTask[] = [];
  const ids = new Set<string>();
  if (Array.isArray(raw.tasks)) for (const item of raw.tasks) {
    if (!item || typeof item !== "object") continue;
    const task = item as Record<string, unknown>;
    if (typeof task.id !== "string" || !task.id || ids.has(task.id) || typeof task.text !== "string" || !task.text.trim()) continue;
    if (typeof task.quadrant !== "string" || !["q1", "q2", "q3", "q4"].includes(task.quadrant)) continue;
    const createdAt = typeof task.createdAt === "number" && Number.isFinite(task.createdAt) && task.createdAt >= 0 ? task.createdAt : 0;
    const completed = task.completed === true;
    const completedAt = completed ? (typeof task.completedAt === "number" && Number.isFinite(task.completedAt) && task.completedAt >= 0 ? task.completedAt : createdAt) : null;
    tasks.push({ id: task.id, text: task.text, quadrant: task.quadrant as Quadrant, completed, createdAt, completedAt });
    ids.add(task.id);
  }
  return { tasks, ...(typeof raw.migrationPath === "string" && raw.migrationPath ? { migrationPath: raw.migrationPath } : {}) };
}
