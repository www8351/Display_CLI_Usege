# LEDGER

## ISSUES

Issue:  Terminal width detection is unverified inside a real Claude Code session. If every candidate fails, output falls back to two left-aligned lines with no shortening, which can wrap on narrow terminals.
Action: User will run this check personally (declined an assisted run on 2026-11-22). Install from the branch, confirm lines fit and right alignment works; --width is the fallback. Blocks merge of PR #2.
Status: OPEN

Issue:  PR #2 (feat/node-rewrite into main) open at github.com/www8351/Display_CLI_Usege/pull/2. CI runs on Windows, macOS, Linux with Node 18 and LTS.
Action: Merge after the live width check and green CI.
Status: OPEN

Issue:  Deferred minor findings from per-task and final reviews (all triaged "can wait"): non-atomic cache and settings writes, non-exclusive refresh lock, idle (not hard) fetch timeout, shell metacharacters in quoted labels not escaped, ambiguous-width glyphs in CJK terminals, stale per-model bucket shown when refresh keeps failing, assorted test gaps (need-API gating in-process, executing a spaced-path install command).
Action: Address in a follow-up when convenient.
Status: OPEN

Issue:  Older pushed commits 6a36cd4 and e1e0b72 carry a Claude-Session trailer (AI attribution). Commits from 2026-11-22 are clean.
Action: Left as is. Rewriting pushed history needs an explicit user instruction.
Status: OPEN

## ACTIONS

2026-11-23 | Installed the Node version from feat/node-rewrite on the user's machine at the user's request. Legacy PowerShell statusLine replaced, flags carried (only --align right differs from defaults). Backup settings.json.bak-20261123-001618. Smoke render of the installed script with the real cache shows all segments, including the Fable bucket. Live width check in a running session still pending.

2026-11-22 | Final whole-branch review: ready "with fixes". Fix wave: legacy left-aligned installs stay left, reinstall keeps current Node flags, option values lowercased and validated, empty settings.json accepted, refresh child runs from the temp dir with an error handler, test no longer spawns a real refresh (macOS Keychain risk), README gained Update section and Hebrew cleanup. 99 tests pass.

2026-11-22 | Built the Node.js rewrite on branch feat/node-rewrite, tasks 2 to 9 of the plan, each reviewed. statusline.js (render, data, git branch, cache and detached refresh, adaptive layout, entry point), install.js (cross-platform installer with legacy migration), test suite, CI workflow, README rewrite, PowerShell files moved to legacy/powershell/. Task 1 (width spike) skipped by the user. Review caught and fixed: argv prototype-key crash, cache backoff defeated by stale marker, console probe that created a CONOUT$ file in the cwd on Windows, right alignment breaking bar columns. Closes the old statusline.ps1 alignment issue (legacy code frozen).

2026-11-22 | Design doc approved by the user. Wrote the implementation plan. Old folder Downloads\Claude_Status_CLI kept at the user's request.

2026-11-22 | Repo path move. Local clone at C:\Users\www83\Display_CLI_Usege tracks github.com/www8351/Display_CLI_Usege (renamed from Claude_Quota_Line), fetch works. Old folder Downloads\Claude_Status_CLI has no .git and its files match the repo except line endings. Opened the new path in GitHub Desktop via its URL protocol. Old folder left in place.

2026-11-22 | Bootstrapped LEDGER.md. Reviewed statusline.ps1, install.ps1, test.ps1, README.md to prepare upgrade discussion.

## DECISIONS

Issue:  Upgrade goals.
Action: Upgrade adds new data (session cost, model name, folder and git branch), visual improvements (smooth partial bars, gradient colors, per-segment symbols, selectable themes), and Mac and Linux support. Burn-rate forecast was offered and not selected.
Status: FINAL

Issue:  Cross-platform runtime.
Action: Rewrite in Node.js as one script for all platforms. Rejected: PowerShell 7 everywhere (needs pwsh install on Mac/Linux, about 0.5s per render), separate PowerShell and bash scripts (logic written twice, drift risk).
Status: FINAL

Issue:  Distribution, legacy code, verification.
Action: Install stays git clone plus install script, no npm publishing. PowerShell version moves to legacy/powershell/ and is kept without further development. GitHub Actions runs tests on Windows, macOS and Linux. Design doc at docs/superpowers/specs/2026-11-22-node-rewrite-design.md.
Status: FINAL

Issue:  Layout height.
Action: Prefer two lines. If the terminal is too narrow, new info moves to a third line. Never more than three lines.
Status: FINAL

Issue:  Right alignment with bar table.
Action: Right alignment pads all bar lines by the same amount (from the longest), so bar columns stay aligned; a shorter bar line may end before the right edge. An info-only line aligns on its own. Rejected: padding each line separately, which breaks the table.
Status: REVISIT

Issue:  Scope of --ascii.
Action: --ascii replaces glyphs the tool draws (bars, icons, separators, arrows, ellipsis). User data such as folder, branch and model names is shown unchanged. Rejected: replacing non-ASCII data, which would destroy Hebrew folder names.
Status: REVISIT

Issue:  Width detection without the spike.
Action: detectWidth tries --width, stdout, stderr, COLUMNS, then the console device (\\.\CONOUT$ or /dev/tty opened read-write, never created). Verified in a live session still pending.
Status: REVISIT
