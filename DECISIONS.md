# Decision log

Decisions made while building Novel Goal Tracker. "You" decisions were approved by the project owner; "Agents" decisions are small, reversible choices logged for review.

| Date | Decision | By | Why |
| --- | --- | --- | --- |
| 2026-11-19 | Plugin name "Novel Goal Tracker", ID `novel-goal-tracker` | You | No listed plugin uses it; avoids the NaNoWriMo trademark |
| 2026-11-19 | ~~Today's words are net (additions minus deletions)~~ Replaced on 2026-11-20, see below | You | |
| 2026-11-19 | Several novels in v1, one folder each | You | |
| 2026-11-19 | MIT license; GitHub account morganherg; repo stays local until M5 | You | |
| 2026-11-19 | Dashboard is a `novel-dashboard` code block in `Dashboard.md`, opened in reading view | Agents | The note syncs and links like any note; reading view avoids showing the block's source |
| 2026-11-19 | Keep the classic settings screen (`display()`), defer the 1.13 declarative settings API to M4 | Agents | Supports older Obsidian versions; lint shows 3 warnings until then |
| 2026-11-19 | Minimum Obsidian version raised from 1.7.2 to 1.8.7 | Agents | Needed for vault-local storage of the per-device ID (`loadLocalStorage`) |
| 2026-11-19 | Only typing in this device's editor counts toward today; sync, other plugins, and file moves change totals only | Agents | Prevents double counting across synced devices |
| 2026-11-19 | Pasted text counts as writing | Agents | Cut-and-paste between chapters must net zero, so paste can't be ignored. Revisit if you want pastes excluded |
| 2026-11-19 | Typing is detected from CodeMirror's user-input tags, not timing; untagged changes (sync reloads, plugin inserts such as templates) only move the baseline | Agents | Review found timing-based detection could credit synced words twice |
| 2026-11-19 | List `@codemirror/state` and `@codemirror/view` as dev dependencies at the versions Obsidian already requires | Agents | Type-only; Obsidian provides them at runtime, nothing new is bundled or downloaded |
| 2026-11-19 | Korean counts by spaces; Chinese and Japanese count per character | Agents | Korean separates words with spaces |
| 2026-11-19 | Settings sync: the most recently changed device's settings win | Agents | Avoids devices reverting each other's settings |
| 2026-11-19 | History stored in `data.json`, one entry per device; each save re-reads and merges | Agents | Two synced devices never overwrite each other's history |
| 2026-11-19 | Manual "Add words for a day" adjustments count toward the day and the novel total | Agents | Credits writing done outside Obsidian |
| 2026-11-19 | Optional settings to count code and comments (both off by default) | Agents | PDR: each counting rule is a setting |
| 2026-11-20 | Charts are hand-drawn SVG; no chart library | Agents | Nothing to license or download; colors follow the Obsidian theme |
| 2026-11-20 | Dashboard copies NaNoWriMo's card layout and formulas, not its artwork, logo, or joke wording | Agents | Avoids trademark and copyright issues |
| 2026-11-20 | Manual word entries can't be dated in the future; deleting one takes two clicks | Agents | Future entries distorted the progress line; prevents accidental deletes |
| 2026-11-20 | After the end date, Projected finish shows "Ended" and the words short | Agents | A projection past the deadline isn't meaningful |
| 2026-11-20 | Pastes, drops, and cuts are detected at the page level (capture phase) before Obsidian handles them | Agents | Obsidian applies them without CodeMirror's user tag; pasted words weren't counted toward today |
| 2026-11-20 | Words added by hand appear as their own row in the chapter table and in the Total progress card | Agents | So every total on the dashboard adds up |
| 2026-11-20 | Today's words, streak, words needed today, daily chart, and log use words typed (additions only); totals and the progress line still use the exact net change | You | Deleting or trimming text shouldn't hide what you typed today |
| 2026-11-20 | Minimum Obsidian version 1.13.0; settings use only the declarative settings API | You | Removes the deprecated classic settings screen and its lint warnings |
| 2026-11-20 | "Stop tracking" asks first; "Track existing novel folder" brings a novel back with its history; Edit novel can re-point the folder | Agents | Untracking was one tap with no way back |
| 2026-11-20 | Synced data that differs from memory is written back right away; a new install's default settings never replace real ones | Agents | Prevents losing novels, history, or settings on restart after sync |
| 2026-11-20 | "Words needed today" target is fixed at the start of the day (uses today's net change) | Agents | Deleting while revising no longer moves today's target |
| 2026-11-20 | Chapters opened from the dashboard open in editing mode | Agents | Found by the Obsidian end-to-end test: they opened read-only in the dashboard's reading view |
| 2026-11-20 | Playwright tests: a browser suite (runs in CI) and a real-Obsidian suite (run on request; isolated profile and vault) | You | You asked for Playwright-based testing |
