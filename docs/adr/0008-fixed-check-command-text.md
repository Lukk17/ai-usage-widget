# ADR-0008: The check command text stays the same on every check

Date: 2026-11-20
Status: accepted, amends the boundary part of ADR-0002
Deciders: Łukasz Sarna (owner)

### Context

A memory copy of the owner's plasmashell, taken on 2026-11-20 after 3 days and 7 hours of uptime, showed 2,987 MB of private anonymous memory, and about 1,680 MB of that was copies of check command text (274,991 copies stored as UTF-16 text and 549,962 as plain text). The owner's plasmashell grew by about 80 MB per hour. [package/contents/ui/CommandRunner.qml](../../package/contents/ui/CommandRunner.qml) runs every command through the Plasma5Support executable engine, where the command text is the source name. In Plasma5Support 6.8.3 (`src/declarativeimports/datasource.cpp`) the `DataSource` keeps its data in a `QQmlPropertyMap` keyed by source name. `disconnectSource()` does not remove the key, and `QQmlPropertyMap::clear()` never removes keys either, so every distinct command text stays in plasmashell memory until plasmashell restarts. The check command held a random boundary made in JavaScript by `newBoundary()`, so every check added a new key. The same bug was reported for another widget in izll/plasma-claude-usage issue 35, where "each payload stays in memory for the lifetime of the DataSource". The boundary itself has to stay: it stops a response body from forging the `begin`, `end`, `curl` and `lookup` lines.

### Decision

1. `buildCheckCommand()` in [package/contents/code/core/curlCommand.mjs](../../package/contents/code/core/curlCommand.mjs) puts no random value into the command. Right after the safe start, the shell makes the boundary with `boundary=aiu$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n')`, which gives `aiu` and 24 lowercase hex digits. `boundary` joins the `unset` list of the safe start.
2. When the boundary is not 27 characters long, or holds anything but hex digits after `aiu` (for example `od` or `tr` is missing or fails), the shell exits before the wallet search, the key lookup and curl.
3. The shell prints the boundary as the first line of standard output, before anything else runs, so no server answer can change it, and it is never sent to a server. Every marker `printf` and the curl `-w` format read it from `"$boundary"`.
4. `parseCheckOutput()` reads the boundary from the first line, checks it against `BOUNDARY_PATTERN` and looks for markers only after that line. A missing or invalid first line becomes "cannot connect" with the reason `COMMAND_FAILED` ("the check could not run"), because the command stopped before it reached the wallet or a service.
5. The command text now depends only on the service, the account and, for OpenAI API, Anthropic API and Hugging Face, the start of the current month in their report URLs.

### Alternatives Considered

#### Alternative 1: A fixed boundary in the command

- Pros: the smallest change, and no new tools.
- Cons: the boundary is public, so a response body can print the marker lines and fake a status, a curl code or a lookup result.
- Why not: it gives up the protection the random boundary exists for.

#### Alternative 2: A new temporary DataSource per command, destroyed after use

- Pros: suggested in izll/plasma-claude-usage issue 35, the command text can stay as it is, and the property map goes away with the object.
- Cons: every check creates and loads a new engine consumer. Every path, including timeouts and errors, has to destroy the object, and a missed destroy keeps the object, its map and the source in the engine's own source list.
- Why not: the fix depends on cleanup being right on every path, while a fixed command text keeps the map small by design.

#### Alternative 3: Pass the changing parts through a file

- Pros: the command text stays fixed while JavaScript still picks the boundary.
- Cons: a file write for every check, a safe temporary path, its permissions and its cleanup. Another process that can read or replace the file could learn or fix the boundary. The widget would no longer write nothing to disk except its settings.
- Why not: more risk and more moving parts than making the boundary inside the same shell.

### Consequences

#### Positive

- The property map holds one entry per account and month instead of one per check, so its size is bounded.
- The boundary is still different on every run, unknown to the server and made before any server answer arrives.

#### Negative

- The widget now also needs `od` and `tr` from coreutils.
- The settings write command still has a unique text for each settings change, because it carries the base64 encoded value (ADR-0007). Each change adds one entry. Changes are rare and made by the user.
- The OpenAI API, Anthropic API and Hugging Face commands change once a month, which adds one entry per such account per month until plasmashell restarts.
- The boundary is in the curl argument list (`-w`) while curl runs, as it was before when it was part of the shell command.

#### Risks

- A broken `od` or `tr` makes every remote check fail with "the check could not run". Unit tests cover a missing `od`, a failing `od` and wrong `od` output, and check that the shell stops before the Secret Service and curl.
- [package/contents/ui/CommandRunner.qml](../../package/contents/ui/CommandRunner.qml) joins callers of the same command text into one run. The monitor never starts a second check of an account while one is running, the runner timeout is longer than all the timeouts inside the command together, and the settings reads and the local file reads already run the same command text again and again through this runner.
