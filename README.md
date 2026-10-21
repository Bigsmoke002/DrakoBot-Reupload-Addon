# DrakoBot-Reupload-Addon

> ⚠️ **Archived test project**
>
> This repository was a private test project (May 2025) and is provided here as an
> archive only. It is **not maintained** and there is **no support**.
> **No guarantee is given that anything works** – use at your own risk.
>
> This is an **unofficial** addon. It is not affiliated with or endorsed by the
> developers of Drako Bot. Drako Bot itself is **not** included.

## What is it?

A content control addon for Drako Bot (discord.js v14) with two small web apps:

- **Reupload** (`server.js`): messages with links, images, GIFs, files or custom file
  types are re-posted by the bot (optionally with the uploader's tag) and the original is
  deleted. Includes spam protection and size limits based on the server boost level.
- **Lockdowns**: *total lockdown* deletes every message, *partial lockdown* deletes
  messages with links/attachments.
- **Admin web UI** (port `5050`): configuration, event log (view/download),
  approval queue for anonymous uploads.
- **Anonymous upload portal** (`anonymous_upload_portal.js`, port `6060`): people can
  submit links or files anonymously; with manual approval they land in a queue, otherwise
  they are posted directly to configured channels.
- **Commands**: `/listuploads [user]` and `/deleteuploads <user> [all] [count]` (Administrator).

> Note: the bot replies and code comments are partly in **German**.

## Setup (rough outline)

1. Copy the folder into your Drako Bot addons folder.
2. `npm install` (`express`, `ejs`, `multer`, `axios`, `discord.js`, `@discordjs/builders`).
3. The addon expects the Discord client as `global.client` before `server.js` and
   `anonymous_upload_portal.js` are loaded.
4. `config.json` is created on first start; set `discord.guildId` and the
   `anonymousUpload.postChannels` channel IDs, or use the admin web UI.

## ⚠️ Security notice

- The **admin web UI has no authentication**. It only listens on `127.0.0.1` by default
  (override with `REUPLOAD_ADMIN_HOST`) – never expose it without authentication.
- The anonymous upload portal is meant to be public. Uploaded files are not scanned;
  use manual approval.

## Changes compared to the original private version

- Personal server and channel IDs were removed (`config.json` is created with empty values).
- **Fixed a path traversal** in the admin approve/delete routes: a file name like
  `../config.json` could move/post or delete arbitrary files.
- **Fixed anonymous file uploads**: a `multer().none()` pre-parser rejected every file
  with "Unexpected field"; only link submissions worked.
- **Fixed `/listuploads` and `/deleteuploads`**: they read a different log file/format
  than the server writes, and the ID of the re-posted message was never logged.
- Fixed the discord.js v14 permission flag in `/deleteuploads` (`ADMINISTRATOR` → `Administrator`).
- The admin web UI binds to `127.0.0.1` by default; added `package.json`.

## Known state

Briefly tested (October 2026, Node.js 26, discord.js 14.27, mocked Discord client):
admin UI pages, link reupload (re-post + delete original + log entry), `/listuploads`,
`/deleteuploads` (permission check and deleting the re-posted message), anonymous link and
file upload into the approval queue, approving a file, rejected traversal attempts,
admin UI not reachable from the LAN.
Not tested against a real Drako Bot installation or a live Discord server.

## License

[MIT](LICENSE)
