# ADR-0002: Service requests run through curl in the executable engine

Date: 2026-10-19
Status: accepted, with one exception for saving keys in ADR-0005
Deciders: Łukasz Sarna (owner)

### Context

The first transport used the QML `XMLHttpRequest`, which followed a redirect and sent the key to the other host. It also needs the key inside plasmashell memory to set the header, and it has no size limit on the answer.

### Decision

Every check is one shell pipeline run by the Plasma5Support executable engine, built in [package/contents/code/core/curlCommand.mjs](../../package/contents/code/core/curlCommand.mjs). It reads the key with `timeout 10 secret-tool lookup` into a shell variable, refuses an empty key or a key that contains a space, a line break or a character that is not plain ASCII, and pipes the header line into `curl -H @-` on standard input with a constant `printf` format. The command first runs `ulimit -c 0; set +a +x +v; unset SSLKEYLOGFILE`. curl runs with `--disable --globoff --tlsv1.2 --proto =https --max-redirs 0 --max-time 20 --max-filesize 1048576` inside `timeout 25`, without `-L`, and `-w` prints the HTTP status and `Retry-After` after a random boundary. Only constant URLs and headers, provider ids and checked account labels go into the command, each in single quotes. A `3xx` answer becomes "unexpected answer".

### Alternatives Considered

#### Alternative 1: keep XMLHttpRequest and check the final URL after the request

- Pros: no external program.
- Cons: the key has already been sent to the other host by the time the widget sees the redirect, and the key stays in plasmashell memory.
- Why not: it cannot prevent the leak, only notice it.

#### Alternative 2: a C++ plugin with QNetworkAccessManager and a redirect policy

- Pros: full control over redirects and sizes inside Qt.
- Cons: a compiled plugin per Qt version, which breaks the one `kpackagetool6` install.
- Why not: far more to build and ship than a shell pipeline that curl already secures.

### Consequences

What gets easier and what gets harder because of this.

#### Positive

- The key never enters plasmashell memory or any process argument list, and a redirect cannot carry it to another host.
- Size, time and protocol limits are enforced by curl, not by widget code.

#### Negative

- The widget now needs `curl` and `timeout` on the machine.
- Account labels appear in the process list while a check runs.
- The key sits for a moment in the memory of `secret-tool`, the short shell and curl. The shell starts with `ulimit -c 0`, which also applies to `secret-tool` and curl and tells systemd-coredump not to store their dumps.

#### Risks

- A `~/.curlrc` could change curl behaviour. `--disable` as the first argument makes curl ignore it.
- curl still honours the proxy and certificate variables of the session (`HTTPS_PROXY`, `CURL_CA_BUNDLE`, `SSL_CERT_FILE`, `SSL_CERT_DIR`). Whoever can set those variables for plasmashell can route the requests through their own proxy or trust their own certificate.
- A changed curl output format would break parsing. The exit code and the boundary lines are parsed strictly, and the container suite runs the real curl from the pinned Arch Linux Archive snapshot.
