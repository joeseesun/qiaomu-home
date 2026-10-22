# Quadrant integration: PR #25 + #26

This integration preserves the original contributor commits from both branches, plus the #25 persistence/UI fix. It is intended for a draft integration PR against `main`, not for automatically merging or closing either contribution.

Reviewed inputs:

- `main`: `0eaa321d37d078e709ab5fe3f4cb3d8bca9a76fb`
- [#25](https://github.com/joeseesun/qiaomu-home/pull/25): `b5171d7cbb88c72edc9dade3d1245cc6198b7cf4` (original reviewed head `ab2ff3ae90ea14398f389bb66b95cca7149598b7`).
- [#26](https://github.com/joeseesun/qiaomu-home/pull/26): `5d8e3aab21368f263154525df8d856e993ed64bb`.
- Complete PR bodies, diffs, issue comments, review submissions/threads and workflow runs were checked. No comments/reviews were present. Both external workflow runs were `action_required` with no executed jobs; no approval was given.

## Reproduced defects

The original #25 dispatcher did not call the quadrant renderer and ordinary settings saves dropped `data.quadrant`. That regression was repaired at `b5171d7`.

At #26's head, `serializeTasks(parseTasks(note))` replaces the entire note with generated headings and task rows. An isolated fixture with properties, prose and nested tasks loses those parts. CRLF task rows also fail its old parser, producing empty sections. The read helper catches failures as an empty task array. Add/complete/delete/restore mutate state before writing and ignore `saveTasksToFile` returning false. Normalizing/saving settings discards the legacy source before successful migration.

## Resulting behavior

- Choose a Markdown note using the contributed module setting/picker. An absent note is created on first successful add; its parent folder must already exist. The card remains read-only until the initial read succeeds and offers Retry on read failure.
- Changes run through `Vault.process` against current contents, with a shared queue per vault and path. Appends preserve the complete existing prefix. Completion/restoration replace only the selected checkbox and completion-date token. Leaf deletion removes only its row. Deleting a parent turns it into an ordinary list item, retaining its title, nested tasks and indented prose.
- Properties, BOM, non-task text, links, indentation, original row order, LF/CRLF/CR line endings and absence of a final newline are retained. Appending adds a necessary separator newline and uses the note's existing EOL. Fenced/indented code and HTML comments are excluded. Unclosed properties/fences/comments block appending.
- A stale/changed/deleted or ambiguous task causes a retry/reload error rather than editing an unrelated row. Removed/moved notes and unsaved Markdown editors block writes. Paths outside the vault or in its configured settings directory are rejected.
- UI state and input change only after successful writes. Failures keep the draft/checkbox/history available. Repeated submissions are disabled while pending; operation receipts prevent duplication if an append reached disk but its acknowledgement failed. A saved task survives closing the card during its write.
- Legacy tasks remain in `data.json` until the user explicitly imports them into the selected note. Migration reserves its destination in the same queue as settings writes, appends tasks with separate hidden receipts, then clears the legacy backup only after note persistence and settings cleanup succeed. Receipts survive task deletion. Interrupted writes/cleanup and restarts retry idempotently; a reserved migration cannot silently switch notes. Do not remove these receipts while a migration is pending.
- Both contributions' expandable cells, local-day dates, native accessible controls, IME protection and translations are retained. Expansion is remembered per plugin/note; the broad forced-dark modal overrides are replaced with scoped theme-aware quadrant styles. Module-option hints wrap.

## Automated evidence

Run `npm run check` (lint, all tests, TypeScript via build, production esbuild). No new dependencies or lockfile changes.

The quadrant suites exercise the production dispatcher and real plugin settings/migration methods against Obsidian API mocks, plus isolated real temporary Markdown and `data.json` files. Coverage includes:

- Exact string equality for BOM/frontmatter/prose/nested/CRLF fixtures before and after each patch; entire original prefix equality after append/import.
- Untagged tasks, numbered and alternative bullets, inline code/tags, block IDs, invalid dates, unknown completed dates and local-day completion.
- Two cards adding concurrently, an external edit before `process`, concurrent note creation, stale duplicate/deleted tasks, dirty editors and path restrictions.
- Read/write failures, failed restore/history remaining open, repeated submit, IME, canceled drafts/history, card closure during pending write, uncertain write acknowledgements and retry.
- Legacy backup through ordinary settings saves; failed reservation/note write/cleanup; retry after restart; competing destinations; stale settings snapshots and repeated migration; restart from real disk files.
- Expansion/re-render/vault isolation and seven-locale completeness/placeholders.

Final run: **33 test files, 210 tests passed**. Lint: **0 errors**, three pre-existing warnings (`input-ui.ts` deprecated keyCode, `settings-tab.ts` settings-search API, `shortcut-ui.ts` sentence case). TypeScript and production build passed on the Mac's Node 24.21.0 using existing reviewed local dependencies.

## UI evidence and acceptance boundary

The actual renderer/store and production CSS were bundled with a small Obsidian host shim and opened in the user's Mac Chrome at loopback only. A disposable Markdown fixture with frontmatter, prose, nested tasks and CRLF was used; no daily vault was opened or modified.

Observed: failed add retains input and original text; retry adds once; failed read removes the writable form and Retry restores it; expansion, completion/history/restore work; page restart retains the saved note; 420 px light/Chinese, 320 px dark/English and 260 px wallpaper/German layouts render. The 260 px card had `clientWidth = scrollWidth = 230` and a single grid column. No JavaScript errors were recorded.

This is **component/adapter verification, not real Obsidian desktop or mobile acceptance**. A maintainer should use a disposable vault to check actual `Vault.process`, editor autosave, platform touch/keyboard behavior, Obsidian Sync and third-party themes. The queue covers this plugin within one vault process; cross-device sync is not a transaction. Duplicate/ambiguous externally edited rows require reload. Existing Markdown syntax outside the supported task patterns stays untouched. Keep migration receipts and the legacy backup during interrupted migration recovery; external deletion/renaming of a partially migrated note requires manual recovery before retrying.
