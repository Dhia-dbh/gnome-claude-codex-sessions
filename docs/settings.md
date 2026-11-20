# Settings

Open the settings from the indicator menu (**Settings…**) or with
`gnome-extensions prefs claude-sessions@dhia.local`. Changes apply immediately.

| Group | Option | Default | What it does |
|-------|--------|---------|--------------|
| Sessions | Show idle sessions | off | Show sessions that haven't run a turn since they started |
| Sessions | Show finished sessions | on | Show sessions whose last turn has ended |
| Top bar | Show the agent marks | on | ✳ (Claude Code) or `>_` (Codex) before each agent's lights. Always shown when there are no sessions, so the menu stays reachable, and when both agents have sessions, so their lights can be told apart |
| Top bar | Show account names | on | Each account's name next to its light |
| Top bar | Pulse when a session needs you | on | Animate the light of an account with a waiting session |
| Top bar | Show usage limits | on | Moon disks for each account's shortest and longest limit (5h, weekly) after its light. See [how-it-works.md](how-it-works.md#usage-limits) |
| Top bar | Hide when there are no sessions to show | off | Remove the indicator entirely when empty |
| Top bar | Position | Right | Left, center or right part of the top bar |
| Menu | Show what a waiting session is asking | on | The prompt text under a waiting session |
| Claude Code accounts, Codex accounts | name / ↑ ↓ | — | Display name and order of each account ([accounts.md](accounts.md)) |
| Advanced | Background check interval | 10 s | How often to check for crashed sessions, Monitor scripts and background shells |
| Advanced | Codex limits check interval | 120 s | How often to ask Codex for the usage limits of accounts with a working session. Idle accounts are not asked; an account is asked once more when it stops working |

Hidden sessions are counted in the menu ("2 hidden sessions"), so they aren't lost.

All options are GSettings keys under `org.gnome.shell.extensions.claude-sessions`, and can also be set
from a script:

```sh
schemas=~/.local/share/gnome-shell/extensions/claude-sessions@dhia.local/schemas
gsettings --schemadir $schemas set org.gnome.shell.extensions.claude-sessions account-order "['work', 'personal']"
gsettings --schemadir $schemas set org.gnome.shell.extensions.claude-sessions account-names "{'work': 'Company', 'codex:work': 'Company'}"
```
