# ADR-0001: One program inside the widget, no background service

Date: 2026-10-18
Status: accepted
Deciders: Łukasz Sarna (owner)

### Context

The widget shows usage for several services and accounts. Somebody has to call each service on a timer, keep the latest answer and turn errors into states the popup can show. The owner wants nothing on disk except the Claude status files, and as few moving parts as possible on the desktop.

### Decision

The plasmoid itself checks every service on a timer from [package/contents/ui/UsageController.qml](../../package/contents/ui/UsageController.qml), keeps the latest values in memory in [package/contents/code/core/monitor.mjs](../../package/contents/code/core/monitor.mjs), and writes nothing to disk. All parsing and scheduling lives in plain JavaScript modules that also run in Node for the unit tests.

### Alternatives Considered

#### Alternative 1: a user systemd service that writes a JSON file the widget reads

- Pros: checks keep running while plasmashell restarts, and other programs could read the file.
- Cons: a second program to install, start and update, plus a file on disk with usage data.
- Why not: the owner asked for one program and no stored values.

#### Alternative 2: a helper in Python or another language started by the widget

- Pros: a full standard library for HTTP and JSON.
- Cons: one more runtime to install and keep compatible, and a second place where logic lives.
- Why not: the QML engine already runs the JavaScript modules, so the helper adds a dependency for no gain.

### Consequences

What gets easier and what gets harder because of this.

#### Positive

- Install is one `kpackagetool6` command, there is nothing to start or stop.
- The same modules are tested in Node and in the Qt engine.

#### Negative

- Checks stop while plasmashell is not running, and values are lost when it restarts.
- No history: only the latest answer per account is kept.

#### Risks

- A blocking call would freeze the panel. Every command runs asynchronously through the executable engine with a timeout, see [ADR-0002](0002-curl-transport-through-the-executable-engine.md).
