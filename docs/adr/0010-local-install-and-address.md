# ADR 0010 - Local install, friendly address and update path

**Status:** accepted (2026-09-29). Builds on ADR 0008 (data separation and backups).

## Context

The owner is not a programmer and wants other small shops (also non-technical) to run the
app. Until now, running it meant installing Node from the internet by hand, opening a
command prompt, and typing `http://192.168.x.x:3000` (or `localhost:3000`) on every device.
Updating meant knowing which batch files to run in which order. None of that survives a
second shop.

## Decision

1. **Portable Node in `runtime\node`, downloaded by `Setup.bat`.** The official Windows x64 zip of the
   current LTS (24.x) is fetched from nodejs.org and its SHA-256 is checked against nodejs.org's
   `SHASUMS256.txt`. No admin rights, no system change, nothing to uninstall (delete the folder), and
   the app runs on a Node version we chose rather than whatever the PC has. Every launcher prefers
   `runtime\node`, else falls back to the system Node, so developers are unaffected.
2. **`http://<shopname>.local`, served on port 80 by a built-in mDNS responder.** Port 80 removes the
   `:3000`; mDNS (`server/lib/mdns.ts`, about 150 lines on `node:dgram`) removes the IP address. The
   responder answers only `<hostname>.local` (A records from the PC's current LAN IPs, an NSEC "no IPv6"
   for AAAA) and starts only in production with a configured hostname. If port 80 is busy or refused the
   server falls back to 3000 and logs the address. `/api/health` and Settings > Shop list the `.local`
   address and a `http://<LAN-IP>` fallback because some Android versions do not resolve `.local`.
3. **Firewall rules are the one elevated step.** Inbound TCP 80/3000 and UDP 5353 for the app's
   `node.exe` on Private networks. Setup asks first and elevates only `setup/firewall.ps1` (UAC prompt);
   declining leaves a working single-PC install and says plainly that other devices will not connect.
4. **Update = unzip over the folder + `Update.bat`.** It backs up (`db:backup`, abort on failure), stops the
   app, `npm ci`, builds, restarts. `data\` (database, backups, `shop.env`, logs) is not in the ZIP, so an
   unzip never overwrites it. Setup and Update stop the app before `npm ci` because Windows will not delete
   files a running process has open.
5. **Settings live in `data\shop.env`** (`SHOP_NAME`, `SHOP_HOSTNAME`), not in the database: the launchers
   and the server read it without opening SQLite, and it travels with the data folder. Env
   `SHOP_HOSTNAME` overrides it.

## Alternatives rejected (for now)

- **Docker Desktop:** needs admin, virtualization/WSL2, a licence for larger businesses, and a
  terminal when it breaks. Docker stays for the NAS deployment (which uses port 3000).
- **A real installer (MSI/Inno/Electron):** needs code signing to avoid SmartScreen warnings, a build
  and release pipeline, and someone to maintain it. Setup.bat is transparent plain text an owner's
  IT friend can read. Revisit when there are many shops.
- **Cloudflare Tunnel / a hosted domain:** gives HTTPS and remote access but adds an account, a
  domain, an outside dependency and a way for shop data to be reachable from the internet. This is a
  LAN-only app on plain http (CLAUDE.md); remote access can be added later on its own.
- **NetBIOS/LLMNR names or the PC's Windows name:** computer names are ugly ("DESKTOP-4F2K"), and
  phones do not resolve them. `.local` works on Windows 10+, macOS, iOS and most Android.
- **The `bonjour`/`multicast-dns` npm packages:** would work, but the project takes no new
  dependencies and the responder we need is small enough to unit-test with hand-built packets.

## Consequences

- Two shops on one network must choose different names (there is no conflict detection or probing).
- mDNS needs the PC on a network that allows multicast (some guest wifi does not); the IP address
  always works.
- Port 80 can be taken by IIS, Skype-era software and similar; the 3000 fallback keeps the app up.
- Setup relies on nodejs.org being reachable for the first install and each Node change.
- The Docker/NAS deployment is unchanged apart from `PORT=3000` in the image.
