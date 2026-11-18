# Claude Sessions (GNOME Shell extension)

Top-bar lights for every Claude Code session on this computer, grouped by account (one light per
`CLAUDE_CONFIG_DIR`). Click a session in the menu to raise its terminal; background sessions
(`claude --bg`) are raised in a terminal attached to them, or a new one running `claude attach <id>`.

| Light  | State |
|--------|-------|
| red, outlined | hit its usage limit (the turn stopped on a rate limit) |
| red (pulsing) | needs you (permission prompt / question) |
| amber  | working |
| purple | turn ended, a Monitor script is still running |
| blue   | turn ended, a background Bash command is still running |
| green  | done |
| grey   | idle |

GNOME Shell 42 (legacy `imports.*`), tested on Pop!_OS 22.04 / X11.

## How it works

`bin/claude-status-hook` is a Claude Code hook that writes `~/.cache/claude-status/<session_id>.json` on
SessionStart, UserPromptSubmit, PostToolUse, Stop, StopFailure, Notification and SessionEnd. The extension watches that
directory (inotify via `Gio.FileMonitor`), so a state change shows as soon as the hook runs. A slower sweep
(Settings → Background check interval) catches what no hook reports: crashed sessions and running
Monitor scripts / background shells, read from `/proc`.

## How accounts are told apart

Claude Code keeps each account's login, settings and history in a config directory: `~/.claude` by
default, or whatever `CLAUDE_CONFIG_DIR` points to. Running several accounts means giving each its own
directory, e.g. an alias per account:

```sh
alias claude-work='CLAUDE_CONFIG_DIR=~/.claude-work claude'
alias claude-personal='CLAUDE_CONFIG_DIR=~/.claude-personal claude'
```

The hook runs inside the session, so it inherits `CLAUDE_CONFIG_DIR` and turns the directory's name into
the account id: `~/.claude-work` → `work`, `~/.claude-personal` → `personal`, `~/.claude` (variable unset)
→ `default`. That id goes into the status file, and the extension groups sessions by it. For this to work:

- name each config directory `~/.claude-<id>` (the extension also uses that name to find the account
  when it opens `claude attach` for a background session);
- wire the hook into **each** account's `settings.json` — an account without it never reports sessions;
- keep the variable set for the whole session (launch `claude` with it, not just export it afterwards).

In Settings → Accounts you can give each id a display name and change the order of the accounts in the
top bar and the menu. That list shows every `~/.claude` / `~/.claude-*` directory, plus any account a
running session reports. Renaming only changes the label: the id stays the directory name.

## Install

```sh
git clone <this repo> ~/src/gnome-claude-sessions
ln -s ~/src/gnome-claude-sessions ~/.local/share/gnome-shell/extensions/claude-sessions@dhia.local
ln -s ~/src/gnome-claude-sessions/bin/claude-status-hook ~/.local/bin/claude-status-hook
glib-compile-schemas ~/src/gnome-claude-sessions/schemas
```

Needs `jq`. In each account's `settings.json` (`~/.claude/settings.json`, or `$CLAUDE_CONFIG_DIR/settings.json`),
run the hook for every event above, e.g.:

```json
"hooks": {
  "Stop": [{ "hooks": [{ "type": "command", "command": "~/.local/bin/claude-status-hook" }] }]
}
```

(for `Notification`, add `"matcher": "permission_prompt|elicitation_dialog"` so idle reminders are skipped;
for `StopFailure`, add `"matcher": "rate_limit"` so only usage limits turn the light red).
Then restart GNOME Shell (X11: Alt+F2, `r`) and enable it with `gnome-extensions enable claude-sessions@dhia.local`.
