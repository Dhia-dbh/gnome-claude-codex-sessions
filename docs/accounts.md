# Accounts: how they are detected

Claude Code stores each account's login, settings and history in a **config directory**: `~/.claude`
by default, or the directory named by the `CLAUDE_CONFIG_DIR` environment variable. Running more than
one account on a computer means giving each its own directory, usually with an alias:

```sh
alias claude-work='CLAUDE_CONFIG_DIR=~/.claude-work claude'
alias claude-personal='CLAUDE_CONFIG_DIR=~/.claude-personal claude'
```

## From config directory to account

`claude-status-hook` runs inside each session, so it inherits that session's `CLAUDE_CONFIG_DIR`. It
turns the directory's name into an **account id**:

| `CLAUDE_CONFIG_DIR` | Account id |
|---------------------|------------|
| not set (`~/.claude`) | `default` |
| `~/.claude-work` | `work` |
| `~/.claude-personal` | `personal` |
| `/any/path/.claude-foo` | `foo` |

The rule: take the directory's base name, then remove a leading `.claude` and a leading `-`. If nothing
is left, the id is `default`.

The id is written into the session's status file (`~/.cache/claude-status/<session id>.json`). The
extension groups sessions by it, with one light and one menu section per account.

The id is also used in the other direction. To open a terminal for a background session whose process
it can't read, the extension uses `~/.claude-<id>` (or `~/.claude` for `default`) as that session's
config directory.

## What you need to do

- **Name each config directory `~/.claude-<name>`.** Other names still work for grouping, but opening
  background sessions expects this layout.
- **Add the hook to every account's `settings.json`.** Each account reads its own settings, so an
  account without the hook never reports its sessions. `install.sh` handles this for every `~/.claude*`
  directory.
- **Start `claude` with the variable already set** (an alias, or `CLAUDE_CONFIG_DIR=… claude`). The
  hook only sees the environment the session started with.

## Codex

Codex keeps each account in a **Codex home**: `~/.codex` by default, or the directory named by
`CODEX_HOME`. The same rule applies, with `.codex` in place of `.claude`:

| `CODEX_HOME` | Account id |
|--------------|------------|
| not set (`~/.codex`) | `default` |
| `~/.codex-work` | `work` |

```sh
alias codex-work='CODEX_HOME=~/.codex-work codex'
```

Codex and Claude accounts are kept apart: a Codex `work` account and a Claude `work` account get
separate lights and separate menu sections. Put the hook in each Codex home's `hooks.json`
(`install.sh` does this) and trust it once with `/hooks` in Codex.

## Display names and order

The id is fixed, but what you see isn't: **Settings → Claude Code accounts** and **Codex accounts** let
you give each account a display name and move accounts up or down within their agent. The order is used in both the top bar and the menu. Accounts that
aren't in the saved order yet come last, alphabetically.

The lists include every `~/.claude`, `~/.claude-*`, `~/.codex` and `~/.codex-*` directory, plus any account a
running session reports. The names are stored in the `account-names` setting and the order in
`account-order`, both keyed by account id: `work` for a Claude account, `codex:work` for a Codex one.
