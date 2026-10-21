# PR #25 quadrant validation

Reviewed against `ab2ff3ae90ea14398f389bb66b95cca7149598b7` on macOS, 2026-10-21.
The original contribution and its two commits are retained.

## Reproduced defects

- Calling the production `renderProductivity(..., "quadrant", ...)` dispatcher creates a heading but no quadrant cells (expected 4, actual 0).
- Loading the original `data.quadrant.tasks` format and calling the real plugin `saveSettings()` drops `quadrant` from the stored snapshot. Restarting cannot recover it.
- The component had no stylesheet, used module-global tasks and unqueued direct `loadData`/`saveData` calls, swallowed write errors, and accumulated document click handlers on each render.
- Tasks after the first two in a quadrant were inaccessible. The seven additional shipped locales lacked the new strings.

## Fix

Quadrant tasks are normalized into `HomeSettings` with the same persisted format. Task edits and ordinary settings writes share the plugin's save queue. A task edit derives from the latest tasks when its turn starts and publishes in-memory state only after the write succeeds. A queued settings snapshot uses the latest committed tasks, so it cannot erase a preceding task edit.

The production dispatcher now renders the component. Its native select, labeled controls, IME guard, expandable lists, completion history, restore action, save-error notice and retained draft cover the existing task workflow. Styles use Home's light, dark and wallpaper color variables, and switch to one column in narrow cards.

## Automated validation

Run `npm run check` (ESLint, Vitest, TypeScript, production bundle) or `npm test -- tests/quadrant.test.ts` for the focused suite.

The 16 focused tests exercise the real plugin `onload`, `saveSettings` and `updateQuadrantTasks` methods and the production card dispatcher. Obsidian host APIs are mocked. Coverage includes:

- Adding a task, changing ordinary settings, and creating a fresh plugin instance from saved data.
- Writing to a real temporary `data.json`, unloading, reading that file, and loading a new instance.
- Legacy task/history migration, malformed data and isolation between vault instances.
- Concurrent task edits, queued settings snapshots, stale callbacks and deleted-task resurrection.
- Completion, history cancellation, restoration, deletion and accessing the third task.
- Blank/canceled drafts, IME composition, repeat submission and closing a card during a pending write.
- Interrupted/rejected writes, queue recovery, retained drafts, and failed completion/delete/restore operations.
- No document click-handler accumulation; responsive stylesheet and all shipped locale coverage.

The two core regression tests were also run against the original PR head, where both failed as described above.

## Browser validation and limits

The actual component and stylesheet were rendered in Chrome on the user's Mac, with a small Obsidian API shim. Light Chinese (420px), dark English (320px), and wallpaper colors at 260px were inspected. At 320px the grid measured two 141px columns with no horizontal overflow; at 260px it measured one 230px column with no overflow. Adding, expanding, completing, opening history and restoring a task were exercised; no JavaScript console errors were reported.

This is component/browser validation and plugin-level persistence testing, not a live Obsidian vault installation or a physical mobile-device test. No plugin was installed or released, no PR was merged, and no external-contributor CI run was approved. A process crash during Obsidian's underlying file write and cross-device Sync conflict resolution remain host responsibilities outside this test harness.
