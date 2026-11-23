# Development

## Repository layout

```
cyberdome/
├── server/               API and services (Express + TypeScript, run with tsx)
│   ├── db/               SQLite access and ordered migrations
│   ├── importers/        Nmap, Nessus, Greenbone, log and recon parsers
│   ├── routes/           HTTP routes, one file per module
│   ├── services/         Evidence store, scan runner and scheduler, AI, reports, metrics
│   ├── scripts/          Backup and restore command-line tools
│   ├── index.ts          Server entry point (npm start / npm run dev)
│   └── desktop.ts        Entry point used by the desktop app
├── web/src/              User interface (React + Vite)
│   ├── components/       Shared layout and UI building blocks
│   ├── pages/            One folder or file per module
│   └── styles/           Design tokens and module styles
├── desktop/              Windows desktop app (Electron shell) and installer
│   ├── main.cjs          Window, tray and local server startup
│   ├── installer/        NSIS installer script
│   ├── assets/           App icon
│   └── build.mjs         Builds the app folder and `CyberDomeInstaller.exe`
├── docs/                 Documentation
├── samples/              Import templates and the synthetic demo data set
├── scripts/start-dev.cmd Windows developer launcher (hot reload)
└── tests/                Vitest + Supertest suites with synthetic fixtures
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API on 127.0.0.1:4646 and the web app on 127.0.0.1:5173 with hot reload |
| `npm run build` | Builds the web interface into `dist/` |
| `npm start` | Serves the built interface and API on 127.0.0.1:4646 |
| `npm test` | Runs the automated tests |
| `npm run typecheck` | TypeScript check for server and web |
| `npm run backup` / `npm run restore` | Command-line backup and restore (see `BACKUP_RESTORE.md`) |
| `npm run installer` | Builds the Windows app and `desktop/out/CyberDomeInstaller.exe` |

## Building the installer

The build runs on Linux, macOS or Windows and needs no Wine.

**Code signing (optional).** To remove the SmartScreen warning, sign with an Authenticode
code-signing certificate from a certificate authority (or a service such as Azure Trusted Signing
exported to a .pfx). Set `CYBERDOME_SIGN_PFX` and `CYBERDOME_SIGN_PASSWORD` before building; the
build then signs `CyberDome.exe` and the Setup file (signtool on Windows, osslsigncode elsewhere,
timestamped with `CYBERDOME_SIGN_TIMESTAMP`, default DigiCert). A self-signed certificate does not
help: Windows still reports an unknown publisher.

1. Install NSIS 3 (`sudo apt-get install nsis`, `brew install makensis`, or the Windows installer
   from nsis.sourceforge.io).
2. From the repository root run `npm run installer`.

The build compiles the web interface, bundles the server into one file, downloads the Electron
runtime for Windows x64, packs the app into `resources/app.asar`, sets the icon and version
information on `CyberDome.exe`, and compiles the NSIS installer. Output:

* `desktop/out/CyberDome/`: the unpacked app (useful for testing without installing)
* `desktop/out/CyberDomeInstaller.exe`: the installer to distribute

The version comes from the root `package.json`. The Electron version is pinned in
`desktop/package.json` (`electronVersion`).

## Publishing an update

Installed copies read `https://github.com/surafeldevelopment/cyberdome-releases/releases/latest/download/latest.json`
and offer any higher version (Update now, Remind me later, Skip this version). To publish:

```
npm run release -- 1.2.0 "Short description of what changed"
```

This sets the version in `package.json`, builds `desktop/out/CyberDomeInstaller.exe`, and writes
`desktop/out/latest.json` with the version, notes, download URL, SHA-256 and size. If the GitHub
CLI (`gh`) is installed and signed in, it also creates the public `cyberdome-releases` repository
the first time (installers only, no source code) and publishes the release with both files.
Without `gh`, it prints the two files to upload on the GitHub "new release" page.

Rules the updater enforces: the feed and the download must be HTTPS on github.com (or GitHub's
download hosts), the version must be higher than the installed one, and the installer's SHA-256 must
match the feed before it runs. Use `CYBERDOME_UPDATE_REPO` to publish elsewhere and
`CYBERDOME_UPDATE_URL` to point a copy at a different feed for testing.
