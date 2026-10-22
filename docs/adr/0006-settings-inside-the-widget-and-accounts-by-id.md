# ADR-0006: Settings inside the widget, accounts by id, nothing on by default

Date: 2026-10-19
Status: accepted, supersedes ADR-0004 and the settings page of ADR-0005
Deciders: Łukasz Sarna (owner)

### Context

The owner rejected the earlier design on 2026-10-19. Settings were split between the Plasma configure dialog (on and off, account labels and a polling interval per service) and a Keys section, Claude was on by default and came from a status line script, and each card showed check times. The owner asked for one place to manage accounts, inside the popup, with the same view on the desktop, a single refresh choice, nothing turned on until an account is added, and cards that show only the service, the account and its limits or money. The owner also added OpenAI, xAI, Hugging Face, JetBrains AI, ChatGPT limits from Codex and the Claude desktop app file, and asked that every test runs in a container that shares nothing with the host.

### Decision

1. The popup top bar has a refresh button and a settings button. The settings view lists the accounts with Edit and Delete, offers Add account, and holds the refresh choice (30 seconds by default, or 1, 5, 15, 30 or 60 minutes). The widget has no page in the Plasma configure dialog.
2. An account is a record `{ id, service, name }` plus the fields its service needs (`teamId` for xAI, `org` for Claude). The id is generated (`a` plus 12 hex digits), so the free text name or email never reaches a shell command, a URL or a wallet entry name. All accounts live as one JSON string in the `accounts` setting, which is empty by default.
3. A key is saved in KWallet as `<service>.<id>` through the existing D-Bus code before the account is stored. Delete removes the wallet entry first, and keeps the account when KWallet refuses.
4. Each service is a provider of one of two kinds. A remote provider reads its key with `secret-tool` straight into `curl`, as in ADR-0002. A local provider runs one fixed read only command: Claude reads `~/.config/Claude/plan-usage-history.json`, ChatGPT reads the last rate limit line of the newest Codex session file, JetBrains AI reads the tail of each `idea.log` and cuts out the license and quota ids in the shell.
5. A card shows the service name and the account name or email the owner typed, then a main section and the additional rows, laid out the same way for every service (see the owner decisions below). It shows no check times, no next try time and no highest use. An Unlock KWallet button shows when a check found the Secret Service locked or silent, or a settings action found KWallet locked.
6. The tests copy the source into the images at build time, run with `--network none`, all capabilities dropped, no devices, no volumes and no host D-Bus, copy their results out with `docker cp`, and remove the containers and images at the end.

### Changes after the first review

1. Local reads skip symbolic links, compare the real byte size from `wc -c` with the cap, and run every tool inside `timeout 8`. The command runner never starts a second copy of a command that is still running.
2. ChatGPT walks at most the 20 newest session files and uses the first rate limit line it finds. Without `resets_at` the reset time is the line time plus `resets_in_seconds`.
3. JetBrains AI keeps only the line time and the `tariffQuota` and `topUpQuota` parts in the shell (an allow list), instead of cutting out known ids.
4. Claude reads from `${XDG_CONFIG_HOME:-$HOME/.config}`.
5. A pasted key is trimmed before it is saved. The service box starts with no service, so nothing is read before the owner picks one. Closing the settings clears the status text (the form itself is kept, see the owner answers below).
6. Form rule texts, discovery texts and adding several Claude accounts moved out of QML into `formatter.mjs` and `accountActions.mjs`.
7. The test containers also get `--pids-limit 512`, `--memory 2g` and `--cpus 2`, run as user id 10001, run fixture commands with `sh`, check every host mapping line, delete only their own result folders, and fail when `docker cp` fails.

### Owner decisions of 2026-10-19

1. The panel shows only the icon, with the plain accessible name "AI usage". No number.
2. Spend services (OpenAI API, Anthropic API, xAI API, OpenCode Zen, Requesty and Hugging Face) are asked at most every 5 minutes, also by the refresh button. Subscription limits follow the refresh choice.
3. Every card, Hugging Face included, shows the name the owner typed.
4. ChatGPT with no Codex session file shows its card with "No Codex session found". The widget never hides a card the owner added.
5. One layout for every provider. The main section has bars labelled exactly 5hr, daily, weekly and monthly, with reset times where given, or Balance and Spent this month for pay per use. When a service has several entries for one period (MiniMax models, OpenCode Zen members), the main bar is the entry closest to its limit, preferring entries with plan details that have not expired. Every other entry, every window of another length and the JetBrains top-up go to the additional rows, together with token counts, plan and billing mode. There are no note lines.
6. Anthropic API is for team organizations with an Admin API key only, and its help text says so.
7. The locked check asks `org.freedesktop.Secret.Service.SearchItems` through `gdbus call`, which returns the unlocked and the locked items without loading a secret, instead of matching a message of `secret-tool search`.
8. Every text a service sends (model names, plan names, member names, currency, billing mode) is cut to 64 characters, and MiniMax is limited to 50 models like OpenCode Zen to 50 members.
9. The wallet is opened with `openAsync`, and the handle from the `walletAsyncOpened` signal is always closed, also when it comes after the widget stopped waiting (120 seconds). The test kwalletd (Secret Service backend) sent no `walletAsyncOpened` at all when the open failed on a locked keyring, so the widget then waits the full time before it says KWallet did not answer. How a real KWallet answers a Cancel in its password window is not measured.
10. The widget needs Plasma 6.4 or newer: the QML `SignalWatcher` and `asyncCall` with result callbacks first appear in plasma-workspace 6.3.90, and 6.4.0 is the first stable release with both.

### Changes after the second review

1. The test runner accepts only `test-results` inside the project or a folder below the temp folder, and stops when the host mapping output is empty or wrong.
2. Every local read runs inside one `timeout 9 sh -c`, prints the real byte count of what it found, and is compared by bytes.
3. The locked check reports locked only when SearchItems finds no unlocked copy and at least one locked copy.
4. While a wallet call waits for KWallet, the popup says so. Claude discovery says when at least one name is still needed.
5. The panel tooltip shows only the widget name.

### Owner answers of 2026-10-19

1. The Add or Edit form keeps what was typed (service, name or email, key, team ID) until Save succeeds or the owner presses the form's own Cancel. Closing the settings with the gear button or closing the popup keeps the form, and a failed save keeps the key in the field.
2. The wait for KWallet can be cancelled with the form's Cancel or with the Cancel next to the waiting text. It stops at once, drops wallet work queued behind it, and a handle that opens later is still closed. The 120 second limit stays as the fallback.
3. An account is checked at once only after it was added or its key changed. A name only edit waits for the next normal check.

### Changes after the first install

1. Messages about settings actions show only on the settings page. They clear when the owner leaves the settings page or the popup closes.
2. The settings page has a Back button and a "Settings" heading. The gear button still toggles it.
3. The accounts can be reordered by drag and drop (Kirigami `ListItemDragHandle`) or with Move up and Move down buttons. The order is saved in the `accounts` setting, and the cards follow it.
4. The refresh choice shows only on the account list, never in the Add or Edit form.
5. A main row that cannot be read stays on the card and shows the reason with the usual error texts. Requesty's Balance comes from an optional request, so a 401 or 403 there shows "Balance needs an API key with manage permission", and any other failure shows its normal error. Numbers may also come in exponent notation. Requesty's org call is the only optional request of any provider.
6. Hugging Face PRO accounts show "Included credits left": 2.00 US dollars minus this month's inference spend (the sum of `costCents`), never below 0, next to "Spent this month". Free accounts show only "Spent this month". Bought credits cannot be read through the API, and the 2.00 also covers other Hugging Face services, so the number is an upper bound.
7. OpenCode Zen shows "Budget left" in dollars (limit minus spend) as the main number, with the monthly bar under it, for the member closest to the limit. Other members are additional rows. A member without a limit shows only "Spent this month".
8. On every card the main numbers come first and the main bars follow, then the additional rows.
9. The popup reopens on the page that was open last time.
10. Claude reset times are estimated, because the Claude desktop app file has no reset field. The samples come about every 15 minutes per organization. The 5hr window starts halfway between the last sample with 0 (or before a drop of 10 points or more) and the first sample with use, and resets 5 hours later. The weekly reset is halfway across the last drop of 10 points or more (or to 0), stepped forward by 7 days until it is in the future. A gap of more than 30 minutes around that point (the app was closed), an estimate already in the past, or no drop in the history gives no reset time. The card says "Resets about 14:30" and "Resets about Mon 14:30" so the owner can tell it from a real reset time. The estimate can be off by up to half a sample gap, and it is wrong if a window started while the app was closed and no 0 was recorded.
11. The account rows are dragged by an inner panel, because the Kirigami drag handle finds the new place with `ListView.indexAt`, which kept finding the dragged delegate itself when the delegate root was the dragged item.

### Alternatives Considered

#### Alternative 1: Keep the Plasma configure dialog for settings

- Pros: standard Plasma Apply and Cancel behaviour, no custom form code.
- Cons: two places to manage one account, and an Apply step the owner does not want.
- Why not: the owner asked for settings only inside the widget.

#### Alternative 2: Use the name or email as the account key

- Pros: no generated id to keep.
- Cons: a name or email must then pass the label rule (no spaces, no `@`), or be quoted into wallet entry names and shell commands.
- Why not: a generated id keeps the free text name out of every command, and renaming does not move the key.

#### Alternative 3: Bind mount the source into the test containers

- Pros: no image build per run.
- Cons: the container shares a folder with the host.
- Why not: the owner asked for containers fully separated from the host.

### Consequences

#### Positive

- One place to add, edit and delete accounts, and nothing runs until the owner adds one.
- Names and emails can be any text, because only the id is used in commands.
- The tests cannot read or change anything on the host.

#### Negative

- The settings form is custom QML, so it needs its own tests for focus, busy state and errors.
- Spend services wait at least 5 minutes between checks, so their values can lag the refresh choice.
- Every test run builds two images. The package layer of the QML image comes from the build cache, so only the copy step runs again.

#### Risks

- The Claude desktop app file, the Codex session format and the JetBrains log line are not documented. Each parser is strict and shows its own error when the format changes.
- A JetBrains log line passes through the shell once with the license id in it. The id is cut out with `sed` before the text reaches the widget, and no test fixture holds a real id.
