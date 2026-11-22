# LEDGER

## ISSUES

Issue:  Node.js rewrite ready to build. Design approved 2026-11-22. Plan at docs/superpowers/plans/2026-11-22-node-rewrite.md (9 tasks, Task 1 is a width spike that needs the user).
Action: Execution method chosen: subagent per task with review. Next is Task 1, which needs the user to approve a temporary settings.json change.
Status: IN PROGRESS

Issue:  Older pushed commits 6a36cd4 and e1e0b72 carry a Claude-Session trailer (AI attribution). Commits from 2026-11-22 are clean.
Action: Left as is. Rewriting pushed history needs an explicit user instruction.
Status: OPEN

Issue:  statusline.ps1 has two right-align code paths. Format-Line and Get-TerminalWidth are defined but never called. The active block falls back to width 120 instead of staying left aligned as README states. RightMargin parameter is unused.
Action: Fold into upgrade work or fix separately.
Status: OPEN

## ACTIONS

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
