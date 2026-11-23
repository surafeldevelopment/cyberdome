# Backup and restore

CyberDome stores everything in one data directory (default `./data`, override with `CYBERDOME_DATA_DIR`):

| Path | Contents |
| --- | --- |
| `data/cyberdome.db` | SQLite database (all records, links, reviews, activity) |
| `data/evidence/<engagement>/<hash prefix>/<id>.bin` | Original evidence files, stored byte-for-byte |

## What a backup contains

A backup is a standard `.zip` file that Windows Explorer, macOS Archive Utility and `unzip` can all open:

- `manifest.json`: format version, schema version, creation time, and the size and SHA-256 of every file.
- `cyberdome.db`: a consistent database snapshot made with SQLite `VACUUM INTO`, so backing up while the server runs is safe.
- `evidence/…`: every stored evidence file.
- `README.txt`: short restore instructions.

The SHA-256 values detect accidental or deliberate changes after the backup was made. They do not by themselves prove authenticity or a complete forensic chain of custody.

## Creating a backup

Pick either option:

- **In the app:** go to Settings, then Backup & restore, and click **Download backup**. The server builds the zip on request; nothing is uploaded anywhere.
- **From the command line:** run `npm run backup`. It writes `./backups/cyberdome-backup-<timestamp>.zip`. Add `-- --out D:\safe\place\backup.zip` to choose the location.

Keep backups somewhere private. They contain your evidence. Don't commit them to GitHub.

## Restoring

Restore is command-line only, so a web page can never overwrite your data.

1. Stop the server (Ctrl+C in the terminal running `npm start`).
2. Run:

   ```
   npm run restore -- path/to/cyberdome-backup-<timestamp>.zip
   ```

   You can also pass an already extracted backup folder instead of the zip.
3. The script then:
   - reads the zip with a built-in reader, so you don't need an external unzip tool on Windows, macOS or Linux;
   - checks every file against `manifest.json` (SHA-256 and size), and **stops without changing anything** if a file is missing or altered;
   - refuses to run while something is listening on the configured port (default 4646), unless you add `--force`;
   - **renames** the current data directory to `data.before-restore-<timestamp>`, so nothing is deleted;
   - writes the snapshot database and evidence files into a fresh data directory.
4. Start the app again with `npm start`.

To check a backup without restoring it, run `npm run restore -- backup.zip --verify-only`.

## Limits

- ZIP64 archives (larger than 4 GB) aren't supported. Keep large PCAPs as references if the evidence set gets that big.
- Restoring a backup made by a **newer** app version (higher `format_version`) is refused. A backup with an older schema is migrated on the next start.
- After a successful restore, the moved-aside `data.before-restore-*` folder stays until you delete it yourself.
