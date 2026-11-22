# claude-quota-line v2: Node.js rewrite

Date: 2026-11-22

## Intent

claude-quota-line is a Claude Code status line that shows the claude.ai usage numbers inside the terminal: context window fill, the 5-hour limit, the weekly all-models limit, and the weekly limit for one model. Today it is a single PowerShell script that runs on Windows only.

The upgrade has three goals, chosen by the owner:

1. Show more data: session cost, current model name, current folder and git branch.
2. Look better: smooth partial bars, gradient colors, a symbol per segment, selectable themes.
3. Run on Windows, macOS and Linux.

## Goals

* One Node.js codebase that runs unchanged on all three platforms.
* All four existing segments keep working with the same data sources and the same meaning.
* Three new segments: model name, folder plus git branch, session cost.
* Visual upgrade as listed above.
* Layout fits in two lines when the terminal is wide enough, uses a third line otherwise, and never uses more than three.
* An installer for all platforms that also replaces an existing PowerShell install cleanly.
* Fix the known defects of the current script (see Constraints).

## Non-goals

* Burn rate or time-until-exhausted forecast. Offered and not selected.
* Publishing to npm or any package registry. Install stays `git clone` plus an install script.
* A config file. Configuration stays as command-line flags written by the installer.
* Tracking more than one per-model bucket at a time.

## Anti-goals

These would make the upgrade a failure even if it technically works:

* Ever printing more than three lines.
* A render that feels slow. Target under 100 ms on a normal run with a warm cache.
* A network call that blocks the render.
* Breaking or silently corrupting an existing user's `settings.json`.
* Adding npm dependencies. The script must run with a plain `node` and nothing installed.

## Constraints

* Node.js 18 or newer. Built-in modules only.
* Input is the Claude Code status line JSON on stdin. A real captured payload (Claude Code 2.1.245) has these fields relevant here:
  * `model.display_name`, for example `Opus 5 (1M context)`
  * `workspace.current_dir`, `workspace.project_dir`, `cwd`
  * `workspace.repo` with `host`, `owner`, `name` (no branch)
  * `cost.total_cost_usd`
  * `context_window.used_percentage`
  * `rate_limits.five_hour` and `rate_limits.seven_day`, each with `used_percentage` and `resets_at` in epoch seconds
* The per-model weekly figure is not in the payload. It comes from the undocumented endpoint `https://api.anthropic.com/api/oauth/usage` with header `anthropic-beta: oauth-2025-04-20` and the Claude Code OAuth token. Both response shapes the current script handles must still be handled: a `limits[]` entry with `kind: "weekly_scoped"` and `scope.model.display_name`/`scope.model.id`, and the older top-level `seven_day_<key>` objects. `utilization` values at or below 1 are fractions and must be scaled to percent.
* Token location differs by platform. Windows and Linux: `~/.claude/.credentials.json`, field `claudeAiOauth.accessToken`. macOS: Claude Code stores it in the Keychain, service name `Claude Code-credentials`.
* `CLAUDE_CONFIG_DIR`, when set, replaces `~/.claude` everywhere: credentials, cache, lock file, dump file, install folder, `settings.json`, and uninstall. The installer prints the resolved config folder so a mismatch with Claude Code's environment is visible. (Builder's call.)
* Session cost on a Pro or Max subscription is an API-equivalent estimate computed by Claude Code, not a real charge. The README must say so.
* Known defects in the current script that the rewrite must not carry over:
  * Two right-align code paths exist. `Format-Line` and `Get-TerminalWidth` are never called. The active path falls back to width 120 when detection fails, while the README says lines then stay left aligned.
  * `-RightMargin` is accepted but unused.

## Approaches considered

| Approach | Trade-off | Outcome |
| --- | --- | --- |
| Node.js, one script | One codebase, fast start (about 0.1 s), native JSON and HTTPS. Requires Node installed, which most Claude Code users already have. Full rewrite. | Picked by the owner |
| PowerShell 7 everywhere | Keeps the existing code. Mac and Linux users must install `pwsh`. About 0.5 s per render. | Rejected |
| PowerShell for Windows, bash for Mac/Linux | No new runtime. Every change written twice, the two drift apart, bash needs `jq`. | Rejected |

## Decided by the owner

* Runtime: Node.js.
* Layout: two lines preferred, third line only when needed, three at most.
* New data: session cost, model name, folder and branch.
* Visuals: all four upgrades (smooth bars, gradient colors, symbols, themes).
* Platforms: Windows, macOS, Linux.
* Distribution: `git clone` plus install script. No registry publishing.
* The PowerShell version is kept in the repo, not deleted, with no further development.
* This design lives in a separate committed file.
* CI on Windows, macOS and Linux through GitHub Actions.

## Design

### Files

```
statusline.js          render script, the only file the status line runs
install.js             installer and uninstaller for all platforms
test/                  node:test suites with fixture payloads
legacy/powershell/     statusline.ps1, install.ps1, test.ps1 moved here unchanged
quota.json             sample statusLine block, updated to the Node command
```

### Segments

| Segment | Source | Notes |
| --- | --- | --- |
| Context | stdin `context_window.used_percentage` | 0 when the window exists but the value is null (fresh session) |
| 5-hour | stdin `rate_limits.five_hour`, API fallback | Reset shown as time left, for example `4h48m` |
| Weekly | stdin `rate_limits.seven_day`, API fallback | Reset shown as local weekday and time, for example `Thu 12:59` |
| Per-model | API only | Matched by `--model-key`, label `--model-label` |
| Model | stdin `model.display_name` | New |
| Folder and branch | basename of `workspace.current_dir` (fall back to `cwd`); branch from `.git/HEAD` | New. Walk up from the folder to find `.git`. Handle `.git` as a file (worktrees, submodules) by following its `gitdir:` line. Detached HEAD shows a short hash. No git process is spawned. |
| Cost | stdin `cost.total_cost_usd` | New. Two decimals, for example `$3.75` |

A segment with no data is skipped, never rendered empty. When nothing at all is available, print one dim placeholder line, as today.

### Layout

The four bar segments keep the current table look: labels padded to the widest label, fixed-width reset column, so the two bar lines align.

```
Opus 5 (1M context) │ Display_CLI_Usege ⎇ main │ $3.75
Context win ██▍░░░░░░░  22%             │ 5H Limit █▏░░░░░░░░  11% ↻ 4h48m
Weekly      ██▊░░░░░░░  28% ↻ Thu 12:59 │ Fable    ████▌░░░░░  45% ↻ Thu 12:59
```

Line selection:

1. Two-line mode: info segments (model, folder and branch, cost) join the end of the bar lines, model and cost on line 1, folder and branch on line 2. Use it if both lines fit within the available width.
2. Otherwise three-line mode: info on its own first line, as above.
3. If a line still does not fit, shorten in this order: truncate the folder name with an ellipsis, drop the model name's parenthesized suffix, drop reset labels, switch automatically to the compact `minimal` layout, and as the last resort hard truncate each line with an ellipsis (ANSI aware). Never wrap to a fourth line. (Builder's call, recorded here.)
4. Any shortening step applied to one bar line is applied to both bar lines, so the table stays aligned. (Builder's call.)

Available width is the terminal width minus `--right-margin` (default 2). Terminal width comes from `--width` when given, otherwise from detection (see Open risks). When the width is unknown, use two-line mode and left alignment.

`--align right` pads each line to the available width. This is the only alignment code path.

### Visuals

* **Smooth bars.** Full cells use `█`. The cell at the boundary uses one of the eighth blocks `▏▎▍▌▋▊▉`. Empty cells use `░` in a dim color. `--bar-width` sets the cell count, default 10.
* **Gradient colors.** The color of a bar and its percentage moves continuously from green at 0% through yellow at 50% to red at 80% and above. Use 24-bit color when the terminal reports it (`COLORTERM` is `truecolor` or `24bit`), otherwise the nearest of the 256-color palette. The current 3-step colors stay as the 16-color fallback.
* **Symbols.** One symbol before each segment. `--icons unicode` (default) uses characters common fonts carry, for example `⎇` for branch and `$` for cost. `--icons nerd` uses Nerd Font glyphs. `--icons none` uses no symbols. The exact symbol set is the builder's call.
* **Themes.** `--theme default` is the full colored look above. `--theme minimal` drops the long labels in favor of symbols and uses a shorter bar, for the narrowest terminals. `--theme mono` uses no color at all. `--ascii` stays as an independent switch that replaces every non-ASCII character, combinable with any theme.

### Usage API and cache

* Cache file stays `~/.claude/quota-line-cache.json` and lifetime `--refresh-seconds` (default 300).
* The render never waits on the network. When the cache is stale or missing, the render uses whatever cache exists and spawns a detached child process (`statusline.js --refresh`) that fetches with a 4 s timeout and rewrites the cache. A lock file prevents two refreshes running at once.
* On fetch failure, touch the cache timestamp so the endpoint is not retried on every render. Same as today.
* If the token or endpoint is unavailable, the per-model segment is dropped and everything else keeps working.

### Flags

Kebab-case versions of today's flags, plus the new ones:

`--bar-width`, `--refresh-seconds`, `--model-key`, `--model-label`, `--ctx-label`, `--five-hour-label`, `--week-label`, `--ascii`, `--align`, `--width`, `--right-margin`, `--dump-input`, `--theme`, `--icons`, `--no-model`, `--no-folder`, `--no-cost`, `--refresh`.

`--dump-input` writes the last payload to `~/.claude/quota-line-last-input.json`, as today.

### Installer

`node install.js [flags]` on every platform.

* Copies `statusline.js` to `~/.claude/quota-line/`.
* Backs up `settings.json` with a timestamp suffix before any write, then sets only the `statusLine` key: `{ "type": "command", "command": "node \"<abs path>/statusline.js\" <flags>", "padding": 0 }`. Every other key is preserved byte-for-byte in meaning.
* If an existing `statusLine` points at the old `statusline.ps1`, it is replaced and the old `~/.claude/quota-line/statusline.ps1` is removed. Flags in the old command (`-ModelKey`, `-ModelLabel`, `-BarWidth`, `-Align`, `-Width`, the label flags, `-Ascii`, `-RefreshSeconds`) are parsed and carried over as their kebab-case equivalents. Flags passed to `install.js` win over carried-over ones. The installer prints the final command. (Builder's call.) A `statusLine` pointing at anything else is replaced only after printing what was there.
* Installer defaults match today's: `--align right`, model key `fable`, label `Fable`.
* `--uninstall` removes the `statusLine` key, the install folder and the cache file.
* Refuses to run if `node` is older than 18, with a clear message.

### Tests

`node --test` with no dependencies. Fixture payloads cover: full payload, fresh session with null context, API-key session with no `rate_limits`, both API response shapes, missing credentials, detached HEAD, `.git` as a file, a folder outside any repo. Layout tests feed fixed `--width` values and assert line count (2 or 3, never more) and that no line exceeds the width. A render timing check measures the in-process render with a warm cache and asserts it stays well under the 100 ms target. Full process time including Node startup is printed for information but does not fail the run, since shared CI runners make it noisy. HTTPS and Keychain code load lazily, only in the refresh process. (Builder's call.)

### Continuous integration

Decided by the owner. A GitHub Actions workflow runs `node --test` on Windows, macOS and Linux on every push and pull request, with Node 18 and the current LTS. This is the only verification macOS and Linux get before release, since development happens on Windows.

### README

Rewritten for the Node version, bilingual, English first then Hebrew. Covers requirements (Node 18+), install, all flags, themes, the cost caveat, macOS Keychain note, and a short note that the PowerShell version is kept under `legacy/powershell/` without further updates.

## Open risks

* **Terminal width detection with piped stdout.** Claude Code pipes the script's stdout, so `process.stdout.columns` is likely undefined. Candidates: `process.stderr.columns`, the `COLUMNS` environment variable, opening the controlling terminal (`/dev/tty` on macOS and Linux, `CONOUT$` on Windows) as a `tty.WriteStream`. The first implementation step is a short spike inside a real Claude Code session on Windows to see which of these returns a value. If none works, two-line mode with left alignment is the fallback and `--width` is the escape hatch.
* **macOS Keychain access** may show a permission prompt the first time the refresh process reads it. Because the refresh runs detached, a prompt cannot block the render, but it must be documented.

## Left to the builder

* Exact symbol set for `unicode` and `nerd` icon modes.
* Exact RGB stops of the gradient beyond green, yellow, red at 0, 50 and 80 percent.
* Internal module structure of `statusline.js`, as long as it stays one runnable file for install.
* Lock file mechanism for the refresh process.
