# claude-quota-line

A status line for Claude Code that shows the same numbers you see in the claude.ai usage panel, inside the terminal, all the time. It also shows the current model, folder, git branch and session cost. It runs on Windows, macOS and Linux.

Wide terminal, two lines:

```
◔ Context win ██▎░░░░░░░  22%             │ ◷ 5H Limit    █▏░░░░░░░░  11% ↻ 4h48m     │ ✦ Opus 5 (1M context) │ $3.75
▦ Weekly      ██▊░░░░░░░  28% ↻ Thu 12:59 │ ◆ Fable       ████▌░░░░░  45% ↻ Thu 12:59 │ ⌂ Display_CLI_Usege ⎇ main
```

Narrower terminal, three lines:

```
✦ Opus 5 (1M context) │ ⌂ Display_CLI_Usege ⎇ main │ $3.75
◔ Context win ██▎░░░░░░░  22%             │ ◷ 5H Limit    █▏░░░░░░░░  11% ↻ 4h48m
▦ Weekly      ██▊░░░░░░░  28% ↻ Thu 12:59 │ ◆ Fable       ████▌░░░░░  45% ↻ Thu 12:59
```

Bars go from green through yellow to red as they fill, reaching red at 80%.

## What it shows

| Segment | Default label | Source | Meaning |
| --- | --- | --- | --- |
| Context | `Context win` | stdin | Context window fill for the current session |
| 5-hour | `5H Limit` | stdin, API fallback | Rolling 5-hour limit and time until it resets |
| Weekly | `Weekly` | stdin, API fallback | Weekly limit across all models and the reset day and time |
| Per-model | `Fable` | API | Weekly limit for one model, configurable |
| Model | none | stdin | Name of the model in use |
| Folder | none | stdin | Current folder and its git branch |
| Cost | none | stdin | Cost of the current session |

A segment with no data is skipped, not drawn empty. Labels are padded to the widest one so the bars line up.

Session cost on a Pro or Max subscription is an estimate computed by Claude Code. It is not a charge.

## Requirements

* Node.js 18 or newer. No packages to install.
* Claude Code 2.1.6 or newer.
* A Pro or Max subscription. Rate limit data is not passed for API-key sessions.

## Install

```
git clone https://github.com/www8351/Display_CLI_Usege
cd Display_CLI_Usege
node install.js
```

Restart Claude Code afterwards.

The installer copies `statusline.js` to `~/.claude/quota-line/`, backs up `~/.claude/settings.json`, and sets the `statusLine` key in it. Nothing else in the file is touched. It prints the config folder it used and the final command.

Pass any option from the table below to the installer, and it is written into the command:

```
node install.js --model-key opus --model-label Opus
node install.js --theme minimal --icons none
node install.js --align left
node install.js --bar-width 16
```

To remove everything:

```
node install.js --uninstall
```

This removes the `statusLine` key (only if it points at this tool), the install folder, the cache, and the debug files.

If you used the old PowerShell version, the installer replaces its entry, deletes the old script copy, and carries over the options it recognizes (`-ModelKey`, `-ModelLabel`, `-BarWidth`, `-Align`, `-Width`, the label options, `-Ascii`, `-RefreshSeconds`). Options you pass to `install.js` win over carried-over ones.

## Options

The same options work on `install.js` and on `statusline.js`. The installer only writes the ones that differ from the defaults, and it writes `--align right` unless you say otherwise. Run `node install.js --help` for a short summary.

| Option | Default | Meaning |
| --- | --- | --- |
| `--bar-width N` | `10` | Number of cells in each bar |
| `--refresh-seconds N` | `300` | How long the per-model cache stays fresh |
| `--model-key KEY` | `fable` | Which per-model weekly bucket to track, matched by name |
| `--model-label TEXT` | `Fable` | Label for the per-model bar |
| `--ctx-label TEXT` | `Context win` | Label for the context bar |
| `--five-hour-label TEXT` | `5H Limit` | Label for the 5-hour bar |
| `--week-label TEXT` | `Weekly` | Label for the weekly bar |
| `--theme NAME` | `default` | `default`, `minimal` or `mono` |
| `--icons NAME` | `unicode` | `unicode`, `nerd` or `none` |
| `--ascii` | off | Replace the glyphs the tool draws with plain ASCII |
| `--align left\|right` | `left` in `statusline.js`, `right` from the installer | Alignment of the lines |
| `--width N` | auto | Fixed terminal width, for when detection fails |
| `--right-margin N` | `2` | Columns kept free at the right edge |
| `--no-model` | off | Hide the model name |
| `--no-folder` | off | Hide the folder and branch |
| `--no-cost` | off | Hide the session cost |
| `--dump-input` | off | Save the last payload Claude Code sent, for debugging |

### Themes

* `default`: full labels, colored bars with a smooth gradient.
* `minimal`: symbols instead of long labels and shorter bars, for narrow terminals. It is also used automatically when nothing else fits.
* `mono`: no color at all. Setting the `NO_COLOR` environment variable has the same effect.

Color depth follows the terminal: 24-bit when `COLORTERM` reports it, 256 colors otherwise when `TERM` allows it, and 16 colors as the fallback.

### Icons

* `unicode`: symbols that common fonts carry.
* `nerd`: Nerd Font glyphs. Needs a Nerd Font in the terminal.
* `none`: no symbols.

`--ascii` replaces the glyphs the tool draws: bars, icons, separators, arrows and the ellipsis. Text that comes from your data, such as folder, branch and model names, is shown as is.

## Layout

The tool uses two lines when the terminal is wide enough and a third line when it is not. It never prints more than three. The model name and cost sit at the end of the first bar line, and the folder at the end of the second. On three lines they move to their own line on top.

If a line still does not fit, it is shortened in this order:

1. Truncate the folder name.
2. Drop the bracketed suffix of the model name.
3. Drop the reset times.
4. Switch to the compact layout.
5. Truncate each line.

Whatever is done to one bar line is done to the other, so the columns stay aligned.

The available width is the terminal width minus `--right-margin`. Width comes from `--width`, then the output streams, `COLUMNS`, and finally the controlling terminal. If none of them gives a value, the tool uses two lines aligned left. Pass `--width` to force a value.

With `--align right`, the bar lines are aligned as a block. Their columns stay aligned with each other, so a shorter bar line may end before the right edge.

## How it works

Claude Code runs the configured command after every turn and pipes a JSON payload to stdin. The script reads the context fill, the 5-hour and weekly limits, the model, the folder and the cost from it. The git branch is read from `.git/HEAD` by walking up from the folder, so no git process is started. A detached HEAD shows a short hash.

The per-model weekly figure is not part of that payload. For it, the script uses the usage endpoint that the `/usage` command uses, `https://api.anthropic.com/api/oauth/usage`, with the OAuth token Claude Code already holds. That endpoint is undocumented and may change. When it or the token is unavailable, the per-model segment is dropped and the rest keeps working.

The render never waits on the network. It reads the cache file `~/.claude/quota-line-cache.json`. When the cache is older than `--refresh-seconds`, a detached background process fetches new data and rewrites it. A lock file keeps two refreshes from running at once, and a failed fetch backs off instead of retrying on every render.

Where the token comes from:

* Windows and Linux: `~/.claude/.credentials.json`.
* macOS: the Keychain, service `Claude Code-credentials`. The first time a refresh runs, macOS may show a permission prompt. Allow it so the per-model figure can update.

Set `CLAUDE_CONFIG_DIR` to use a folder other than `~/.claude`. It applies to every path: settings, credentials, cache, lock file, debug file and the install folder.

Right after `/clear` you may see the line `quota: waiting for first response` until the first reply arrives.

### Debugging

Add `--dump-input` to the command to write the last payload Claude Code sent to `~/.claude/quota-line-last-input.json`.

## Test

```
npm test
```

This runs `node --test`. There are no dependencies. A GitHub Actions workflow runs the tests on Ubuntu, Windows and macOS with Node 18 and the current LTS.

## Legacy PowerShell version

The original PowerShell version is kept in `legacy/powershell/`. It is no longer updated.

`quota.json` is a sample of the `statusLine` block the installer writes. The path in it is a placeholder.

## License

MIT

---

# claude-quota-line

שורת סטטוס לקלוד קוד שמציגה את אותם המספרים שמופיעים בחלון השימוש באתר, בתוך הטרמינל, כל הזמן. היא מציגה גם את המודל הנוכחי, את התיקייה, את הענף של גיט ואת עלות הסשן. היא רצה בחלונות, במק ובלינוקס.

טרמינל רחב, שתי שורות:

```
◔ Context win ██▎░░░░░░░  22%             │ ◷ 5H Limit    █▏░░░░░░░░  11% ↻ 4h48m     │ ✦ Opus 5 (1M context) │ $3.75
▦ Weekly      ██▊░░░░░░░  28% ↻ Thu 12:59 │ ◆ Fable       ████▌░░░░░  45% ↻ Thu 12:59 │ ⌂ Display_CLI_Usege ⎇ main
```

טרמינל צר יותר, שלוש שורות:

```
✦ Opus 5 (1M context) │ ⌂ Display_CLI_Usege ⎇ main │ $3.75
◔ Context win ██▎░░░░░░░  22%             │ ◷ 5H Limit    █▏░░░░░░░░  11% ↻ 4h48m
▦ Weekly      ██▊░░░░░░░  28% ↻ Thu 12:59 │ ◆ Fable       ████▌░░░░░  45% ↻ Thu 12:59
```

הפסים עוברים מירוק לצהוב ולאדום ככל שהם מתמלאים, והם אדומים מ 80 אחוז ומעלה.

## מה מוצג

* חלון ההקשר של הסשן הנוכחי.
* מגבלת חמש השעות והזמן שנותר עד האיפוס.
* המגבלה השבועית לכל המודלים, עם יום ושעת האיפוס.
* המגבלה השבועית למודל אחד לבחירה.
* שם המודל שבשימוש.
* התיקייה הנוכחית והענף של גיט.
* עלות הסשן.

קטע שאין עבורו נתונים לא מוצג. התוויות מרופדות לרוחב התווית הארוכה ביותר, כך שהפסים מתיישרים.

עלות הסשן במנוי Pro או Max היא הערכה שקלוד קוד מחשב. היא לא חיוב.

## דרישות

* Node.js בגרסה 18 ומעלה, בלי חבילות להתקין.
* קלוד קוד בגרסה 2.1.6 ומעלה.
* מנוי Pro או Max. נתוני המגבלות לא נשלחים בסשן שעובד עם מפתח API.

## התקנה

```
git clone https://github.com/www8351/Display_CLI_Usege
cd Display_CLI_Usege
node install.js
```

אחרי ההתקנה יש להפעיל מחדש את קלוד קוד.

ההתקנה מעתיקה את הסקריפט לתיקייה `~/.claude/quota-line/`, מגבה את קובץ ההגדרות ומעדכנת בו מפתח אחד בלבד, `statusLine`. שאר הקובץ לא משתנה. ההתקנה מדפיסה את תיקיית ההגדרות שבה השתמשה ואת הפקודה הסופית.

כל אפשרות מהטבלה שלמטה אפשר להעביר להתקנה, והיא נכתבת לתוך הפקודה:

```
node install.js --model-key opus --model-label Opus
node install.js --theme minimal --icons none
node install.js --align left
node install.js --bar-width 16
```

להסרה מלאה:

```
node install.js --uninstall
```

ההסרה מוחקת את המפתח `statusLine` רק אם הוא מצביע על הכלי הזה. היא מוחקת גם את תיקיית ההתקנה, את המטמון ואת קבצי האבחון.

מי שהשתמש בגרסת הפאורשל הישנה לא צריך לעשות דבר מיוחד. ההתקנה מחליפה את הרישום הישן, מוחקת את העותק הישן של הסקריפט ומעבירה הלאה את האפשרויות שהיא מזהה. אפשרויות שמועברות להתקנה גוברות על אלה שהועברו מהגרסה הישנה.

## אפשרויות

אותן אפשרויות עובדות בהתקנה ובסקריפט עצמו. ההתקנה כותבת רק את מה ששונה מברירת המחדל, ותכתוב `--align right` אלא אם ביקשתם אחרת. הפקודה הבאה מציגה סיכום קצר:

```
node install.js --help
```

| אפשרות | ברירת מחדל | משמעות |
| --- | --- | --- |
| `--bar-width N` | `10` | מספר התאים בכל פס |
| `--refresh-seconds N` | `300` | כמה זמן המטמון של המודל נשאר טרי |
| `--model-key KEY` | `fable` | איזה פס שבועי של מודל לעקוב אחריו, לפי שם |
| `--model-label TEXT` | `Fable` | תווית הפס של המודל |
| `--ctx-label TEXT` | `Context win` | תווית פס ההקשר |
| `--five-hour-label TEXT` | `5H Limit` | תווית פס חמש השעות |
| `--week-label TEXT` | `Weekly` | תווית הפס השבועי |
| `--theme NAME` | `default` | `default`, `minimal` או `mono` |
| `--icons NAME` | `unicode` | `unicode`, `nerd` או `none` |
| `--ascii` | כבוי | מחליף את הסימנים שהכלי מצייר בתווי אסקי פשוטים |
| `--align left\|right` | `left` בסקריפט, `right` מההתקנה | יישור השורות |
| `--width N` | אוטומטי | רוחב טרמינל קבוע, למקרה שהזיהוי נכשל |
| `--right-margin N` | `2` | עמודות שנשארות פנויות בקצה הימני |
| `--no-model` | כבוי | מסתיר את שם המודל |
| `--no-folder` | כבוי | מסתיר את התיקייה והענף |
| `--no-cost` | כבוי | מסתיר את עלות הסשן |
| `--dump-input` | כבוי | שומר את הקלט האחרון שקלוד קוד שלח, לצורך אבחון |

### ערכות נושא

* `default`: תוויות מלאות ופסים צבעוניים עם מעבר צבע רציף.
* `minimal`: סמלים במקום תוויות ארוכות ופסים קצרים יותר, לטרמינלים צרים. המצב הזה מופעל גם אוטומטית כשום דבר אחר לא מספיק.
* `mono`: בלי צבע בכלל. הגדרת משתנה הסביבה `NO_COLOR` נותנת אותה תוצאה.

עומק הצבע נקבע לפי הטרמינל. צבע של 24 סיביות כשהטרמינל מדווח עליו, 256 צבעים כשהוא מאפשר זאת, ו 16 צבעים כברירת מחדל.

### סמלים

* `unicode`: סמלים שנמצאים ברוב הגופנים.
* `nerd`: סמלים של גופני נרד. נדרש גופן כזה בטרמינל.
* `none`: בלי סמלים.

האפשרות `--ascii` מחליפה את מה שהכלי מצייר: פסים, סמלים, מפרידים, חצים ושלוש הנקודות. טקסט שמגיע מהנתונים שלכם, כמו שם תיקייה, ענף ומודל, מוצג כמו שהוא.

## פריסה

הכלי משתמש בשתי שורות כשהטרמינל רחב מספיק, ובשורה שלישית כשהוא לא. הוא אף פעם לא מדפיס יותר משלוש. שם המודל והעלות נמצאים בסוף שורת הפסים הראשונה, והתיקייה בסוף השנייה. בשלוש שורות הם עוברים לשורה נפרדת למעלה.

אם שורה עדיין לא נכנסת, היא מתקצרת לפי הסדר הזה:

1. קיצור שם התיקייה.
2. הסרת הסיומת שבסוגריים משם המודל.
3. הסרת זמני האיפוס.
4. מעבר לפריסה הקומפקטית.
5. חיתוך כל שורה.

כל קיצור שחל על שורת פסים אחת חל גם על השנייה, כך שהעמודות נשארות מיושרות.

הרוחב הזמין הוא רוחב הטרמינל פחות `--right-margin`. הרוחב נלקח מ `--width`, אחר כך מזרמי הפלט, מהמשתנה `COLUMNS` ולבסוף מהטרמינל עצמו. אם אף אחד מהם לא נותן ערך, הכלי משתמש בשתי שורות מיושרות לשמאל. אפשר לכפות ערך עם `--width`.

עם `--align right` שורות הפסים מיושרות כמקשה אחת. העמודות שלהן נשארות מיושרות זו מול זו, ולכן שורת פסים קצרה יותר עשויה להסתיים לפני הקצה הימני.

## איך זה עובד

קלוד קוד מריץ את הפקודה המוגדרת אחרי כל תור ומעביר לה JSON דרך הקלט הסטנדרטי. הסקריפט קורא משם את מילוי ההקשר, את מגבלות חמש השעות והשבוע, את המודל, את התיקייה ואת העלות. הענף של גיט נקרא מהקובץ `.git/HEAD` בעלייה במעלה התיקיות, ולכן לא מופעל תהליך גיט. כשהראש מנותק מוצג גיבוב קצר.

הנתון השבועי למודל בודד לא נמצא באותו JSON. בשבילו הסקריפט פונה לאותה נקודת קצה שבה משתמשת הפקודה `/usage`, עם הטוקן שקלוד קוד כבר מחזיק. נקודת הקצה הזו לא מתועדת ועלולה להשתנות. אם היא או הטוקן לא זמינים, החלק של המודל פשוט לא מוצג והשאר ממשיך לעבוד.

ההצגה אף פעם לא ממתינה לרשת. היא קוראת את קובץ המטמון. כשהמטמון ישן מהערך של `--refresh-seconds`, תהליך רקע נפרד מביא נתונים חדשים וכותב אותם. קובץ נעילה מונע שני רענונים במקביל, וכשל בהבאה גורם להמתנה במקום ניסיון חוזר בכל הצגה.

המטמון נשמר בקובץ הבא:

`~/.claude/quota-line-cache.json`

מקום הטוקן:

* בחלונות ובלינוקס: הקובץ `~/.claude/.credentials.json`.
* במק: מחזיקת המפתחות, בשירות `Claude Code-credentials`. בפעם הראשונה שרענון רץ, מק עשוי להציג בקשת הרשאה. יש לאשר אותה כדי שהנתון של המודל יתעדכן.

כדי להשתמש בתיקייה אחרת מ `~/.claude` מגדירים את משתנה הסביבה `CLAUDE_CONFIG_DIR`. הוא חל על כל הנתיבים: ההגדרות, ההרשאות, המטמון, קובץ הנעילה, קובץ האבחון ותיקיית ההתקנה.

מיד אחרי `/clear` ייתכן שתופיע שורת המתנה עד שתגיע התשובה הראשונה.

### אבחון

כדי לראות מה קלוד קוד שולח בפועל, מוסיפים לפקודה `--dump-input`. הקלט האחרון נכתב לקובץ הבא:

`~/.claude/quota-line-last-input.json`

## בדיקה

```
npm test
```

הפקודה מריצה את `node --test`, בלי תלויות. תהליך אוטומטי בגיטהאב מריץ את הבדיקות באובונטו, בחלונות ובמק, עם Node 18 ועם גרסת התמיכה הארוכה העדכנית.

## גרסת פאורשל ישנה

גרסת הפאורשל המקורית נשמרת בתיקייה הבאה ולא מתעדכנת יותר:

`legacy/powershell/`

הקובץ `quota.json` הוא דוגמה לבלוק `statusLine` שההתקנה כותבת. הנתיב שבו הוא מציין מקום.

## רישיון

MIT
