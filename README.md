# status-band

A Claude Code mod that draws a two-line status band above the prompt in the
**Claude desktop app (Code tab)**. It mirrors a terminal status line for the desktop,
where a `statusLine` command doesn't show.

```
user@host:~/projects/my-app                     ctx:9% 5h:10% 2h49m (♥ 43%) / 7d:73% 1d3h (♥ 84%)
(main*) [Opus 5.5/Medium]
```

- **Line 1, left:** `user@host:` and the git repo root (with `~` for `$HOME`, or `%USERPROFILE%` on Windows).
  Outside a git repo it shows the session's project root.
- **Line 1, right:** context window used, then the 5-hour and 7-day quotas.
- **Line 2:** git branch (`*` when the tree is dirty), then model and effort level.

### Quota colours

Each quota shows `used% time-left (♥/⚠ expected%)`. "Expected" is how much of
the quota you'd have used by now at an even pace through the window.

- **Green ♥:** at or under the expected pace.
- **Red ⚠:** ahead of the expected pace.
- With no reset time from the API, the colour is based on what's left:
  green above 50%, yellow from 25–50%, red below 25%.

### Where it draws

Only on the `desktop` surface. In the terminal CLI, VS Code and mobile the hook
passes through, so the existing status line is the only thing there. The band
also steps aside while a survey holds that slot.

## Requirements

- Claude Code with mod (hooks module) support. Built and validated on 2.1.293.
- `git` on the `PATH` of the machine Claude Code runs on, and `hostname` on
  macOS/Linux (on Windows the host comes from `COMPUTERNAME`).
- Quotas appear only for accounts whose usage reports `five_hour` / `seven_day`
  rate limits.

## Install

At the prompt of a terminal Claude Code session:

```
/plugin install status-band --marketplace kanine/claude-status-band
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in
every session, including the desktop app's local sessions).

From a shell:

```bash
claude plugin install status-band --marketplace kanine/claude-status-band
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt
box, then **Plugins**, **Add marketplace** with `kanine/claude-status-band`,
then **Add plugin**.

### From a local folder

Alternatively, clone this repository somewhere stable and load it from there.

#### Every session, from the folder

Add to the `env` block of `~/.claude/settings.json` (user settings; project
settings are ignored for this):

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/absolute/path/to/status-band"
  }
}
```

- `CLAUDE_CODE_PLUGIN_DIRS` loads the mod in every session, desktop and CLI.
  Separate several folders with `:` (`;` on Windows).

#### Windows

User settings live at `%USERPROFILE%\.claude\settings.json`. Use a full Windows
path, escaping backslashes in JSON (or use forward slashes), and `;` between
folders:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "C:\\Users\\you\\claude-status-band;D:\\other-mod"
  }
}
```

On Windows the band uses `USERNAME` for the user, `COMPUTERNAME` for the host
and `USERPROFILE` for `~`, and shows paths with forward slashes.

Start a new session after changing settings.

#### Live reload (development only)

`CLAUDE_CODE_PLUGIN_DIR_WATCH=1` makes desktop sessions reload the mod when its
files are saved. Without it, a desktop session keeps the code it started with
until you open a new session. It is only useful while actively editing the mod,
so it is **off by default** and not part of the recommended setup.

**Ask the user before adding it.** Don't enable it on your own, and don't assume
a previous choice still applies: confirm whether they want live reload now
(typically only while developing), and remove it again when they're done. To
enable it, add it next to `CLAUDE_CODE_PLUGIN_DIRS` in the same `env` block:

```json
"CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"
```

#### One terminal session

```bash
claude --plugin-dir /absolute/path/to/status-band
```

The band is desktop-only, so this draws nothing in the terminal. It's only
useful for checking that the module loads.

## Developing

- Edit `hooks/register.tsx`. With the watch flag set (dev-only; see "Live
  reload" above, and confirm with the user first), saves reload the module in
  open desktop sessions; without it, open a new session to pick up changes.
  Values in `$.state` survive a reload; module variables start over.
- Validate after each change. `claude` may not be on the WSL `PATH`; the desktop
  app's bundled CLI works too (`~/.claude/remote/ccd-cli/<version>`):

  ```bash
  claude plugin validate /absolute/path/to/status-band
  ```

- Don't also load it through hot reloading (`~/.claude/dev-mods/<session>/`)
  when `CLAUDE_CODE_PLUGIN_DIRS` already names it. The mod then loads twice,
  and the stale copy can be the one that draws.
- On desktop, put inline pieces inside one `<Text>`. Sibling `<Text>` elements
  directly in a `<Box>` lay out as separate columns there, not as one line.
- Use `$.session.root()`, not `$.session.cwd()`, for the path. The cwd follows
  any shell `cd` during the session.

## Files

| Path | Purpose |
| --- | --- |
| `.claude-plugin/plugin.json` | Manifest: name, version, path to the state contract |
| `.claude-plugin/marketplace.json` | Makes this repository a marketplace for `/plugin install` |
| `hooks/hooks.json` | Names the hooks module |
| `hooks/register.tsx` | The hooks: refresh on session start, each turn and every 60s; draw `AbovePrompt` |
| `types/index.d.ts` | Contract for the `status-band.info` value kept in `$.state` |
| `tsconfig.json` | Type-checking; extends the generated `.claude-plugin/types/tsconfig.json` |

`.claude-plugin/types/` is generated by Claude Code on each load and is
gitignored.
