#!/usr/bin/env bash
# Installs Claude Sessions from this checkout: links the extension and the hook, compiles the settings
# schema, and wires the hook into every Claude Code account found in ~ (the settings.json of ~/.claude and
# ~/.claude-*) and every Codex home (the hooks.json of ~/.codex and ~/.codex-*).
# Safe to run again: existing hooks for claude-status-hook are replaced.
# Usage: ./install.sh [config dir...]   (default: every ~/.claude, ~/.claude-*, ~/.codex and ~/.codex-* directory;
#        a dir named .codex or .codex-* is a Codex home, anything else a Claude config dir)
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
  for d in "$HOME"/.claude "$HOME"/.claude-* "$HOME"/.codex "$HOME"/.codex-*; do [ -d "$d" ] && configs+=("$d"); done
fi

# wire(event; matcher; timeout) replaces this hook's entries for the event; the same JSON shape for both agents
wire='def entry(m; t): (if m then {matcher: m} else {} end) + {hooks: [{type: "command", command: $cmd, timeout: t}]};
      def wire(event; m; t): .hooks[event] = ([(.hooks[event] // [])[] | select(all(.hooks[]?; .command != $cmd))] + [entry(m; t)]);
      .hooks //= {}'
codex=0
for config in "${configs[@]}"; do
  case "$(basename "$config")" in
    .codex|.codex-*)
      file="$config/hooks.json"
      [ -f "$file" ] || echo '{}' > "$file"
      # SessionEnd and Interrupt allow at most 3 s
      jq --arg cmd "$hook --agent codex" "$wire"'
        | wire("SessionStart"; null; 10) | wire("UserPromptSubmit"; null; 10) | wire("PostToolUse"; null; 10)
        | wire("PermissionRequest"; null; 10) | wire("Stop"; null; 10)
        | wire("Interrupt"; null; 3) | wire("SessionEnd"; null; 3)' "$file" > "$file.tmp" && mv "$file.tmp" "$file"
      # Codex loads hooks from both files of a layer, and warns when both have some
      if grep -qE '^\[\[?hooks[].]' "$config/config.toml" 2>/dev/null; then
        echo "note: $config/config.toml also declares hooks; Codex will warn that the layer has two hook sources"
      fi
      codex=1 ;;
    *)
      file="$config/settings.json"
      [ -f "$file" ] || echo '{}' > "$file"
      jq --arg cmd "$hook" "$wire"'
        | wire("SessionStart"; null; 10) | wire("UserPromptSubmit"; null; 10) | wire("PostToolUse"; null; 10)
        | wire("Stop"; null; 10) | wire("SessionEnd"; null; 10)
        | wire("Notification"; "permission_prompt|elicitation_dialog"; 10)
        | wire("StopFailure"; "rate_limit"; 10)' "$file" > "$file.tmp" && mv "$file.tmp" "$file" ;;
  esac
  echo "hooks wired in $file"
done

cat <<EOF

Done. Restart GNOME Shell (X11: Alt+F2, type r, Enter; Wayland: log out and back in), then:
  gnome-extensions enable $uuid
Sessions already running pick up the hooks when they are restarted.
EOF
if [ "$codex" = 1 ]; then cat <<EOF
Codex runs a hook only once you trust it: start codex, type /hooks and trust the claude-status-hook
entries (once per Codex home, and again whenever they change).
EOF
fi
