# Migraine Tracker

Blazor WebAssembly PWA for logging migraines in a plain-text journal format:

```
11/2 - 4 9:15am. Turned 6 2pm. Ibuprofen 3pm.
11/1
(Emgality 29)
10/31 - Woke 4.5. Tylenol 8am.
```

- **Log**: tap 1–10 to write today's line (`+ .5` and `Woke with it` modify the next tap). A second tap the same day adds `Turned X`. Missing days are filled in as blank lines (no migraine).
- **Graph**: daily peak pain + 7-day average, Emgality markers. Pinch/drag to zoom and pan.
- **Notes**: the raw journal, editable.
- **Sync**: the journal is saved on the device and synced to a secret GitHub Gist (`migraine-journal.txt`) using a token with only the `gist` scope.

## Run locally

```
cd MigraineTracker && dotnet run
```

## Deploy

Push to `main` on GitHub. In the repo, set **Settings → Pages → Source** to **GitHub Actions**.
The workflow in `.github/workflows/deploy.yml` publishes to `https://<user>.github.io/<repo>/`.

Journal `.txt` files are git-ignored. Health data never goes in this repo.
