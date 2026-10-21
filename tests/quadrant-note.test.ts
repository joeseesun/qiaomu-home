import { describe, expect, it } from "vitest";
import { parseTasks, serializeTasks } from "../src/quadrant-ui";

describe("quadrant note format", () => {
  it("reads tagged and untagged checkbox lines", () => {
    const tasks = parseTasks([
      "# 任务四象限",
      "",
      "## 未完成",
      "",
      "- [ ] 写周报 #q2",
      "- [ ] 别人笔记里的任务",
      "- [x] 打电话 #q3 ✅ 2026-10-20",
    ].join("\n"));

    expect(tasks.map(task => [task.text, task.quadrant, task.completed, task.tagged])).toEqual([
      ["写周报", "q2", false, true],
      ["别人笔记里的任务", "q1", false, false],
      ["打电话", "q3", true, true],
    ]);
    expect(tasks[2].completedAt).toBe(new Date(2026, 9, 20).getTime());
  });

  it("keeps untagged lines untagged when writing back", () => {
    const content = ["- [ ] 写周报 #q2", "- [ ] 别人笔记里的任务", "- [x] 打电话 #q3 ✅ 2026-10-20"].join("\n");
    const written = serializeTasks(parseTasks(content));

    expect(written).toContain("- [ ] 写周报 #q2");
    expect(written).toContain("- [ ] 别人笔记里的任务\n");
    expect(written).not.toContain("别人笔记里的任务 #q1");
    expect(written).toContain("- [x] 打电话 #q3 ✅ 2026-10-20");
  });

  it("writes the completion date in the local time zone", () => {
    const lateEvening = new Date(2026, 9, 21, 23, 30).getTime();
    const [task] = parseTasks("- [ ] 写周报 #q1");
    task.completed = true;
    task.completedAt = lateEvening;

    expect(serializeTasks([task])).toContain("✅ 2026-10-21");
  });

  it("round-trips a note without losing task text or order", () => {
    const content = ["# 任务四象限", "", "## 未完成", "", "- [ ] 一 #q1", "- [ ] 二 #q4", ""].join("\n");
    const once = serializeTasks(parseTasks(content));
    const twice = serializeTasks(parseTasks(once));

    expect(twice).toBe(once);
    expect(once.indexOf("一 #q1")).toBeLessThan(once.indexOf("二 #q4"));
  });
});