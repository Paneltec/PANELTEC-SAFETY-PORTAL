---
title: Updating the Umbrel app
slug: updating-the-umbrel-app
order: 22
tags: [admin, updates, rollback, system]
last_updated: 2026-10-05
---

## Updating the Umbrel app

Administrators can install published Paneltec releases from **Settings → System → Paneltec app updates**, once the local updater has been set up by the host.

### Install an update

1. Save your work and tell other users that the app will briefly restart.
2. Open **Settings → System** and select **Check for updates**.
3. Compare the **Installed** version with the **Available release**. If the page says you are up to date, no installation is needed.
4. When a new release is available, select **Install update**, then **Install now**.
5. Keep the page open. Both images download before installation starts; the website and backend then restart. The page may briefly show that it is waiting to reconnect.
6. When the update reports success, select **Reload app**. Check that your usual pages open.

The button installs the latest successful build on the configured release branch. It does not create a new release or install a build that is still running. Check again later if a release has not finished building.

### Restore a previous version

After a successful update, **Restore previous version** is available while the previous app containers are retained. Save your work, select this button, then **Restore now**. Reload when restoration completes.

> Warning: This restores the previous website and backend images. It does not undo database changes or replace a data backup.

If an update fails its startup checks, the updater attempts to restore the previous version automatically. If it reports that recovery needs attention, ask your host to inspect Portainer before retrying.

### Scope and troubleshooting

- Only administrators see these controls. If the page asks for one-time setup, contact your host.
- The button updates the Paneltec website and backend on Umbrel. Updating Umbrel itself, MongoDB, the updater helper or server configuration still requires the host.
- The manual receives revised instructions with app releases; it does not write new instructions automatically. Its Contents list reflects the feature registry included in the installed app.
- Hosts should prepare a fresh deployment file before changing infrastructure. Reapplying an old Portainer YAML can revert app versions installed through this button.
