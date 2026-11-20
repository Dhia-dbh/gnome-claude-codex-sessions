/* Claude Sessions: top-bar status of every Claude Code and Codex session on this computer, across accounts.
 *
 * Reads the status files that ~/.local/bin/claude-status-hook (bin/ in this repo) writes from Claude Code and
 * Codex hooks (~/.cache/claude-status/<session_id>.json: agent claude | codex (missing = claude), account,
 * state idle | working | waiting | limited | done, project, cwd, pid + pidstart of the claude / codex process). The directory is watched, so a hook's write shows at once; a
 * slower sweep (refresh-interval) catches what no hook reports: a session whose process is gone is dropped
 * and its file deleted, and a done or idle Claude session still running a Monitor script or a background Bash is
 * shown as 'monitor' or 'shell' instead. The top bar shows, for each agent with live sessions, its mark and
 * one light per account, coloured by the account's most urgent unmuted session; clicking a session in the menu
 * raises its terminal (for a background Claude session, a terminal attached to it, opening one if there is
 * none); the menu lists sessions by agent, then by account, each with an eye toggle that
 * mutes it (muted = kept out of the top-bar light; stored as ~/.cache/claude-status/muted/<session_id>).
 * 'limited' is a session whose turn stopped on a usage limit (StopFailure hook): its account's light turns red.
 * Settings (prefs.js, schemas/) choose which states are shown at all, how the top bar looks, and the
 * accounts' display names and order (account-names, account-order; keyed by accountKey(): the hook's account
 * id for Claude, codex:<id> for Codex).
 * GNOME Shell 42 (legacy imports).
 */

const { GLib, Gio, St, Clutter, Meta } = imports.gi;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const ExtensionUtils = imports.misc.extensionUtils;

const STALE = 12 * 3600;   // sessions whose process could not be found: hidden after this long
const DIR = GLib.build_filenamev([GLib.get_user_cache_dir(), 'claude-status']);
const MUTED = GLib.build_filenamev([DIR, 'muted']);
// most urgent first: the top bar shows the first state any unmuted session of the account is in
const ORDER = ['limited', 'waiting', 'working', 'monitor', 'shell', 'done', 'idle'];
const STATES = {
    limited: { text: 'hit its usage limit' },
    waiting: { text: 'needs you' },
    working: { text: 'working' },
    monitor: { text: 'monitoring a script' },
    shell: { text: 'waiting on a shell' },
    done: { text: 'done' },
    idle: { text: 'idle' },
};
// in top-bar and menu order
const AGENTS = {
    claude: { name: 'Claude Code', mark: '✳' },
    codex: { name: 'Codex', mark: '>_' },
};

// the key an account's display name and position are saved under; Claude's are the bare ids from before Codex
function accountKey(agent, account) {
    return agent === 'claude' ? account : `${agent}:${account}`;
}

function readText(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? new TextDecoder().decode(bytes) : null;
    } catch (e) {
        return null;
    }
}

// The process is the one the hook saw if it exists and started at the same time (pids get reused).
function alive(s) {
    if (!s.pid)
        return GLib.get_real_time() / 1e6 - s.updated < STALE;
    const stat = readText(`/proc/${s.pid}/stat`);
    if (!stat)
        return false;
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');   // fields from #3 on
    return Number(fields[22 - 3]) === s.pidstart;
}

function readLink(path) {
    try {
        return GLib.file_read_link(path);
    } catch (e) {
        return '';
    }
}

function listDir(path) {
    const names = [];
    try {
        const enumerator = Gio.File.new_for_path(path).enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = enumerator.next_file(null)) !== null)
            names.push(info.get_name());
        enumerator.close(null);
    } catch (e) {
    }
    return names;
}

// Claude Code runs every Bash command and every Monitor script as a direct child
// `<shell> -c source …/shell-snapshots/snapshot-…`. A Monitor's stdout is a socket Claude reads its events
// from; a Bash command's stdout is its task output file. 'monitor' wins over 'shell'; null when neither runs.
function backgroundWork(pid) {
    let work = null;
    for (const task of listDir(`/proc/${pid}/task`)) {
        const children = (readText(`/proc/${pid}/task/${task}/children`) || '').split(' ').filter(Boolean);
        for (const child of children) {
            if (!(readText(`/proc/${child}/cmdline`) || '').includes('/shell-snapshots/snapshot-'))
                continue;
            if (readLink(`/proc/${child}/fd/1`).startsWith('socket:'))
                return 'monitor';
            work = 'shell';
        }
    }
    return work;
}

function readSessions() {
    const sessions = [];
    let enumerator;
    try {
        enumerator = Gio.File.new_for_path(DIR).enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
    } catch (e) {
        return sessions;   // no session has run a hook yet
    }
    let info;
    while ((info = enumerator.next_file(null)) !== null) {
        const name = info.get_name();
        if (!name.endsWith('.json'))
            continue;
        const path = GLib.build_filenamev([DIR, name]);
        let s;
        try {
            s = JSON.parse(readText(path));
        } catch (e) {
            continue;   // file mid-write: read it on the next refresh
        }
        if (!s?.state)
            continue;
        if (!alive(s)) {
            GLib.unlink(path);
            GLib.unlink(GLib.build_filenamev([MUTED, s.session]));
            continue;
        }
        s.agent = AGENTS[s.agent] ? s.agent : 'claude';
        const work = s.agent === 'claude' && (s.state === 'done' || s.state === 'idle') && s.pid && backgroundWork(s.pid);
        if (work)
            s.state = work;
        s.account = s.account || 'default';
        s.muted = GLib.file_test(GLib.build_filenamev([MUTED, s.session]), GLib.FileTest.EXISTS);
        sessions.push(s);
    }
    enumerator.close(null);
    return sessions.sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || b.updated - a.updated);
}

function setMuted(session, muted) {
    const path = GLib.build_filenamev([MUTED, session]);
    if (muted) {
        GLib.mkdir_with_parents(MUTED, 0o755);
        GLib.file_set_contents(path, '');
    } else {
        GLib.unlink(path);
    }
}

function parentPid(pid) {
    const stat = readText(`/proc/${pid}/stat`);
    return stat ? Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]) : 0;
}

function environ(pid) {
    const env = {};
    for (const entry of (readText(`/proc/${pid}/environ`) || '').split('\0')) {
        const eq = entry.indexOf('=');
        if (eq > 0)
            env[entry.slice(0, eq)] = entry.slice(eq + 1);
    }
    return env;
}

// The terminal window a process runs in: a window of its nearest ancestor that has any. A terminal with
// several windows in one process (alacritty msg create-window) sets WINDOWID for its children, and
// get_description() of an X11 window starts with its id in hex.
function terminalWindow(pid) {
    const windows = global.get_window_actors().map(a => a.meta_window)
        .filter(w => w.get_window_type() === Meta.WindowType.NORMAL);
    for (let p = pid; p > 1; p = parentPid(p)) {
        const owned = windows.filter(w => w.get_pid() === p);
        if (owned.length > 1) {
            const xid = Number(environ(pid).WINDOWID);
            return owned.find(w => parseInt(w.get_description()) === xid) || owned[0];
        }
        if (owned.length)
            return owned[0];
    }
    return null;
}

// `claude attach <id or part of the name>` processes, which show a background session in a terminal
function attachClients() {
    const clients = [];
    for (const name of listDir('/proc')) {
        if (!/^\d+$/.test(name) || (readText(`/proc/${name}/comm`) || '').trim() !== 'claude')
            continue;
        const args = (readText(`/proc/${name}/cmdline`) || '').split('\0');
        if (args[1] === 'attach' && args[2])
            clients.push({ pid: Number(name), arg: args[2] });
    }
    return clients;
}

function spawn(argv, config, cwd) {
    const launcher = new Gio.SubprocessLauncher({ flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE });
    launcher.setenv('CLAUDE_CONFIG_DIR', config, true);
    if (cwd && GLib.file_test(cwd, GLib.FileTest.IS_DIR))
        launcher.set_cwd(cwd);
    return launcher.spawnv(argv);
}

// Raise the terminal of a session. A background Claude session (claude --bg, run by the claude daemon) has none of
// its own: its job id comes from `claude agents --json` of its account, then a terminal already attached to
// it is raised, or a new one opened on `claude attach <id>`.
function focusSession(s) {
    const own = s.pid && terminalWindow(s.pid);
    if (own) {
        Main.activateWindow(own);
        return;
    }
    const fail = why => Main.notifyError('Claude Sessions', `Can’t show ${s.project}: ${why}`);
    if (s.agent !== 'claude') {   // Codex has no background sessions to attach to
        fail('its terminal window was not found');
        return;
    }
    const config = (s.pid && environ(s.pid).CLAUDE_CONFIG_DIR) ||
        GLib.build_filenamev([GLib.get_home_dir(), s.account === 'default' ? '.claude' : `.claude-${s.account}`]);
    let proc;
    try {
        proc = spawn(['claude', 'agents', '--json'], config);
    } catch (e) {
        fail(e.message);
        return;
    }
    proc.communicate_utf8_async(null, null, (p, res) => {
        let job;
        try {
            job = JSON.parse(p.communicate_utf8_finish(res)[1]).find(j => j.sessionId === s.session);
        } catch (e) {
            fail(`claude agents --json failed (${e.message})`);
            return;
        }
        if (!job?.id) {
            fail('its terminal window was not found');
            return;
        }
        const client = attachClients().find(c => c.arg === job.id || (job.name || '').includes(c.arg));
        const attached = client && terminalWindow(client.pid);
        if (attached) {
            Main.activateWindow(attached);
            return;
        }
        const terminal = GLib.find_program_in_path('alacritty') ? 'alacritty' : 'x-terminal-emulator';
        try {
            spawn([terminal, '-e', 'claude', 'attach', job.id], config, s.cwd);
        } catch (e) {
            fail(e.message);
        }
    });
}

// The account's light: its most urgent unmuted session, or 'muted' when every session is muted.
function accountState(sessions) {
    const shown = sessions.filter(s => !s.muted);
    if (!shown.length)
        return 'muted';
    return ORDER.find(st => shown.some(s => s.state === st)) || 'idle';
}

function age(seconds) {
    if (seconds < 60)
        return `${Math.round(seconds)} s`;
    if (seconds < 3600)
        return `${Math.round(seconds / 60)} min`;
    return `${(seconds / 3600).toFixed(1)} h`;
}

function esc(text) {
    return GLib.markup_escape_text(text || '', -1);
}

function light(state) {
    return new St.Widget({ style_class: `claude-light claude-${state}`, y_align: Clutter.ActorAlign.CENTER });
}

function mark(agent, extraClass) {
    return new St.Label({
        text: AGENTS[agent].mark, style_class: `claude-mark claude-mark-${agent} ${extraClass || ''}`,
        y_align: Clutter.ActorAlign.CENTER,
    });
}

class Indicator {
    constructor(settings) {
        this.settings = settings;
        this.button = new PanelMenu.Button(0.0, 'Claude Sessions', false);
        this.box = new St.BoxLayout({ style_class: 'panel-status-menu-box claude-panel' });
        this.button.add_child(this.box);
        this.section = new PopupMenu.PopupMenuSection();
        this.button.menu.addMenuItem(this.section);
        this.button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.button.menu.addAction('Settings…', () => ExtensionUtils.openPrefs());
        this.button.menu.box.add_style_class_name('claude-menu');
        this.button.menu.connect('open-state-changed', (menu, open) => { if (open) this.refresh(true); });
        Main.panel.addToStatusArea('claude-sessions', this.button, 0, settings.get_string('panel-box'));
        this.panelKey = null;
        this.menuKey = null;
        this.timer = null;
        this.pending = 0;
        GLib.mkdir_with_parents(DIR, 0o755);
        this.watch = Gio.File.new_for_path(DIR).monitor_directory(Gio.FileMonitorFlags.NONE, null);
        this.watchId = this.watch.connect('changed', () => this.queueRefresh());
        this.settingsId = settings.connect('changed', (_, key) => {
            if (key === 'refresh-interval')
                this.startTimer();
            this.panelKey = null;   // redraw both with the new settings
            this.refresh(true);
        });
        this.refresh(true);
        this.startTimer();
    }

    // A hook writes <session>.json.tmp and renames it over <session>.json: one refresh for the burst of events.
    queueRefresh() {
        if (this.pending)
            return;
        this.pending = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            this.pending = 0;
            this.refresh(false);
            return GLib.SOURCE_REMOVE;
        });
    }

    // the sweep for what no hook reports: dead processes, Monitor scripts and background shells
    startTimer() {
        if (this.timer)
            GLib.source_remove(this.timer);
        this.timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, this.settings.get_int('refresh-interval'), () => {
            this.refresh(false);
            return GLib.SOURCE_CONTINUE;
        });
    }

    // the states the settings leave out of the top bar and the menu
    hiddenStates() {
        const hidden = new Set();
        if (!this.settings.get_boolean('show-idle'))
            hidden.add('idle');
        if (!this.settings.get_boolean('show-done'))
            hidden.add('done');
        return hidden;
    }

    // [agent, [[account, sessions], ...]] for each agent with sessions, in AGENTS order
    groups(sessions) {
        // the account order set in Settings, then any account it doesn't list yet alphabetically
        const order = this.settings.get_strv('account-order');
        const rank = key => order.includes(key) ? order.indexOf(key) : order.length;
        const groups = [];
        for (const agent of Object.keys(AGENTS)) {
            const byAccount = new Map();
            for (const s of sessions.filter(s => s.agent === agent)) {
                if (!byAccount.has(s.account))
                    byAccount.set(s.account, []);
                byAccount.get(s.account).push(s);
            }
            if (byAccount.size) {
                groups.push([agent, [...byAccount.entries()].sort((a, b) =>
                    rank(accountKey(agent, a[0])) - rank(accountKey(agent, b[0])) || a[0].localeCompare(b[0]))]);
            }
        }
        return groups;
    }

    accountName(agent, account) {
        return this.settings.get_value('account-names').deep_unpack()[accountKey(agent, account)] || account;
    }

    // force: rebuild the menu even when nothing changed (so the ages are fresh when it opens)
    refresh(force) {
        const all = readSessions();
        const hiddenStates = this.hiddenStates();
        const sessions = all.filter(s => !hiddenStates.has(s.state));
        const hidden = all.length - sessions.length;
        const groups = this.groups(sessions);

        this.button.visible = groups.length > 0 || !this.settings.get_boolean('hide-when-empty');

        const panelKey = groups.map(([agent, accounts]) =>
            `${agent}=` + accounts.map(([a, ss]) => `${a}:${accountState(ss)}`).join(',')).join(';');
        if (panelKey !== this.panelKey) {
            this.panelKey = panelKey;
            this.box.destroy_all_children();
            // keep the mark when there is nothing else, so the indicator stays clickable
            if (!groups.length)
                this.box.add_child(mark('claude', 'claude-none'));
            // with sessions of more than one agent, the marks are what tells their lights apart
            const marks = this.settings.get_boolean('show-mark') || groups.length > 1;
            const labels = this.settings.get_boolean('show-account-labels');
            const pulse = this.settings.get_boolean('pulse-waiting');
            for (const [agent, accounts] of groups) {
                const box = new St.BoxLayout({ style_class: 'claude-agent' });
                this.box.add_child(box);
                if (marks)
                    box.add_child(mark(agent));
                for (const [account, ss] of accounts) {
                    const state = accountState(ss);
                    const dot = light(state);
                    box.add_child(dot);
                    if (pulse && state === 'waiting')
                        dot.ease({ opacity: 70, duration: 700, mode: Clutter.AnimationMode.EASE_IN_OUT_SINE, repeatCount: -1, autoReverse: true });
                    if (labels)
                        box.add_child(new St.Label({ text: this.accountName(agent, account), style_class: 'claude-account', y_align: Clutter.ActorAlign.CENTER }));
                }
            }
        }

        const menuKey = `${hidden};` + sessions.map(s => `${s.session}:${s.state}:${s.muted}:${s.message}`).join(',');
        if (force || (menuKey !== this.menuKey && !this.button.menu.isOpen))
            this.buildMenu(groups, hidden);
        this.menuKey = menuKey;
    }

    buildMenu(groups, hidden) {
        this.section.removeAll();
        if (!groups.length)
            this.section.addMenuItem(new PopupMenu.PopupMenuItem('No sessions to show', { reactive: false }));
        if (hidden) {
            const note = new PopupMenu.PopupMenuItem(`${hidden} hidden session${hidden === 1 ? '' : 's'} (see Settings)`, { reactive: false });
            note.label.add_style_class_name('claude-hidden-note');
            this.section.addMenuItem(note);
        }
        const now = GLib.get_real_time() / 1e6;
        groups.forEach(([agent, accounts], i) => {
            if (i)
                this.section.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            const heading = new PopupMenu.PopupBaseMenuItem({ reactive: false, style_class: 'claude-agent-header' });
            heading.add_child(mark(agent));
            heading.add_child(new St.Label({ text: AGENTS[agent].name, style_class: 'claude-agent-label', y_align: Clutter.ActorAlign.CENTER }));
            this.section.addMenuItem(heading);
            for (const [account, ss] of accounts) {
                const header = new PopupMenu.PopupBaseMenuItem({ reactive: false, style_class: 'claude-header' });
                header.add_child(light(accountState(ss)));
                header.add_child(new St.Label({ text: this.accountName(agent, account), style_class: 'claude-header-label', y_align: Clutter.ActorAlign.CENTER }));
                this.section.addMenuItem(header);
                for (const s of ss)
                    this.section.addMenuItem(this.sessionItem(s, now));
            }
        });
    }

    sessionItem(s, now) {
        const item = new PopupMenu.PopupBaseMenuItem({ style_class: 'claude-session' });
        item.connect('activate', () => focusSession(s));
        const st = STATES[s.state] || STATES.idle;
        item.add_child(light(s.state));
        const detail = s.state === 'waiting' && s.message && this.settings.get_boolean('show-messages') ? `\n<small>${esc(s.message)}</small>` : '';
        const label = new St.Label({ x_expand: true, y_align: Clutter.ActorAlign.CENTER });
        label.clutter_text.set_markup(`<b>${esc(s.project)}</b>  ${st.text}, ${age(now - s.updated)} ago${detail}`);
        item.add_child(label);
        item.label_actor = label;

        const icon = new St.Icon({ style_class: 'popup-menu-icon' });
        const toggle = new St.Button({ child: icon, style_class: 'claude-eye', can_focus: true, y_align: Clutter.ActorAlign.CENTER });
        const show = muted => {
            icon.icon_name = muted ? 'view-conceal-symbolic' : 'view-reveal-symbolic';
            label.opacity = muted ? 110 : 255;
            toggle.accessible_name = muted ? 'Unmute: show this session in the top bar' : 'Mute: hide this session from the top bar';
        };
        show(s.muted);
        toggle.connect('clicked', () => {
            s.muted = !s.muted;
            setMuted(s.session, s.muted);
            show(s.muted);
            this.refresh(false);
        });
        item.add_child(toggle);
        return item;
    }

    destroy() {
        this.settings.disconnect(this.settingsId);
        this.watch.disconnect(this.watchId);
        this.watch.cancel();
        if (this.pending)
            GLib.source_remove(this.pending);
        if (this.timer)
            GLib.source_remove(this.timer);
        this.timer = null;
        this.button.destroy();
    }
}

let indicator = null;
let settings = null;
let boxId = null;

function init() {
}

function enable() {
    settings = ExtensionUtils.getSettings();
    indicator = new Indicator(settings);
    // moving to another part of the top bar means re-adding the button there
    boxId = settings.connect('changed::panel-box', () => {
        indicator.destroy();
        indicator = new Indicator(settings);
    });
}

function disable() {
    settings?.disconnect(boxId);
    indicator?.destroy();
    indicator = null;
    settings = null;
}
