# ADR-0003: Keys live only in the Secret Service

Date: 2026-10-18
Status: accepted, the manual store and the lookup attributes are superseded by ADR-0005
Deciders: Łukasz Sarna (owner)

### Context

Each service and account needs a secret key. Plasmoid settings are stored in plain text in `~/.config/plasma-org.kde.plasma.desktop-appletsrc`, which backup tools and dotfile repositories copy freely.

### Decision

Keys are stored only in the Secret Service (KWallet on the owner's desktop) under the attributes `service ai-usage`, `provider <id>` and `account <label>`, and are read with `secret-tool lookup` for every check. The widget configuration holds only account labels, switches and intervals. Labels must match `^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$` before any command is built.

### Alternatives Considered

#### Alternative 1: a password field in the plasmoid settings

- Pros: easiest for the user, no extra command.
- Cons: the key lands in plain text in the applet configuration file.
- Why not: the owner ruled out secrets in the configuration.

#### Alternative 2: a separate encrypted file owned by the widget

- Pros: works without a Secret Service.
- Cons: the widget would need its own key management and a file on disk.
- Why not: the desktop already has a Secret Service, and the owner wants nothing stored by the widget.

### Consequences

What gets easier and what gets harder because of this.

#### Positive

- Keys are protected at rest and from other users, and the configuration file can be shared safely.

#### Negative

- The user stores each key by hand with `secret-tool store`.
- The Secret Service does not protect keys from other programs that run as the same user.

#### Risks

- A locked wallet looks like a missing key to `secret-tool`. The widget says "no key in the Secret Service, or the wallet is locked", and shows a separate message when the Secret Service does not answer or is not running.
