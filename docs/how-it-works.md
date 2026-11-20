# How it works

```
claude / codex session ──hook event──▶ claude-status-hook ──writes──▶ ~/.cache/claude-status/<id>.json
                                                                      │ inotify
                                       GNOME Shell extension ◀────────┘  + periodic /proc sweep
```

## The hook (`bin/claude-status-hook`)

Claude Code and Codex run the hook on each event and pass the event as JSON on stdin. Codex runs it as
`claude-status-hook --agent codex`. The hook maps the event to a state:

| Claude Code event | Codex event | State |
|-------------------|-------------|-------|
| `SessionStart` | `SessionStart` | idle |
| `UserPromptSubmit`, `PostToolUse` | `UserPromptSubmit`, `PostToolUse` | working |
| `Notification` (permission prompt / question) | `PermissionRequest` | waiting |
| `StopFailure` with `error: rate_limit` | — | limited |
| `Stop` | `Stop` | done |
| — | `Interrupt` | idle |
| `SessionEnd` | `SessionEnd` | file removed |

Codex has no usage-limit hook, so a Codex light never shows *limited*. For a Codex session, the waiting
message is the approval reason or the command it wants to run.

It writes `~/.cache/claude-status/<session id>.json` atomically (it writes to a temporary file, then
renames it). The file contains the agent (`claude` or `codex`; a file without it is Claude's), the
account id (see [accounts.md](accounts.md)), the state, the project (the working directory's name), the
waiting message, and the pid and start time of the `claude` or `codex` process. The hook finds that
process by walking up its own parent processes.

## The extension (`extension.js`)

- **Watching.** A `Gio.FileMonitor` on the status directory triggers a refresh, so a state change
  appears as soon as the hook writes it. Bursts of events are combined into one refresh (100 ms).
- **Sweep.** On a timer (Settings → Background check interval), the extension also checks what no hook
  reports:
  - A session whose process no longer exists has crashed or been killed. The extension deletes its file.
    The pid's start time is checked too, because pids get reused.
  - A done or idle Claude session that still has a Monitor script running shows as *monitor* (purple). If it has
    a background Bash command, it shows as *shell* (blue). The extension finds these by looking for
    `shell-snapshots` child processes of `claude` in `/proc`. A Monitor's stdout is a socket.
- **Lights.** Each account's light shows the most urgent state among its unmuted sessions. From most to
  least urgent: limited, waiting, working, monitor, shell, done, idle. The top bar shows one group per
  agent with sessions: its mark (✳ Claude Code, `>_` Codex), then its accounts' lights. The menu has one
  section per agent, each with its accounts and their sessions.
- **Raising a terminal.** Clicking a session walks up from the `claude` process to the first ancestor
  that owns a window. If a terminal process owns several windows, `WINDOWID` picks the right one. For a
  background Claude session, the extension asks `claude agents --json` for the job id. It then raises a
  terminal already running `claude attach <id>`, or opens a new one.
- **Muting.** Muting a session creates an empty file, `~/.cache/claude-status/muted/<session id>`.

## Files

| Path | Purpose |
|------|---------|
| `extension.js` | top-bar indicator and menu |
| `prefs.js` | settings window (GTK 4 + libadwaita) |
| `schemas/` | GSettings schema |
| `stylesheet.css` | light colours |
| `bin/claude-status-hook` | the Claude Code and Codex hook |
| `install.sh` | installer |
