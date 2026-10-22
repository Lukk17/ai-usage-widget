# Decision records

Each record states one design decision of the AI Usage widget, the options that lost, and the consequences.

| Record | Title | Status | Date |
|---|---|---|---|
| [0001](0001-one-program-inside-the-widget.md) | One program inside the widget, no background service | accepted | 2026-10-18 |
| [0002](0002-curl-transport-through-the-executable-engine.md) | Service requests run through curl in the executable engine | accepted, one exception in 0005 | 2026-10-19 |
| [0003](0003-keys-in-the-secret-service.md) | Keys live only in the Secret Service | accepted, partly superseded by 0005 | 2026-10-18 |
| [0004](0004-claude-through-the-status-line-only.md) | Claude limits come only from the Claude Code status line | superseded by 0006 | 2026-10-18 |
| [0005](0005-keys-saved-through-the-kwallet-dbus-api.md) | Keys are saved through the KWallet D-Bus API | accepted, settings page superseded by 0006 | 2026-10-19 |
| [0006](0006-settings-inside-the-widget-and-accounts-by-id.md) | Settings inside the widget, accounts by id, nothing on by default | accepted | 2026-10-19 |

New records start from [template.md](template.md).
