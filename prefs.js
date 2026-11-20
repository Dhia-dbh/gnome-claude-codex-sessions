/* Claude & Codex Sessions: settings window (GNOME 42, GTK 4 + libadwaita). Every row is bound straight to its
 * GSettings key, so changes apply to the top bar as soon as they are made. Accounts are the config dirs
 * found in ~ (~/.claude -> default, ~/.claude-<id> -> <id>, and the same for ~/.codex, as
 * bin/claude-status-hook names them) plus any account a status file or the saved order mentions. They are
 * saved under extension.js's accountKey(): the bare id for Claude, codex:<id> for Codex. */

const { Adw, Gio, GLib, Gtk } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;

function init() {
}

function switchRow(settings, key, title, subtitle) {
    const row = new Adw.ActionRow({ title, subtitle: subtitle || '' });
    const toggle = new Gtk.Switch({ valign: Gtk.Align.CENTER });
    settings.bind(key, toggle, 'active', Gio.SettingsBindFlags.DEFAULT);
    row.add_suffix(toggle);
    row.activatable_widget = toggle;
    return row;
}

const AGENTS = { claude: 'Claude Code', codex: 'Codex' };

function accountKey(agent, account) {
    return agent === 'claude' ? account : `${agent}:${account}`;
}

// [agent, account id] of a saved key
function parseKey(key) {
    const colon = key.indexOf(':');
    return colon > 0 && AGENTS[key.slice(0, colon)] ? [key.slice(0, colon), key.slice(colon + 1)] : ['claude', key];
}

// the account key the hook gives a config dir name, or null for anything else in ~
function dirKey(name) {
    const m = /^\.(claude|codex)(?:-(.+))?$/.exec(name);
    return m ? accountKey(m[1], m[2] || 'default') : null;
}

function knownAccounts(settings) {
    const found = new Set(settings.get_strv('account-order'));
    const home = GLib.get_home_dir();
    const status = GLib.build_filenamev([GLib.get_user_cache_dir(), 'claude-status']);
    for (const [dir, fromName] of [[home, true], [status, false]]) {
        try {
            const children = Gio.File.new_for_path(dir).enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
            let info;
            while ((info = children.next_file(null)) !== null) {
                const name = info.get_name();
                if (fromName) {
                    const key = info.get_file_type() === Gio.FileType.DIRECTORY && dirKey(name);
                    if (key)
                        found.add(key);
                } else if (name.endsWith('.json')) {
                    try {
                        const [, bytes] = GLib.file_get_contents(GLib.build_filenamev([dir, name]));
                        const s = JSON.parse(new TextDecoder().decode(bytes));
                        if (s.account)
                            found.add(accountKey(AGENTS[s.agent] ? s.agent : 'claude', s.account));
                    } catch (e) {
                    }
                }
            }
            children.close(null);
        } catch (e) {
        }
    }
    const order = settings.get_strv('account-order');
    const rank = a => order.includes(a) ? order.indexOf(a) : order.length;
    return [...found].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

// one group per agent, one row per account: a name entry (empty = the id) and up/down buttons that move
// it within its agent; any change saves the full order. An agent with no accounts has its group hidden.
function accountsGroups(settings) {
    const groups = {};
    for (const [agent, name] of Object.entries(AGENTS)) {
        groups[agent] = new Adw.PreferencesGroup({
            title: `${name} accounts`,
            description: 'Name shown for each account, and their order in the top bar and the menu',
        });
    }
    let rows = [];
    const fill = () => {
        rows.forEach(([group, row]) => group.remove(row));
        rows = [];
        const keys = knownAccounts(settings);
        const byAgent = Object.fromEntries(Object.keys(AGENTS).map(agent => [agent, keys.filter(k => parseKey(k)[0] === agent)]));
        for (const [agent, accounts] of Object.entries(byAgent)) {
            const group = groups[agent];
            group.visible = accounts.length > 0;
            accounts.forEach((key, i) => {
                const account = parseKey(key)[1];
                const path = account === 'default' ? `~/.${agent}` : `~/.${agent}-${account}`;
                const row = new Adw.ActionRow({ title: account, subtitle: path });
                const entry = new Gtk.Entry({ valign: Gtk.Align.CENTER, placeholder_text: account, width_chars: 14 });
                entry.text = settings.get_value('account-names').deep_unpack()[key] || '';
                entry.connect('changed', () => {
                    const names = settings.get_value('account-names').deep_unpack();
                    if (entry.text.trim())
                        names[key] = entry.text.trim();
                    else
                        delete names[key];
                    settings.set_value('account-names', new GLib.Variant('a{ss}', names));
                });
                row.add_suffix(entry);
                const move = (icon, to, tooltip) => {
                    const button = new Gtk.Button({ icon_name: icon, valign: Gtk.Align.CENTER, sensitive: to >= 0 && to < accounts.length, tooltip_text: tooltip });
                    button.add_css_class('flat');
                    button.connect('clicked', () => {
                        const order = [...accounts];
                        [order[i], order[to]] = [order[to], order[i]];
                        byAgent[agent] = order;
                        settings.set_strv('account-order', Object.values(byAgent).flat());
                        fill();
                    });
                    row.add_suffix(button);
                };
                move('go-up-symbolic', i - 1, 'Move up');
                move('go-down-symbolic', i + 1, 'Move down');
                group.add(row);
                rows.push([group, row]);
            });
        }
    };
    fill();
    return Object.values(groups);
}

function fillPreferencesWindow(window) {
    const settings = ExtensionUtils.getSettings();
    const page = new Adw.PreferencesPage();

    const sessions = new Adw.PreferencesGroup({ title: 'Sessions', description: 'Which sessions appear in the top bar and the menu' });
    sessions.add(switchRow(settings, 'show-idle', 'Show idle sessions', 'Sessions not doing anything since they started'));
    sessions.add(switchRow(settings, 'show-done', 'Show finished sessions', 'Sessions whose last turn has ended'));
    page.add(sessions);

    const bar = new Adw.PreferencesGroup({ title: 'Top bar' });
    bar.add(switchRow(settings, 'show-mark', 'Show the agent marks', '✳ for Claude Code, >_ for Codex. Always shown when both have sessions'));
    bar.add(switchRow(settings, 'show-account-labels', 'Show account names', 'Next to each account’s light'));
    bar.add(switchRow(settings, 'pulse-waiting', 'Pulse when a session needs you'));
    bar.add(switchRow(settings, 'show-limits', 'Show usage limits in the top bar', 'The 5h and weekly bars after each account’s light, as in the menu'));
    bar.add(switchRow(settings, 'hide-when-empty', 'Hide when there are no sessions to show'));

    const boxes = ['left', 'center', 'right'];
    const position = new Adw.ActionRow({ title: 'Position' });
    const dropdown = Gtk.DropDown.new_from_strings(['Left', 'Center', 'Right']);
    dropdown.valign = Gtk.Align.CENTER;
    dropdown.selected = Math.max(0, boxes.indexOf(settings.get_string('panel-box')));
    dropdown.connect('notify::selected', () => settings.set_string('panel-box', boxes[dropdown.selected]));
    position.add_suffix(dropdown);
    bar.add(position);
    page.add(bar);

    const menu = new Adw.PreferencesGroup({ title: 'Menu' });
    menu.add(switchRow(settings, 'show-messages', 'Show what a waiting session is asking'));
    page.add(menu);

    accountsGroups(settings).forEach(group => page.add(group));

    const advanced = new Adw.PreferencesGroup({ title: 'Advanced' });
    const refresh = new Adw.ActionRow({ title: 'Background check interval', subtitle: 'Seconds between checks for crashed sessions, monitors and background shells. Hook updates show at once.' });
    const spin = Gtk.SpinButton.new_with_range(1, 300, 1);
    spin.valign = Gtk.Align.CENTER;
    settings.bind('refresh-interval', spin, 'value', Gio.SettingsBindFlags.DEFAULT);
    refresh.add_suffix(spin);
    advanced.add(refresh);
    const limits = new Adw.ActionRow({ title: 'Codex limits check interval', subtitle: 'Seconds between asks for the usage limits of Codex accounts with a working session. Idle accounts are not asked. Claude’s come from its sessions.' });
    const limitsSpin = Gtk.SpinButton.new_with_range(60, 3600, 30);
    limitsSpin.valign = Gtk.Align.CENTER;
    settings.bind('limits-interval', limitsSpin, 'value', Gio.SettingsBindFlags.DEFAULT);
    limits.add_suffix(limitsSpin);
    advanced.add(limits);
    page.add(advanced);

    window.add(page);
    window.set_default_size(480, 640);
}
