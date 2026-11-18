/* Claude Sessions: settings window (GNOME 42, GTK 4 + libadwaita). Every row is bound straight to its
 * GSettings key, so changes apply to the top bar as soon as they are made. Accounts are the config dirs
 * found in ~ (~/.claude -> default, ~/.claude-<id> -> <id>, as bin/claude-status-hook names them) plus
 * any account a status file or the saved order mentions. */

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

// the account id the hook gives a config dir name, or null for anything else in ~
function accountId(name) {
    const m = /^\.claude(?:-(.+))?$/.exec(name);
    return m ? m[1] || 'default' : null;
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
                    const id = info.get_file_type() === Gio.FileType.DIRECTORY && accountId(name);
                    if (id)
                        found.add(id);
                } else if (name.endsWith('.json')) {
                    try {
                        const [, bytes] = GLib.file_get_contents(GLib.build_filenamev([dir, name]));
                        const account = JSON.parse(new TextDecoder().decode(bytes)).account;
                        if (account)
                            found.add(account);
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

// one row per account: a name entry (empty = the id) and up/down buttons; any change saves the full order
function accountsGroup(settings) {
    const group = new Adw.PreferencesGroup({
        title: 'Accounts',
        description: 'Name shown for each account, and their order in the top bar and the menu',
    });
    let rows = [];
    const fill = () => {
        rows.forEach(row => group.remove(row));
        const accounts = knownAccounts(settings);
        rows = accounts.map((account, i) => {
            const path = account === 'default' ? '~/.claude' : `~/.claude-${account}`;
            const row = new Adw.ActionRow({ title: account, subtitle: path });
            const entry = new Gtk.Entry({ valign: Gtk.Align.CENTER, placeholder_text: account, width_chars: 14 });
            entry.text = settings.get_value('account-names').deep_unpack()[account] || '';
            entry.connect('changed', () => {
                const names = settings.get_value('account-names').deep_unpack();
                if (entry.text.trim())
                    names[account] = entry.text.trim();
                else
                    delete names[account];
                settings.set_value('account-names', new GLib.Variant('a{ss}', names));
            });
            row.add_suffix(entry);
            const move = (icon, to, tooltip) => {
                const button = new Gtk.Button({ icon_name: icon, valign: Gtk.Align.CENTER, sensitive: to >= 0 && to < accounts.length, tooltip_text: tooltip });
                button.add_css_class('flat');
                button.connect('clicked', () => {
                    const order = [...accounts];
                    [order[i], order[to]] = [order[to], order[i]];
                    settings.set_strv('account-order', order);
                    fill();
                });
                row.add_suffix(button);
            };
            move('go-up-symbolic', i - 1, 'Move up');
            move('go-down-symbolic', i + 1, 'Move down');
            group.add(row);
            return row;
        });
    };
    fill();
    return group;
}

function fillPreferencesWindow(window) {
    const settings = ExtensionUtils.getSettings();
    const page = new Adw.PreferencesPage();

    const sessions = new Adw.PreferencesGroup({ title: 'Sessions', description: 'Which sessions appear in the top bar and the menu' });
    sessions.add(switchRow(settings, 'show-idle', 'Show idle sessions', 'Sessions not doing anything since they started'));
    sessions.add(switchRow(settings, 'show-done', 'Show finished sessions', 'Sessions whose last turn has ended'));
    page.add(sessions);

    const bar = new Adw.PreferencesGroup({ title: 'Top bar' });
    bar.add(switchRow(settings, 'show-mark', 'Show the Claude mark'));
    bar.add(switchRow(settings, 'show-account-labels', 'Show account names', 'Next to each account’s light'));
    bar.add(switchRow(settings, 'pulse-waiting', 'Pulse when a session needs you'));
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

    page.add(accountsGroup(settings));

    const advanced = new Adw.PreferencesGroup({ title: 'Advanced' });
    const refresh = new Adw.ActionRow({ title: 'Background check interval', subtitle: 'Seconds between checks for crashed sessions, monitors and background shells. Hook updates show at once.' });
    const spin = Gtk.SpinButton.new_with_range(1, 300, 1);
    spin.valign = Gtk.Align.CENTER;
    settings.bind('refresh-interval', spin, 'value', Gio.SettingsBindFlags.DEFAULT);
    refresh.add_suffix(spin);
    advanced.add(refresh);
    page.add(advanced);

    window.add(page);
    window.set_default_size(480, 640);
}
