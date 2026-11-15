# Snip

Windows-style area screenshots for GNOME Shell.

Press **Super+Shift+S**, drag over the part of the screen you want, let go, and
it's on your clipboard. Paste with **Ctrl+V**.

- The screen freezes and dims while you select, and the area you pick stays bright.
- Snip draws everything inside GNOME Shell. It opens no window, so there is no
  open/close animation, fullscreen flicker, flash or shutter sound.
- When you release, the selection flashes and the dim fades out.
- A notification shows a thumbnail of the shot. Click it to save the shot and
  open it. **Save** stores it and shows it in Files. Saved shots go to
  `~/Pictures/Screenshots`.
- To cancel, press **Esc** or right-click.

## Requirements

- GNOME Shell 46.
- Wayland or X11.

## Install

```sh
git clone https://github.com/kuduxaaa/gnome-snip
cd gnome-snip
make install
```

Then log out and back in, which Wayland needs to load new extensions, and run:

```sh
gnome-extensions enable snip@kuduxaaa
```

If **Super+Shift+S** is already bound to something else, unbind it first or
change Snip's shortcut (see the next section).

## Settings

```sh
# change the shortcut
gsettings --schemadir ~/.local/share/gnome-shell/extensions/snip@kuduxaaa/schemas \
  set org.gnome.shell.extensions.snip shortcut "['<Super><Shift>a']"

# darker or lighter dim (0–0.9)
gsettings --schemadir ~/.local/share/gnome-shell/extensions/snip@kuduxaaa/schemas \
  set org.gnome.shell.extensions.snip dim 0.5

# no notification
gsettings --schemadir ~/.local/share/gnome-shell/extensions/snip@kuduxaaa/schemas \
  set org.gnome.shell.extensions.snip notify false
```

## Scripting

To start a snip from a script or another key daemon:

```sh
gdbus call --session --dest org.gnome.Shell \
  --object-path /io/github/kuduxaaa/Snip --method io.github.kuduxaaa.Snip.Start
```

## How it works

1. `Shell.Screenshot.screenshot_stage_to_content()` grabs the stage as a
   texture. This is the API GNOME's built-in screenshot UI uses.
2. A modal actor in `Main.uiGroup` shows the frozen frame with four dim
   rectangles around the selection.
3. On release, `Shell.Screenshot.composite_to_stream()` crops the frozen
   texture to PNG, and `St.Clipboard` publishes it. GNOME Shell itself owns the
   clipboard, so nothing has to keep running.

## Translations

The UI is in English and Georgian (`po/ka.po`). To add a language, run
`make pot`, copy `po/snip.pot` to `po/<lang>.po`, translate it and open a PR.

## Uninstall

```sh
make uninstall
```

## License

GPL-2.0-or-later. See [LICENSE](LICENSE).
