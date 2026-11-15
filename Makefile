UUID := snip@kuduxaaa
ZIP  := $(UUID).shell-extension.zip

.PHONY: pack install uninstall pot clean

pack: $(ZIP)

$(ZIP): metadata.json extension.js schemas/*.gschema.xml po/*.po
	gnome-extensions pack --force --podir=po --extra-source=LICENSE .

install: $(ZIP)
	gnome-extensions install --force $(ZIP)
	@echo "Installed. Log out and back in (Wayland), then: gnome-extensions enable $(UUID)"

uninstall:
	-gnome-extensions disable $(UUID)
	gnome-extensions uninstall $(UUID)

pot:
	xgettext --from-code=UTF-8 --language=JavaScript -k_ -o po/snip.pot extension.js

clean:
	rm -f $(ZIP) schemas/gschemas.compiled
