# KDE Store listing

The texts and field values for the AI Usage page on the KDE Store, category Plasma 6 Extensions > Plasma 6 Applets. The pictures are in [docs/store-assets](store-assets).

---

### 1. Product name

| Number | Name | Characters | Reason |
|---|---|---|---|
| 1.1 | AI Usage | 8 | The same name as `Name` in [package/metadata.json](../package/metadata.json), so the store page, the Get New Widgets dialog and the widget picker all show one name. |
| 1.2 | AI Usage Monitor | 16 | Says that the widget watches usage over time, not only once. |
| 1.3 | AI Usage and Limits | 19 | Names the two things people look for: how much they used and how close they are to a limit. |
| 1.4 | AI Quota Meter | 14 | Short and easy to remember, but "quota" fits the spend services less well. |
| 1.5 | AI Usage for Plasma | 19 | Makes clear where it runs when the page is shared outside the KDE Store. |

Recommendation: 1.1, AI Usage. It needs no change in the package and people find the same name everywhere. Any other choice should also change `Name` in [package/metadata.json](../package/metadata.json) before the upload.

---

### 2. Description

AI Usage shows how much of your AI plans and budgets you have used, for several services and several accounts, in one panel popup or on the desktop.

What it shows

1. Usage bars for 5 hour, daily, weekly and monthly limits, with the time each one resets.
2. Spend this month, balance, included credits left and budget left, where a service reports them.
3. Token counts and plan details as extra rows.
4. Yellow and red values when a limit gets close, and a clear message per account when a check fails (cannot connect, key rejected, rate limited, unexpected answer, no key).

Services

1. Claude and ChatGPT: read from the files the Claude desktop app and Codex already keep on your computer. No key and no login.
2. JetBrains AI: read from the log of your JetBrains IDE. No key.
3. OpenAI API, Anthropic API, xAI API, OpenCode Go, OpenCode Zen, MiniMax, Requesty and Hugging Face: checked with a key you add in the widget settings.

You can add several accounts for one service, change their order and edit or delete them inside the popup. A help button next to the key field says which key each service needs and where to create it. Nothing is turned on until you add an account.

Privacy

1. Keys are saved only in KWallet. They are never written to a plain file or put on a command line.
2. The widget talks to nothing except each service's own address, for example api.openai.com for the OpenAI API. There is no server of its own, no tracking and no telemetry.
3. The local files of Claude, Codex and JetBrains are only read, never changed.
4. The latest values stay in memory. The widget writes nothing to disk except its own settings.

Requirements

1. KDE Plasma 6.4 or newer.
2. curl 8.4 or newer.
3. KWallet, secret-tool (libsecret), gdbus (glib2), timeout and GNU find.

The MiniMax and OpenCode Go addresses and the Claude, Codex and JetBrains file formats are not public. When they change, only that account shows an error.

License: GPL-3.0-or-later.

---

### 3. Changelog for 1.0.0

1. First release.
2. Usage, limits and spend for Claude, ChatGPT, OpenAI API, Anthropic API, xAI API, OpenCode Go, OpenCode Zen, MiniMax, Requesty, Hugging Face and JetBrains AI.
3. Several accounts per service, added, edited, reordered and deleted inside the popup.
4. Keys saved in KWallet, with an Unlock KWallet button when the wallet is locked.
5. Estimated reset times for Claude.
6. One refresh setting for all accounts, 30 seconds by default, and a backoff when a service limits requests.
7. Yellow and red values that stay readable on light and dark themes.

---

### 4. Tags

```text
ai, usage, quota, limits, spend, api, monitor, kwallet, claude, openai, plasma6, applet
```

---

### 5. Version

```text
1.0.0
```

---

### 6. Form fields

| Number | Field | Value |
|---|---|---|
| 6.1 | Category | Plasma 6 Extensions > Plasma 6 Applets |
| 6.2 | Product name | AI Usage, see 1.1 |
| 6.3 | Original | Yes, this is the original work of the author |
| 6.4 | License | GPL-3.0-or-later, the same as [LICENSE](../LICENSE) |
| 6.5 | Version | 1.0.0 |
| 6.6 | Source link | `https://github.com/Lukk17/ai-usage-widget` |
| 6.7 | Logo | [docs/store-assets/ai-usage-logo-512.png](store-assets/ai-usage-logo-512.png), source [docs/store-assets/ai-usage-logo.svg](store-assets/ai-usage-logo.svg) |
| 6.8 | Tags | See 4 |
| 6.9 | Description | See 2 |
| 6.10 | Changelog | See 3 |

The license is GPL-3.0-or-later, with the full text in [LICENSE](../LICENSE). The description line in 2, field 6.4, `License` in [package/metadata.json](../package/metadata.json), `license` in [package.json](../package.json) and the license badge and section in [README.md](../README.md) all say the same. A later license change starts in LICENSE and updates these places.

---

### 7. Gallery pictures

All pictures are rendered in an isolated container from the widget code with made-up accounts and numbers only.

| Number | File | Caption |
|---|---|---|
| 7.1 | [docs/store-assets/screenshot-1-accounts.png](store-assets/screenshot-1-accounts.png) | Claude, OpenAI API, OpenCode Go, Hugging Face and JetBrains AI in one popup |
| 7.2 | [docs/store-assets/screenshot-2-settings.png](store-assets/screenshot-2-settings.png) | Settings: refresh time and the account list, with reorder, edit and delete |
| 7.3 | [docs/store-assets/screenshot-3-add-account.png](store-assets/screenshot-3-add-account.png) | Add account, with the help that names the key and where to create it |
| 7.4 | [docs/store-assets/screenshot-4-warning.png](store-assets/screenshot-4-warning.png) | Red and yellow values when a limit gets close |
| 7.5 | [docs/store-assets/screenshot-5-empty.png](store-assets/screenshot-5-empty.png) | Nothing is on until you add an account |
