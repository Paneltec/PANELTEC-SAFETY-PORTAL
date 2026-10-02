# Self-hosting the Paneltec Safety Portal (Umbrel + Portainer)

> **Umbrel note:** the setup actually running on the Umbrel is `deploy/umbrel-test.yml`
> (host networking, Watchtower for updates, web on http://umbrel.local:3951).
> The generic `docker-compose.*.yml` files below suit a normal Docker host.

Two copies run side by side on the Umbrel:

| Copy | Portainer stack | Compose file | Web address (LAN) | Emails/SMS |
| --- | --- | --- | --- | --- |
| Test | `paneltec-test` | `deploy/docker-compose.test.yml` | http://192.168.3.15:3951 | blocked (Comms Safe Mode on) |
| Live | `paneltec-live` | `deploy/docker-compose.live.yml` | http://192.168.3.15:3950 | normal |

## How updates flow

1. A change is pushed to the `test` branch on GitHub.
2. GitHub Actions (`.github/workflows/build-images.yml`) builds two images,
   `ghcr.io/paneltec/paneltec-safety-portal/backend:test` and `.../web:test`
   (amd64 + arm64), in about 15–25 minutes.
3. Portainer's automatic update (every 5 minutes, with *re-pull image*) picks
   them up and restarts only what changed.
4. When the test copy is approved, `test` is merged into `live` and the same
   thing happens for the live copy.

Nothing in Portainer has to be edited for normal updates.

## Stack settings (Portainer → stack → Environment variables)

| Name | What it is |
| --- | --- |
| `PUBLIC_URL` | The address people open, e.g. `http://192.168.3.15:3951` or later `https://test.paneltec.com.au` |
| `DB_NAME` | Database name (default `paneltec`) |
| `JWT_SECRET` | Copy from Emergent to keep sign-ins, or a new 64-character random value |
| `PANELTEC_VAULT_SECRET` | Copy from Emergent (unlocks saved logins in the Apps Directory) |
| `INTEGRATIONS_ENC_KEY` | Copy from Emergent (unlocks Navixy/Simpro/M365/etc. keys) |
| `BACKUP_DEST_ENC_KEY` | Copy from Emergent (unlocks the saved NAS backup password) |
| `ANTHROPIC_API_KEY` | Your own Anthropic key for the AI features (replaces Emergent's AI key) |
| `TIGRIS_*` | Only if you use Tigris storage on Emergent |
| `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET` | From the Dropbox App Console (the "Paneltec" app). Needed for Settings → Dropbox. After setting them, add `https://<this copy's address>/dropbox/callback` to the app's Redirect URIs in the Dropbox App Console, then click Connect in Settings → Dropbox. The tokens are then kept in the database. |
| `DROPBOX_TEAM_FOLDER_ID`, `DROPBOX_TEAM_FOLDER_NAME` | Optional; defaults to the Paneltec-General Administration team folder. |
| `SMARTFILL_API_URL`, `SMARTFILL_API_KEY`, `SMARTFILL_API_SECRET` | Optional. SmartFill fuel credentials (Fleet → Fuel Reports). Not needed if an admin enters them in the app under Settings → Integrations → SmartFill — the app stores them encrypted and uses them on any host. Env values win if both are set. |

Keep these in Portainer only. Never put them in GitHub.

## Moving data from Emergent

Emergent → Settings → Backup → download the latest snapshot `.zip`, then in
the self-hosted copy: Settings → Backup → Restore, and upload that zip.

## What differs from Emergent

* AI (Ask Intelligence, AI SWMS, hazard photo check) calls Anthropic directly
  through `deploy/shims/emergentintegrations` using `ANTHROPIC_API_KEY`.
* The "Made with Emergent" badge, Emergent's editor script and its analytics
  are removed from the self-hosted website.
* The phone viewer loads the phone app from `/m/` on the same server.
