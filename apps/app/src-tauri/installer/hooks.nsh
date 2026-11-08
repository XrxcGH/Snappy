; Snappy's installer hooks (Tauri's installerHooks). Only a top-level setting lives here: no macro in this file
; runs anything at install or uninstall time, so the installer does what Tauri's template does, except for what
; is written below.
;
; The last page of the wizard offers "Create desktop shortcut" as a tick box, and Tauri's template ticks it.
; Snappy leaves it unticked: a shortcut on the desktop is the person's choice (the Start menu one is always made).
; A silent or passive install, which is how scripted installs and updates run, still makes the desktop shortcut, as the template does.
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
