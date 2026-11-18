#!/usr/bin/env bash
# Installs Claude Sessions from this checkout: links the extension and the hook, compiles the settings
# schema, and wires the hook into the settings.json of every Claude Code account found in ~
# (~/.claude and ~/.claude-*). Safe to run again: existing hooks for claude-status-hook are replaced.
# Usage: ./install.sh [config dir...]   (default: every ~/.claude and ~/.claude-* directory)
set -euo pipefail
repo=$(cd "$(dirname "$0")" && pwd -P)
uuid=claude-sessions@dhia.local
ext="$HOME/.local/share/gnome-shell/extensions/$uuid"
hook="$HOME/.local/bin/claude-status-hook"

command -v jq >/dev/null || { echo "jq is required (sudo apt install jq)" >&2; exit 1; }

mkdir -p "$(dirname "$ext")" "$(dirname "$hook")"
# installed from the release zip, the checkout already is the extension dir
[ "$repo" = "$(cd "$ext" 2>/dev/null && pwd -P)" ] || ln -sfn "$repo" "$ext"
ln -sf "$repo/bin/claude-status-hook" "$hook"
chmod +x "$repo/bin/claude-status-hook"
glib-compile-schemas "$repo/schemas"
echo "linked $ext and $hook"

if [ $# -gt 0 ]; then configs=("$@"); else
  configs=()
  for d in "$HOME"/.claude "$HOME"/.claude-*; do [ -d "$d" ] && configs+=("$d"); done
fi

for config in "${configs[@]}"; do
  settings="$config/settings.json"
  [ -f "$settings" ] || echo '{}' > "$settings"
  jq --arg cmd "$hook" '
    def entry(m): (if m then {matcher: m} else {} end) + {hooks: [{type: "command", command: $cmd, timeout: 10}]};
    def wire(event; m): .hooks[event] = ([(.hooks[event] // [])[] | select(all(.hooks[]?; .command != $cmd))] + [entry(m)]);
    .hooks //= {}
    | wire("SessionStart"; null) | wire("UserPromptSubmit"; null) | wire("PostToolUse"; null)
    | wire("Stop"; null) | wire("SessionEnd"; null)
    | wire("Notification"; "permission_prompt|elicitation_dialog")
    | wire("StopFailure"; "rate_limit")' "$settings" > "$settings.tmp" && mv "$settings.tmp" "$settings"
  echo "hooks wired in $settings"
done

cat <<EOF

Done. Restart GNOME Shell (X11: Alt+F2, type r, Enter; Wayland: log out and back in), then:
  gnome-extensions enable $uuid
Sessions already running pick up the hooks when they are restarted.
EOF
