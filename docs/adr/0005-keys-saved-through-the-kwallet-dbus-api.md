# ADR-0005: Keys are saved through the KWallet D-Bus API

Date: 2026-10-19
Status: accepted, supersedes the manual store and the lookup attributes of ADR-0003. The settings page (KeySettings.qml), `entryList`, the synchronous `open` and Alternative 3 are superseded by ADR-0006.
Deciders: Łukasz Sarna (owner)

### Context

Storing each key with `secret-tool store` in a terminal was the hardest step of the install. A QML widget cannot send the Secret Service `CreateItem` call with the Plasma QML D-Bus module, but it can call the KWallet D-Bus API `org.kde.KWallet` on `org.kde.kwalletd6` at `/modules/kwalletd6`. An entry written this way gets the Secret Service attributes `server <folder>`, `user <entry>` and `type plaintext`, so `secret-tool lookup` still reads it.

### Decision

The Keys section of the widget settings ([package/contents/ui/KeySettings.qml](../../package/contents/ui/KeySettings.qml)) saves, replaces and removes keys through [package/contents/ui/WalletClient.qml](../../package/contents/ui/WalletClient.qml), the only file that imports `org.kde.plasma.workspace.dbus`. It uses one folder, `ai-usage`, with entries named `<provider>.<account>`, and always runs open, the action, then close. It lists entry names with `entryList` and never calls `readPassword`. It opens the wallet only while the settings page is open. Checks keep reading keys with `secret-tool lookup server 'ai-usage' user '<provider>.<account>' type 'plaintext'` straight into curl, as in [ADR-0002](0002-curl-transport-through-the-executable-engine.md). The message builders live in [package/contents/code/core/walletMessages.mjs](../../package/contents/code/core/walletMessages.mjs). The widget needs Plasma 6.4 or newer.

Superseded by [ADR-0006](0006-settings-inside-the-widget-and-accounts-by-id.md): the Keys section in `KeySettings.qml` was replaced by the settings inside the popup, `entryList` is no longer called, and the wallet is opened with `openAsync` instead of `open`.

### Alternatives Considered

#### Alternative 1: keep `secret-tool store` in a terminal

- Pros: the key never enters plasmashell memory.
- Cons: a manual step per key, with attributes the user has to type correctly.
- Why not: the owner wants the keys managed from the widget settings.

#### Alternative 2: run `secret-tool store` through the executable engine with the key on stdin

- Pros: no D-Bus code in the widget.
- Cons: the key still passes through plasmashell to reach the command's stdin, and the executable engine cannot write to a command's stdin, so the key would end up in the command line.
- Why not: a key in a command line is visible to every program in the process list.

#### Alternative 3: `openAsync` instead of `open` (superseded by ADR-0006, which now uses `openAsync`)

- Pros: does not wait for the wallet.
- Cons: the result arrives later, as the `walletAsyncOpened` signal.
- Why not at the time: the synchronous call looked simpler. ADR-0006 replaced it so that a handle that opens late is still closed.

### Consequences

What gets easier and what gets harder because of this.

#### Positive

- Keys are saved, replaced and removed from the widget settings, and saving adds the account and turns the service on.
- A locked wallet and a missing `kwalletd6` get their own messages.

#### Negative

- At Save the key passes once through plasmashell memory and over the session bus to `kwalletd6`. This is the only exception to ADR-0002, where a key never enters plasmashell.
- The widget now depends on KWallet and on Plasma 6.4 or newer.

#### Risks

- A program that watches the session bus could see the key during Save. The session bus belongs to the user, so such a program already runs as the user, the same limit that ADR-0003 states for the Secret Service.
- With the synchronous `open` (superseded by ADR-0006), a wallet left locked with its unlock dialog open made the D-Bus call fail with NoReply after about 25 seconds, and the wallet could then open later without a handle coming back to the widget.
