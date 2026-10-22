# ADR-0007: Accounts in the widget's own settings file

Date: 2026-10-22
Status: accepted, replaces the storage part of ADR-0006
Deciders: Łukasz Sarna (owner)

### Context

Until now the account list and the refresh choice lived in the applet settings (`Plasmoid.configuration`), which Plasma keeps in the `[Configuration]` group of that one widget in `plasma-org.kde.plasma.desktop-appletsrc`. Applying a Global Theme layout deleted the panel configuration, and the widget lost its 10 accounts. The keys stayed in KWallet, but without the list nothing pointed to them. The same happens when a panel is rebuilt or the widget is removed and added again, and a second copy of the widget (for example one in the panel and one on the desktop) had its own separate list. The owner asked on 2026-10-22 for one settings file of the widget that survives these resets and that every copy shares.

### Decision

1. The account list and the refresh choice live in `ai-usage-widgetrc` in the KDE config folder (`${XDG_CONFIG_HOME:-~/.config}`), group `[General]`, keys `accounts` (the same JSON list as before) and `refreshSeconds`. The name follows the KDE way of naming a config file after its program with `rc` at the end, like `plasmashellrc` and `kwinrc`. Keys never go into this file, they stay in KWallet as in ADR-0005.
2. The widget reads and writes the file with `kreadconfig6` and `kwriteconfig6` through the executable engine, the same route as every other command (ADR-0002). Plasma 6.7.5 has no QML type for an arbitrary KConfig file: the `org.kde.config` module of KConfig 6.30 exports only `KAuthorized` and `KWindowStateSaverQuick` (measured in the test image), and `Plasmoid.configuration` always points at the applet group.
3. The account list reaches the shell only as base64 text, which `base64 -d` turns back into the value that `kwriteconfig6` writes. No name or email is ever placed in the command text, so no name can break or change the command. The decoded list is an argument of `kwriteconfig6` for the moment it runs, the same as any other settings value.
4. Every write reads the file back in the same command and counts only when the file holds the new value. This was needed because `kwriteconfig6` exits with 0 when it cannot write into a read only folder (measured in the test image).
5. Every change (add, edit, delete, reorder, refresh choice) first reads the file, applies the change to what the file holds now, then writes it. Changes of one widget copy run one after another. Each copy also reads the file every 30 seconds, so a change made in one copy shows in the others.
6. Migration: when the file has no `accounts` key and the applet settings have at least one account, the widget copies the applet accounts, and the applet refresh choice when the file has none, into the file once. When both have accounts, the file wins. The applet settings are never changed or cleared. An empty list in the file (`accounts=[]`) counts as present, so accounts deleted after the move never come back from the applet copy.
7. When the file cannot be read (for example `kreadconfig6` is missing), the widget shows the applet accounts and every change says it could not be saved. When the copy into the file does not stick, the widget keeps working with the applet accounts and tries again on the next read.
8. When a new account with a key is added and the file then refuses the list, the key is removed from KWallet again, so no key stays in the wallet without an account.

### Alternatives Considered

#### Alternative 1: Keep the applet settings

- Pros: no extra file and no extra commands.
- Cons: the list is lost with every layout reset, panel rebuild or new widget copy, and every copy has its own list.
- Why not: that loss is the reason for this decision.

#### Alternative 2: The applet global settings (`Plasma::Applet::globalConfig`)

- Pros: shared by every copy of the widget, kept by Plasma itself.
- Cons: only reachable from C++, and it is kept in an `AppletGlobals` group of the Plasma applet settings (the group name is in libPlasma 6.7.5), the same settings that a layout reset replaces.
- Why not: a plain QML widget cannot reach it, and it would not survive the reset.

#### Alternative 3: Write the file with shell tools such as `printf` into `~/.config`

- Pros: no `kwriteconfig6` and no base64 step.
- Cons: the widget would have to write the KConfig format, its escaping and its locking itself.
- Why not: `kwriteconfig6` and `kreadconfig6` come with every Plasma install and already handle the format.

#### Alternative 4: A JSON file of the widget's own under `~/.local/share`

- Pros: any format the widget likes.
- Cons: still needs a shell write, is not where KDE users look for settings, and is not covered by KConfig tools or backups of `~/.config`.
- Why not: a KConfig file in the config folder is the KDE convention.

### Consequences

#### Positive

- The accounts survive Global Theme layouts, panel rebuilds and removing and adding the widget again.
- Every copy of the widget shows the same accounts and the same refresh choice.
- The file can be read, backed up and restored like any other KDE settings file.

#### Negative

- Every settings change runs two short commands (write and read back) instead of a property change, so a change takes a fraction of a second and the settings page is busy during that time.
- Each widget copy reads the file every 30 seconds, one small command each time.
- A change in another copy can take up to 30 seconds to show.

#### Risks

- Two copies that change the file at the same moment can still overwrite each other, because the read and the write are two steps. Changes are rare and each one reads first, so the window is a fraction of a second.
- An administrator can lock the file with `[$i]`. The widget then shows that the change could not be saved and keeps the file as it is. A QML test covers this.
