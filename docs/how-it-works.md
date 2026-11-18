# How it works

```
claude session ──hook event──▶ claude-status-hook ──writes──▶ ~/.cache/claude-status/<id>.json
                                                                      │ inotify
                                       GNOME Shell extension ◀────────┘  + periodic /proc sweep
```

## The hook (`bin/claude-status-hook`)

Claude Code runs the hook on each event and passes the event as JSON on stdin. The hook maps the event
to a state:

| Event | State |
|-------|-------|
| `SessionStart` | idle |
| `UserPromptSubmit`, `PostToolUse` | working |
| `Notification` (permission prompt / question) | waiting |
| `StopFailure` with `error: rate_limit` | limited |
| `Stop` | done |
| `SessionEnd` | file removed |

It writes `~/.cache/claude-status/<session id>.json` atomically (it writes to a temporary file, then
renames it). The file contains the account id (see [accounts.md](accounts.md)), the state, the project
(the working directory's name), the waiting message, and the pid and start time of the `claude`
process. The hook finds that process by walking up its own parent processes.

## The extension (`extension.js`)

- **Watching.** A `Gio.FileMonitor` on the status directory triggers a refresh, so a state change
  appears as soon as the hook writes it. Bursts of events are combined into one refresh (100 ms).
- **Sweep.** On a timer (Settings → Background check interval), the extension also checks what no hook
  reports:
  - A session whose process no longer exists has crashed or been killed. The extension deletes its file.
    The pid's start time is checked too, because pids get reused.
  - A done or idle session that still has a Monitor script running shows as *monitor* (purple). If it has
    a background Bash command, it shows as *shell* (blue). The extension finds these by looking for
    `shell-snapshots` child processes of `claude` in `/proc`. A Monitor's stdout is a socket.
- **Lights.** Each account's light shows the most urgent state among its unmuted sessions. From most to
  least urgent: limited, waiting, working, monitor, shell, done, idle.
- **Raising a terminal.** Clicking a session walks up from the `claude` process to the first ancestor
  that owns a window. If a terminal process owns several windows, `WINDOWID` picks the right one. For a
  background session, the extension asks `claude agents --json` for the job id. It then raises a
  terminal already running `claude attach <id>`, or opens a new one.
- **Muting.** Muting a session creates an empty file, `~/.cache/claude-status/muted/<session id>`.

## Files

| Path | Purpose |
|------|---------|
| `extension.js` | top-bar indicator and menu |
| `prefs.js` | settings window (GTK 4 + libadwaita) |
| `schemas/` | GSettings schema |
| `stylesheet.css` | light colours |
| `bin/claude-status-hook` | the Claude Code hook |
| `install.sh` | installer |
