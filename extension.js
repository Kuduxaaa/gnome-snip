// SPDX-License-Identifier: GPL-2.0-or-later
//
// Snip: Windows-style area screenshot to the clipboard, drawn inside GNOME Shell
// (no window -> no open/close animation, no fullscreen switch, no flash, no sound).
//
// Triggered by the `shortcut` key (default Super+Shift+S) or over D-Bus:
//   gdbus call --session --dest org.gnome.Shell \
//     --object-path /io/github/kuduxaaa/Snip --method io.github.kuduxaaa.Snip.Start
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

Gio._promisify(Shell.Screenshot.prototype, 'screenshot_stage_to_content');
Gio._promisify(Shell.Screenshot, 'composite_to_stream');

const IFACE = `<node>
  <interface name="io.github.kuduxaaa.Snip"><method name="Start"/></interface>
</node>`;
const DBUS_PATH = '/io/github/kuduxaaa/Snip';
const FADE_IN = 90;        // ms
const SAFETY = 60;         // s; never keep the screen frozen longer than this

class Snipper {
    constructor(settings) {
        this._settings = settings;
        this._root = null;
        this._busy = false;
        this._fading = new Set();
    }

    async start() {
        if (this._busy || Main.sessionMode.isLocked || Main.screenshotUI?.visible)
            return;
        this._busy = true;
        try {
            const shooter = new Shell.Screenshot();
            const [content, scale] = await shooter.screenshot_stage_to_content();
            this._open(content, scale);
        } catch (e) {
            logError(e, 'snip');
            this._close();
        }
    }

    _open(content, scale) {
        const W = global.stage.width, H = global.stage.height;
        this._content = content;
        this._scale = scale;
        this._sel = null;
        const dim = this._settings.get_double('dim');

        const root = new St.Widget({reactive: true, can_focus: true, x: 0, y: 0, width: W, height: H, opacity: 0});
        root.add_child(new Clutter.Actor({x: 0, y: 0, width: W, height: H, content}));
        this._dims = [0, 1, 2, 3].map(() => {
            const a = new St.Widget({style: `background-color: rgba(0,0,0,${dim});`});
            root.add_child(a);
            return a;
        });
        this._border = new St.Widget({style: 'border: 1px solid rgba(255,255,255,0.9);', visible: false});
        root.add_child(this._border);
        this._root = root;
        this._layout();

        Main.layoutManager.emit('system-modal-opened');   // close popup menus
        Main.uiGroup.add_child(root);
        Main.uiGroup.set_child_above_sibling(root, null);

        this._grab = Main.pushModal(root, {actionMode: Shell.ActionMode.POPUP});
        if ((this._grab.get_seat_state() & Clutter.GrabState.POINTER) === 0) {
            this._close();
            return;
        }
        global.stage.set_key_focus(root);
        global.display.set_cursor(Meta.Cursor.CROSSHAIR);

        root.connect('button-press-event', (_a, ev) => this._guard(() => this._press(ev)));
        root.connect('motion-event', (_a, ev) => this._guard(() => this._motion(ev)));
        root.connect('button-release-event', (_a, ev) => this._guard(() => this._release(ev)));
        root.connect('key-press-event', (_a, ev) => {
            if (ev.get_key_symbol() === Clutter.KEY_Escape)
                this._close();
            return Clutter.EVENT_STOP;
        });

        this._timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, SAFETY, () => {
            this._timeout = 0;
            this._close();
            return GLib.SOURCE_REMOVE;
        });
        root.ease({opacity: 255, duration: FADE_IN, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    _guard(fn) {
        try {
            fn();
        } catch (e) {
            logError(e, 'snip');
            this._close();
        }
        return Clutter.EVENT_STOP;
    }

    _press(ev) {
        if (ev.get_button() === Clutter.BUTTON_SECONDARY) {
            this._close();
            return;
        }
        if (ev.get_button() !== Clutter.BUTTON_PRIMARY)
            return;
        const [x, y] = ev.get_coords();
        this._start = [x, y];
        this._sel = [x, y, 0, 0];
        this._layout();
    }

    _motion(ev) {
        if (!this._start)
            return;
        const [x, y] = ev.get_coords();
        const [x0, y0] = this._start;
        this._sel = [Math.min(x0, x), Math.min(y0, y), Math.abs(x - x0), Math.abs(y - y0)];
        this._layout();
    }

    _release(ev) {
        if (ev.get_button() !== Clutter.BUTTON_PRIMARY || !this._start)
            return;
        this._motion(ev);
        this._start = null;
        const [x, y, w, h] = this._sel.map(Math.round);
        if (w < 3 || h < 3) {
            this._sel = null;
            this._layout();
            return;
        }
        const texture = this._content.get_texture();
        const s = this._scale;
        this._snap(x, y, w, h);
        this._copy(texture, [x * s, y * s, w * s, h * s], s);
    }

    // "Snap": the selection blinks white once, the dim melts away.
    _snap(x, y, w, h) {
        const root = this._root;
        this._root = null;
        this._close();                         // input back to the user right away
        root.remove_all_transitions();
        root.reactive = false;                 // clicks pass through while it fades
        const flash = new St.Widget({x, y, width: w, height: h, opacity: 0,
            style: 'background-color: white;'});
        root.add_child(flash);
        flash.ease({
            opacity: 120, duration: 70, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => flash.ease({opacity: 0, duration: 230, mode: Clutter.AnimationMode.EASE_IN_QUAD}),
        });
        this._fading.add(root);
        root.ease({
            opacity: 0, delay: 90, duration: 260, mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
            onStopped: () => {
                this._fading.delete(root);
                root.destroy();
            },
        });
        global.display.set_cursor(Meta.Cursor.DEFAULT);
    }

    async _copy(texture, [x, y, w, h], scale) {
        try {
            const stream = Gio.MemoryOutputStream.new_resizable();
            const pixbuf = await Shell.Screenshot.composite_to_stream(texture, x, y, w, h, scale, null, 0, 0, 1, stream);
            stream.close(null);
            const bytes = stream.steal_as_bytes();
            St.Clipboard.get_default().set_content(St.ClipboardType.CLIPBOARD, 'image/png', bytes);
            if (this._settings.get_boolean('notify'))
                this._notify(bytes, pixbuf);
        } catch (e) {
            logError(e, 'snip');
        }
    }

    _notify(bytes, pixbuf) {
        const thumb = St.ImageContent.new_with_preferred_size(pixbuf.width, pixbuf.height);
        thumb.set_bytes(pixbuf.read_pixel_bytes(), Cogl.PixelFormat.RGBA_8888,
            pixbuf.width, pixbuf.height, pixbuf.rowstride);
        const source = new MessageTray.Source({title: 'Snip', iconName: 'screenshot-recorded-symbolic'});
        const n = new MessageTray.Notification({
            source,
            title: _('Screenshot copied'),
            body: _('Paste it with Ctrl+V. Click to save and open.'),
            gicon: thumb,
            isTransient: true,
        });
        let saved = null;
        const save = () => {
            if (saved)
                return saved;
            const dir = GLib.build_filenamev([GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES) ?? GLib.get_home_dir(), 'Screenshots']);
            GLib.mkdir_with_parents(dir, 0o755);
            const stamp = GLib.DateTime.new_now_local().format('%Y-%m-%d %H-%M-%S');
            saved = Gio.File.new_for_path(GLib.build_filenamev([dir, `Snip ${stamp}.png`]));
            // the file is written asynchronously; the launchers below wait 150 ms for it
            saved.replace_contents_bytes_async(bytes, null, false, Gio.FileCreateFlags.NONE, null, null);
            return saved;
        };
        const ctx = () => global.create_app_launch_context(0, -1);
        n.connect('activated', () => {
            const f = save();
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
                try { Gio.app_info_launch_default_for_uri(f.get_uri(), ctx()); } catch (e) { logError(e, 'snip'); }
                return GLib.SOURCE_REMOVE;
            });
        });
        n.addAction(_('Save'), () => {
            const f = save();
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
                const app = Gio.app_info_get_default_for_type('inode/directory', false);
                app?.launch([f], ctx());
                return GLib.SOURCE_REMOVE;
            });
        });
        Main.messageTray.add(source);
        source.addNotification(n);
    }

    _layout() {
        const W = global.stage.width, H = global.stage.height;
        const set = (a, x, y, w, h) => {
            a.set_position(x, y);
            a.set_size(Math.max(w, 0), Math.max(h, 0));
        };
        const [t, b, l, r] = this._dims;
        if (!this._sel) {
            set(t, 0, 0, W, H);
            set(b, 0, 0, 0, 0); set(l, 0, 0, 0, 0); set(r, 0, 0, 0, 0);
            this._border.visible = false;
            return;
        }
        const [x, y, w, h] = this._sel;
        set(t, 0, 0, W, y);
        set(b, 0, y + h, W, H - y - h);
        set(l, 0, y, x, h);
        set(r, x + w, y, W - x - w, h);
        this._border.visible = w >= 2 && h >= 2;
        this._border.set_position(x, y);
        this._border.set_size(w, h);
    }

    _close() {
        if (this._timeout) {
            GLib.source_remove(this._timeout);
            this._timeout = 0;
        }
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        if (this._root) {
            global.display.set_cursor(Meta.Cursor.DEFAULT);
            this._root.destroy();
            this._root = null;
        }
        this._content = null;
        this._start = null;
        this._busy = false;
    }

    destroy() {
        this._close();
        for (const r of this._fading)
            r.destroy();
        this._fading.clear();
    }
}

export default class SnipExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._snipper = new Snipper(this._settings);

        Main.wm.addKeybinding('shortcut', this._settings, Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => this._snipper.start());

        this._dbus = Gio.DBusExportedObject.wrapJSObject(IFACE, {
            Start: () => this._snipper.start(),
        });
        this._dbus.export(Gio.DBus.session, DBUS_PATH);
    }

    disable() {
        Main.wm.removeKeybinding('shortcut');
        this._dbus?.unexport();
        this._dbus = null;
        this._snipper?.destroy();
        this._snipper = null;
        this._settings = null;
    }
}
