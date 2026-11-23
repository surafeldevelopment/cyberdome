# Installing CyberDome

CyberDome Command Center runs as a Windows desktop app. It keeps everything on your computer:
the app, its local server (bound to 127.0.0.1 only) and your assessment data.

## Requirements

* Windows 10 or 11, 64-bit.
* About 350 MB of disk space for the app.
* **Nmap** if you want to run scans from the app. Download the Windows installer from
  https://nmap.org/download and keep the **Npcap** option ticked. CyberDome finds Nmap on its own
  (on PATH or in `C:\Program Files (x86)\Nmap`). Without Nmap you can still import scan files.
* Optional: Wireshark (for `tshark`) to summarize packet captures locally.

## Install

1. Run `CyberDomeInstaller.exe`.
2. Click **Next**, keep or change the install folder, and click **Install**.
3. Leave **Launch CyberDome** ticked and click **Finish**.

Windows asks for permission once (User Account Control), because Setup installs the program into
`C:\Program Files\CyberDome`, like other desktop software. It adds a **CyberDome** launcher to your
**Downloads** folder, plus shortcuts in the Start menu and on the desktop. Each user's assessment data stays in their own profile.
After installing you can delete the Setup file; it is not needed to run CyberDome.

Unless the build was signed with a code-signing certificate (see `docs/DEVELOPMENT.md`), Windows
SmartScreen may show "Windows protected your PC" the first time. Choose **More info**, then
**Run anyway**.

## Using the app

* Closing the window keeps CyberDome running in the system tray so automatic scans can run.
  Right-click the tray icon for **Open CyberDome**, **Start with Windows**, **Open data folder** and
  **Quit CyberDome**.
* Only one copy runs at a time. Opening the shortcut again brings the existing window forward.

## Where your data lives

| What | Location |
|---|---|
| Database and evidence files | `%LOCALAPPDATA%\CyberDome\data` |
| Startup errors, if any | `%LOCALAPPDATA%\CyberDome\data\desktop.log` |
| App files | `C:\Program Files\CyberDome` |

The data folder is deliberately outside Documents, which OneDrive often syncs to the cloud.
Evidence never leaves this computer unless you export it. Make backups from **Settings > Backup**.

## Updating

CyberDome checks for new versions when it starts and every few hours while it runs (including
from the tray). When one is available it asks:

* **Update now** downloads the new installer, checks its SHA-256 against the published value,
  installs it (Windows asks for permission), and reopens CyberDome.
* **Remind me later** asks again in a day.
* **Skip this version** stops asking about that version. A later version still prompts.

You can also check at any time from **Settings > Updates** or the tray menu (**Check for updates**),
and turn automatic checks off there. The check downloads a small public file from
`github.com/surafeldevelopment/cyberdome-releases` and sends nothing about your assessment.
Your data is kept on every update.

## Uninstalling

Use **Settings > Apps > Installed apps > CyberDome Command Center > Uninstall**, or run
`Uninstall CyberDome.exe` in the install folder. Uninstalling removes the program and its
shortcuts but **keeps your data** in `%LOCALAPPDATA%\CyberDome\data`. Delete that folder yourself
if you no longer need it.
