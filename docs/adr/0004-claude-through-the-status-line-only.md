# ADR-0004: Claude limits come only from the Claude Code status line

Date: 2026-10-18
Status: superseded by ADR-0006
Deciders: Łukasz Sarna (owner)

### Context

Claude Pro and Max limits are not offered by a public API. Claude Code itself receives `rate_limits` and hands them to its status line command on standard input. The owner does not allow using the Claude login token or browser cookies.

### Decision

[statusline/ai-usage-statusline.sh](../../statusline/ai-usage-statusline.sh) runs as the Claude Code status line and writes `rate_limits`, a timestamp and a label to `$XDG_RUNTIME_DIR/ai-usage/claude-<label>.json` with mode 0600 through a temporary file and `mv -fT`. The widget reads these files with `head -c 65536`, skips symlinks and files not owned by the user, and shows the values as updated when Claude Code runs. The widget never starts Claude Code.

### Alternatives Considered

#### Alternative 1: call the private usage endpoint with the Claude Code OAuth token

- Pros: fresh numbers even while Claude Code is not running.
- Cons: uses a token and an endpoint that are not meant for other programs.
- Why not: the owner ruled it out.

#### Alternative 2: run `claude /usage` in a terminal and read its output

- Pros: no token handling in the widget.
- Cons: starts Claude Code on a timer and depends on terminal output that can change.
- Why not: the widget must never start Claude Code.

### Consequences

What gets easier and what gets harder because of this.

#### Positive

- No Claude credential is ever read, and the numbers are exactly what Claude Code shows.

#### Negative

- Values only move while Claude Code runs, and the files disappear at reboot because the runtime folder is temporary.
- Two Claude config folders whose last name part is the same write the same file.

#### Risks

- Another program could plant files in the runtime folder. The script refuses a runtime folder that the group or others can write, and both sides refuse symlinks and folders or files owned by another user.
