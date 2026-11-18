# Installation

## With the script

```sh
git clone https://github.com/Dhia-dbh/gnome-claude-sessions.git ~/src/gnome-claude-sessions
cd ~/src/gnome-claude-sessions
./install.sh                      # every ~/.claude and ~/.claude-* account
./install.sh ~/.claude-work       # or only the config dirs you name
```

The script:

1. links the checkout to `~/.local/share/gnome-shell/extensions/claude-sessions@dhia.local`;
2. links `bin/claude-status-hook` to `~/.local/bin/claude-status-hook`;
3. compiles `schemas/`;
4. adds the hook to each account's `settings.json`. Any earlier entries for the hook are replaced, so
   running it again is safe. Your other hooks are not changed.

Restart GNOME Shell (X11: <kbd>Alt</kbd>+<kbd>F2</kbd>, `r`, <kbd>Enter</kbd>; Wayland: log out and
back in), then enable the extension:

```sh
gnome-extensions enable claude-sessions@dhia.local
```

If GNOME has not seen the extension yet, `gnome-extensions enable` fails. Restart the shell first.

Sessions that were already running read their `settings.json` at start, so restart them to pick up
the hooks.

## From a release zip

Download `claude-sessions@dhia.local.shell-extension.zip` from the
[releases page](https://github.com/Dhia-dbh/gnome-claude-sessions/releases), then:

```sh
gnome-extensions install claude-sessions@dhia.local.shell-extension.zip
bash ~/.local/share/gnome-shell/extensions/claude-sessions@dhia.local/install.sh
```

The second command links the hook and wires it into your accounts. Then restart GNOME Shell and enable
the extension as above.

## Manually

```sh
ln -s ~/src/gnome-claude-sessions ~/.local/share/gnome-shell/extensions/claude-sessions@dhia.local
ln -s ~/src/gnome-claude-sessions/bin/claude-status-hook ~/.local/bin/claude-status-hook
glib-compile-schemas ~/src/gnome-claude-sessions/schemas
```

Then add the hook to the `settings.json` of each account (`~/.claude/settings.json`, or
`$CLAUDE_CONFIG_DIR/settings.json`):

```json
{
  "hooks": {
    "SessionStart":     [{ "hooks": [{ "type": "command", "command": "~/.local/bin/claude-status-hook" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "~/.local/bin/claude-status-hook" }] }],
    "PostToolUse":      [{ "hooks": [{ "type": "command", "command": "~/.local/bin/claude-status-hook" }] }],
    "Stop":             [{ "hooks": [{ "type": "command", "command": "~/.local/bin/claude-status-hook" }] }],
    "SessionEnd":       [{ "hooks": [{ "type": "command", "command": "~/.local/bin/claude-status-hook" }] }],
    "Notification": [{ "matcher": "permission_prompt|elicitation_dialog",
                       "hooks": [{ "type": "command", "command": "~/.local/bin/claude-status-hook" }] }],
    "StopFailure":  [{ "matcher": "rate_limit",
                       "hooks": [{ "type": "command", "command": "~/.local/bin/claude-status-hook" }] }]
  }
}
```

The `Notification` matcher skips the "still waiting" reminders. The `StopFailure` matcher limits the red
usage-limit light to rate limits, so it doesn't fire on other API errors.

## Uninstall

```sh
gnome-extensions disable claude-sessions@dhia.local
rm ~/.local/share/gnome-shell/extensions/claude-sessions@dhia.local ~/.local/bin/claude-status-hook
rm -rf ~/.cache/claude-status
```

Then remove the `claude-status-hook` entries from each account's `settings.json`.

## Troubleshooting

- **No sessions show up.** Check that `~/.cache/claude-status/` gets a `<session id>.json` file when
  you send a prompt. If it doesn't, the hook isn't wired into that account, or `jq` is missing.
- **An account is missing or called "default".** The session was started without `CLAUDE_CONFIG_DIR`.
  See [accounts.md](accounts.md).
- **The light stays red after a usage limit.** It clears on the session's next prompt.
- **Logs:** `journalctl --user -f /usr/bin/gnome-shell` shows extension errors.

## Releasing (maintainers)

Set `version-name` in `metadata.json` (and raise the integer `version`), commit to `main`, then tag and
push:

```sh
git tag v1.1.0 && git push origin main v1.1.0
```

The Release workflow (`.github/workflows/release.yml`) checks that the tag is on `main` and matches
`version-name`, builds the extension zip and publishes the GitHub release.
