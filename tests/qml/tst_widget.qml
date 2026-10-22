import QtQuick
import QtTest
import org.kde.kirigami as Kirigami

import "../../package/contents/ui"
import "../../package/contents/code/core/formatter.mjs" as Formatter
import "../../package/contents/code/core/listSync.mjs" as ListSync
import "../../package/contents/code/core/curlCommand.mjs" as CurlCommand
import "../../package/contents/code/core/accounts.mjs" as Accounts
import "../../package/contents/code/providers/registry.mjs" as Registry

TestCase {
    id: suite

    name: "AiUsageWidget"
    when: windowShown
    width: 480
    height: 900

    readonly property int loadTimeoutMs: 60000
    readonly property string readoutUrl: "http://127.0.0.20:8766/"
    readonly property string claudeOrgA: "00000000-0000-4000-8000-0000000000aa"
    readonly property string claudeOrgB: "00000000-0000-4000-8000-0000000000bb"
    property var scenarioAccounts: []

    Component {
        id: configurationComponent

        QtObject {
            property string accounts: ""
            property int refreshSeconds: 30

            signal valueChanged(string key, var value)
        }
    }

    Window {
        id: stage

        width: 480
        height: 900
        visible: true
    }

    Component {
        id: controllerComponent

        UsageController {
            tickIntervalMs: 3600000
        }
    }

    Component {
        id: fullComponent

        FullView {
            width: 440
            height: 860
        }
    }

    Component {
        id: compactComponent

        CompactView {}
    }

    Component {
        id: runnerComponent

        CommandRunner {}
    }

    Component {
        id: spyComponent

        SignalSpy {}
    }

    function initTestCase() {
        const xhr = new XMLHttpRequest()
        xhr.open("GET", Qt.resolvedUrl("../fixtures/scenarios.json"), false)
        xhr.send()
        scenarioAccounts = JSON.parse(xhr.responseText).accounts.map(item => {
            const account = { id: item.id, service: item.service, name: item.name }
            ;["teamId", "org"].forEach(field => {
                if (item[field] !== undefined) {
                    account[field] = item[field]
                }
            })
            return account
        })
        verify(scenarioAccounts.length > 10, "the scenarios were read")
    }

    function runCommand(command, timeoutMs) {
        const runner = createTemporaryObject(runnerComponent, suite)
        let result = null
        runner.run(command, timeoutMs).then(value => { result = value })
        tryVerify(() => result !== null, 20000, "the command finished: " + command)
        return result
    }

    function controllerWith(accounts, properties) {
        const configuration = createTemporaryObject(configurationComponent, suite, { accounts: JSON.stringify(accounts) })
        return createTemporaryObject(controllerComponent, suite, Object.assign({ configuration: configuration }, properties || {}))
    }

    function settled(controller) {
        return controller.monitor.snapshot().every(entry => !entry.isLoading && entry.lastAttemptAt !== null)
    }

    function loadedController() {
        const controller = controllerWith(scenarioAccounts)
        tryVerify(() => settled(controller), loadTimeoutMs, "every account finished its first check")
        return controller
    }

    function sectionOf(controller, key) {
        return controller.viewModel.sectionsByKey[key]
    }

    function fullView(controller) {
        return createTemporaryObject(fullComponent, stage.contentItem, { controller: controller })
    }

    function readRecorder() {
        let recorded = null
        const xhr = new XMLHttpRequest()
        xhr.onreadystatechange = () => {
            if (xhr.readyState === XMLHttpRequest.DONE) {
                recorded = xhr.responseText
            }
        }
        xhr.open("GET", readoutUrl)
        xhr.send()
        tryVerify(() => recorded !== null, 5000, "the recorder answered")
        return recorded
    }

    function savedAccounts(controller) {
        return Accounts.parseAccounts(controller.configuration.accounts, Registry.findProvider)
    }

    function walletHas(service, id) {
        return runCommand("secret-tool lookup server ai-usage user '" + service + "." + id + "' type plaintext >/dev/null 2>&1; echo $?", 15000).stdout.trim() === "0"
    }

    function openSettings(full) {
        findChild(full, "settingsButton").clicked()
        tryVerify(() => findChild(full, "settingsView").visible, 2000, "the settings are open")
        return findChild(full, "settingsView")
    }

    function startAdding(full, providerId) {
        const settings = openSettings(full)
        findChild(settings, "addAccountButton").clicked()
        const form = findChild(settings, "accountForm")
        tryVerify(() => form.visible, 2000, "the form is open")
        compare(findChild(form, "serviceBox").currentIndex, -1)
        findChild(form, "serviceBox").currentIndex = Registry.ALL_PROVIDERS.map(provider => provider.id).indexOf(providerId)
        compare(form.provider.id, providerId)
        return { settings: settings, form: form }
    }

    function save(view) {
        findChild(view.form, "saveButton").clicked()
        verify(view.settings.busy, "the settings are busy while the wallet works")
        tryVerify(() => !view.settings.busy, 30000, "the save finished")
    }

    function test_modulesRunInTheQmlEngine() {
        compare(Formatter.formatMoney(1234.5, "usd"), "$1,234.50")
        compare(Formatter.buildViewModel([], Date.now()).hasAccounts, false)
        compare(ListSync.applyPlan(["a", "b"], ListSync.planListSync(["a", "b"], ["b", "c"])).join(","), "b,c")
        compare(Accounts.parseAccounts('[{"id":"constructor","service":"minimax","name":"x"}]', Registry.findProvider)[0].id, "constructor")
    }

    function test_withNoAccountThePopupShowsOnlyAnAddAccountButton() {
        const controller = controllerWith([])
        const full = fullView(controller)
        compare(controller.viewModel.hasAccounts, false)
        compare(findChild(full, "emptyAddButton").visible, true)
        compare(findChild(full, "topBar").visible, false)
        compare(findChild(full, "topBarTitle").visible, false)
        compare(findChild(full, "settingsView").visible, false)
        findChild(full, "emptyAddButton").clicked()
        compare(findChild(full, "settingsView").visible, true)
        compare(findChild(full, "accountForm").visible, true)
        compare(findChild(full, "topBar").visible, true)
    }

    function widgetName() {
        const xhr = new XMLHttpRequest()
        xhr.open("GET", Qt.resolvedUrl("../../package/metadata.json"), false)
        xhr.send()
        return JSON.parse(xhr.responseText).KPlugin.Name
    }

    function centerY(item) {
        return item.mapToItem(stage.contentItem, 0, item.height / 2).y
    }

    function test_theTopBarShowsTheWidgetNameLeftOfTheButtons() {
        const full = createTemporaryObject(fullComponent, stage.contentItem, { controller: settledController(threeAccounts()), title: widgetName() })
        const title = findChild(full, "topBarTitle")
        const refresh = findChild(full, "refreshButton")
        compare(widgetName(), "AI Usage")
        compare(title.text, "AI Usage")
        compare(title.level, 3)
        compare(title.visible, true)
        tryVerify(() => title.width > 0 && refresh.width > 0, 2000, "the top bar is laid out")
        verify(title.mapToItem(stage.contentItem, title.width, 0).x <= refresh.mapToItem(stage.contentItem, 0, 0).x, "the title is left of the buttons")
        verify(Math.abs(centerY(title) - centerY(refresh)) <= 1, "the title is on the same line as the buttons")
        openSettings(full)
        compare(title.visible, true)
        compare(title.text, "AI Usage")
    }

    function rowsText(rows) {
        return rows.map(item => item.label + "=" + item.valueText).join(",")
    }

    function barsText(section) {
        return section.windows.map(item => item.label + "=" + item.percentText).join(",")
    }

    function test_everyServiceIsReadThroughSecretToolCurlOrItsLocalFile() {
        const controller = loadedController()
        compare(rowsText(sectionOf(controller, "arequesty").mainRows), "Balance=Balance needs an API key with manage permission,Spent this month=$12.35 of $50.00")
        compare(sectionOf(controller, "arequesty").mainRows[0].isProblem, true)
        compare(barsText(sectionOf(controller, "arequesty")), "monthly=25%")
        compare(rowsText(sectionOf(controller, "aanthropic").mainRows), "Spent this month=$3.24")
        compare(barsText(sectionOf(controller, "aminimax")), "5hr=20%,daily=0%,weekly=75%")
        compare(barsText(sectionOf(controller, "agobob")), "5hr=37%,weekly=62%,monthly=18%")
        compare(barsText(sectionOf(controller, "azen")), "monthly=75%")
        compare(rowsText(sectionOf(controller, "azen").mainRows), "Budget left=$18.81")
        compare(sectionOf(controller, "azen").rows.map(item => item.label).join(","), "bob")
        compare(rowsText(sectionOf(controller, "aopenai").mainRows), "Spent this month=$3.75")
        compare(rowsText(sectionOf(controller, "aopenai").rows), "Input tokens this month=2M,Output tokens this month=50k")
        compare(rowsText(sectionOf(controller, "axai").mainRows), "Balance=$17.67,Spent this month=$7.33")
        compare(rowsText(sectionOf(controller, "ahf").mainRows), "Included credits left=$0.67,Spent this month=$1.34")
        compare(rowsText(sectionOf(controller, "ahf").rows), "Plan=PRO,Billing mode=postpaid")
        compare(sectionOf(controller, "ahf").account, "typed name")
        compare(barsText(sectionOf(controller, "aclaude")), "5hr=43%,weekly=61%")
        compare(barsText(sectionOf(controller, "achatgpt")), "5hr=38%,weekly=62%")
        compare(barsText(sectionOf(controller, "ajetbrains")), "monthly=55%")
        compare(rowsText(sectionOf(controller, "ajetbrains").rows), "top-up=25%")
        verify(sectionOf(controller, "agoalice").errorText.indexOf("Add the key in the widget settings") === 0, sectionOf(controller, "agoalice").errorText)
    }

    function test_everyCardHasTheSameLayoutWithNoNamesInFrontOfTheMainLabels() {
        const controller = loadedController()
        controller.viewModel.sections.forEach(section => {
            section.windows.forEach(item => verify(["5hr", "daily", "weekly", "monthly"].indexOf(item.label) !== -1, section.key + " " + item.label))
            section.mainRows.forEach(item => verify(["Balance", "Included credits left", "Budget left", "Spent this month"].indexOf(item.label) !== -1, section.key + " " + item.label))
        })
        const full = fullView(controller)
        const zen = findChild(full, "card-azen")
        verify(findChild(zen, "extraRow") !== null, "the members are additional rows")
        compare(findChild(zen, "rowsSeparator").visible, true)
    }

    function test_aMissingCodexSessionShowsItsMessageOnTheCard() {
        compare(runCommand("mv \"$HOME/.codex\" \"$HOME/.codex-hidden\"; echo $?", 5000).stdout, "0\n")
        const controller = controllerWith([{ id: "anocodex", service: "chatgpt", name: "me" }])
        tryVerify(() => settled(controller), loadTimeoutMs, "the read finished")
        const full = fullView(controller)
        verify(findChild(full, "card-anocodex") !== null, "the card is shown")
        compare(sectionOf(controller, "anocodex").errorText, "No Codex session found")
        compare(runCommand("mv \"$HOME/.codex-hidden\" \"$HOME/.codex\"; echo $?", 5000).stdout, "0\n")
    }

    function test_aRedirectIsNotFollowedAndTheOtherHostGetsNothing() {
        const redirect = sectionOf(loadedController(), "aredirect")
        compare(redirect.errorText, "Unexpected answer (the service answered with a redirect, HTTP 302)")
        compare(readRecorder(), "[]")
    }

    function test_aFiveMegabyteAnswerIsCutOffByCurl() {
        compare(sectionOf(loadedController(), "ahuge").errorText, "Unexpected answer (the answer was larger than 1 MiB)")
    }

    function test_aCheckNeverBringsTheKeyIntoPlasmashell() {
        const provider = Registry.findProvider("minimax")
        const boundary = CurlCommand.newBoundary()
        const command = CurlCommand.buildCheckCommand({ providerId: "minimax", account: "aminimax", auth: provider.auth, requests: provider.buildRequests(Date.now()), boundary: boundary })
        verify(command.indexOf("scenario-") === -1, "the key is not part of the command")
        const result = runCommand(command, CurlCommand.commandTimeoutMs(1))
        verify(result.stdout.indexOf(boundary + " end 200") !== -1, result.stdout.slice(0, 300))
        verify(result.stdout.indexOf("scenario-minimax-percent") === -1, "the key is not in stdout")
        verify(result.stderr.indexOf("scenario-minimax-percent") === -1, "the key is not in stderr")
    }

    function test_theJetBrainsLicenseNeverReachesTheWidget() {
        const result = runCommand(Registry.findProvider("jetbrains").readCommand, 10000)
        verify(result.stdout.indexOf("tariffQuota") !== -1, result.stdout)
        verify(result.stdout.indexOf("PLACEHOLDERLICENSE") === -1, "the license id was cut out")
    }

    function test_theShellPrintfIsABuiltin() {
        compare(runCommand("command -v printf", 5000).stdout, "printf\n")
    }

    function test_cardsShowServiceAndAccountAndNoCheckTimes() {
        const controller = loadedController()
        const full = fullView(controller)
        scenarioAccounts.forEach(account => verify(findChild(full, "card-" + account.id) !== null, account.id))
        const bob = findChild(full, "card-agobob")
        compare(findChild(bob, "serviceName").text, "OpenCode Go")
        compare(findChild(bob, "accountName").text, "bob@example.com")
        const text = JSON.stringify(controller.viewModel)
        ;["Highest use", "Next check", "Last successful check", "Waiting for Claude Code", "next try"].forEach(phrase => verify(text.indexOf(phrase) === -1, phrase))
        compare(findChild(full, "emptyAddButton").visible, false)
        compare(findChild(full, "cardsUnlock").visible, false)
    }

    function test_aCardSurvivesARefresh() {
        const controller = loadedController()
        const full = fullView(controller)
        const before = findChild(findChild(full, "card-agoalice"), "errorText")
        controller.refreshView()
        const after = findChild(findChild(full, "card-agoalice"), "errorText")
        verify(after === before, "the same card item is still on screen")
    }

    function test_theRefreshButtonChecksAgainOnlyAfterThirtySeconds() {
        const start = Date.now()
        let now = start
        const controller = controllerWith([{ id: "arefresh", service: "chatgpt", name: "me" }], { clock: () => now })
        tryVerify(() => settled(controller), loadTimeoutMs, "the first read finished")
        const full = fullView(controller)
        now = start + 29000
        findChild(full, "refreshButton").clicked()
        compare(controller.monitor.snapshot()[0].lastAttemptAt, start)
        now = start + 30000
        findChild(full, "refreshButton").clicked()
        tryVerify(() => controller.monitor.snapshot()[0].lastAttemptAt === start + 30000 && settled(controller), 20000, "the account was read again")
    }

    function test_theRefreshChoiceIsSavedAndUsed() {
        const controller = controllerWith([])
        const full = fullView(controller)
        const settings = openSettings(full)
        const box = findChild(settings, "refreshBox")
        compare(box.currentIndex, 0)
        compare(box.model.join(","), "30 seconds,1 minute,5 minutes,15 minutes,30 minutes,60 minutes")
        box.activated(2)
        compare(controller.configuration.refreshSeconds, 300)
        compare(controller.refreshSeconds, 300)
        compare(box.currentIndex, 2)
    }

    function test_theKeyHelpNamesTheKeyAndThePlatform() {
        const controller = controllerWith([])
        const full = fullView(controller)
        let view = startAdding(full, "openai")
        compare(findChild(view.form, "keyHelpButton").helpText, "Admin API key, from the OpenAI Platform")
        compare(findChild(view.form, "keyHelpButton").visible, true)
        compare(findChild(view.form, "nameHelpButton").visible, false)
        findChild(view.form, "serviceBox").currentIndex = Registry.ALL_PROVIDERS.map(provider => provider.id).indexOf("jetbrains")
        compare(findChild(view.form, "keyField").visible, false)
        compare(findChild(view.form, "nameHelpButton").visible, true)
        compare(findChild(view.form, "nameHelpButton").helpText, "No key needed, read from the JetBrains IDE log")
        findChild(view.form, "serviceBox").currentIndex = Registry.ALL_PROVIDERS.map(provider => provider.id).indexOf("xai")
        verify(findChild(view.form, "field-teamId") !== null, "xAI asks for the team ID")
    }

    function test_addingAnAccountSavesTheKeyInKWalletAndShowsTheCard() {
        const controller = controllerWith([])
        const full = fullView(controller)
        const view = startAdding(full, "minimax")
        findChild(view.form, "nameField").text = "added@example.com"
        findChild(view.form, "keyField").text = "scenario-minimax-percent"
        save(view)
        compare(findChild(view.settings, "settingsStatus").text, "Added MiniMax added@example.com")
        const saved = savedAccounts(controller)
        compare(saved.length, 1)
        compare(saved[0].service, "minimax")
        compare(saved[0].name, "added@example.com")
        verify(walletHas("minimax", saved[0].id), "the key is in the wallet")
        compare(findChild(view.form, "keyField").text, "")
        tryVerify(() => sectionOf(controller, saved[0].id) !== undefined && sectionOf(controller, saved[0].id).windows.length === 3, loadTimeoutMs, "the new card has its values")
        findChild(full, "settingsButton").clicked()
        verify(findChild(full, "card-" + saved[0].id) !== null)
    }

    function test_editingChangesTheNameAndAnEmptyKeyKeepsTheSavedKey() {
        const controller = controllerWith([])
        const full = fullView(controller)
        let view = startAdding(full, "minimax")
        findChild(view.form, "nameField").text = "before"
        findChild(view.form, "keyField").text = "scenario-minimax-percent"
        save(view)
        const id = savedAccounts(controller)[0].id
        tryVerify(() => findChild(view.settings, "edit-" + id) !== null, 5000, "the account row is shown")
        findChild(view.settings, "edit-" + id).clicked()
        compare(findChild(view.form, "nameField").text, "before")
        compare(findChild(view.form, "serviceBox").visible, false)
        findChild(view.form, "nameField").text = "after"
        save(view)
        compare(savedAccounts(controller)[0].name, "after")
        compare(savedAccounts(controller)[0].id, id)
        tryVerify(() => sectionOf(controller, id) && sectionOf(controller, id).account === "after" && sectionOf(controller, id).windows.length === 3, loadTimeoutMs, "the card shows the new name and still has values")
        findChild(view.settings, "edit-" + id).clicked()
        findChild(view.form, "keyField").text = "scenario-redirect"
        save(view)
        tryVerify(() => sectionOf(controller, id) && sectionOf(controller, id).errorText.indexOf("redirect") !== -1, loadTimeoutMs, "the new key is used at once")
    }

    function test_deleteAsksFirstThenRemovesTheAccountAndItsKey() {
        const controller = controllerWith([])
        const full = fullView(controller)
        const view = startAdding(full, "minimax")
        findChild(view.form, "nameField").text = "to delete"
        findChild(view.form, "keyField").text = "scenario-minimax-percent"
        save(view)
        const id = savedAccounts(controller)[0].id
        tryVerify(() => findChild(view.settings, "delete-" + id) !== null, 5000, "the row is shown")
        findChild(view.settings, "delete-" + id).clicked()
        compare(savedAccounts(controller).length, 1)
        compare(findChild(view.settings, "confirmDelete-" + id).visible, true)
        findChild(view.settings, "confirmDelete-" + id).clicked()
        tryVerify(() => !view.settings.busy, 30000, "the delete finished")
        compare(findChild(view.settings, "settingsStatus").text, "Deleted MiniMax to delete")
        compare(savedAccounts(controller).length, 0)
        verify(!walletHas("minimax", id), "the key is gone from the wallet")
        compare(controller.viewModel.hasAccounts, false)
    }

    function test_addingClaudeListsTheOrganizationsOfTheDesktopAppFile() {
        const controller = controllerWith([{ id: "aclaudeb", service: "claude", name: "already", org: claudeOrgB }])
        const full = fullView(controller)
        const view = startAdding(full, "claude")
        compare(findChild(view.form, "keyField").visible, false)
        compare(findChild(view.form, "nameField").visible, false)
        tryVerify(() => findChild(view.form, "orgName-" + claudeOrgA) !== null, 20000, "the organization of the file is listed")
        compare(findChild(view.form, "orgName-" + claudeOrgB), null)
        findChild(view.form, "orgName-" + claudeOrgA).text = "claude@example.com"
        save(view)
        const added = savedAccounts(controller).filter(account => account.org === claudeOrgA)
        compare(added.length, 1)
        compare(added[0].name, "claude@example.com")
        tryVerify(() => sectionOf(controller, added[0].id) && sectionOf(controller, added[0].id).windows.length === 2, loadTimeoutMs, "the Claude card has its bars")
    }

    function test_noProcessArgumentAndNoFileHoldsTheKeyWhileAndAfterSaving() {
        const controller = controllerWith([])
        const full = fullView(controller)
        const view = startAdding(full, "minimax")
        const runner = createTemporaryObject(runnerComponent, suite)
        let sample = null
        const sampler = "a='scenario-'; b='sampler-k3y'; i=0; while [ $i -lt 100 ]; do printf '%s%s\\n' \"$a\" \"$b\" | grep -l -F -f - /proc/[0-9]*/cmdline 2>/dev/null; sleep 0.05; i=$((i + 1)); done; printf 'samples %s\\n' \"$i\""
        runner.run(sampler, 20000).then(value => { sample = value })
        findChild(view.form, "nameField").text = "sampler"
        findChild(view.form, "keyField").text = "scenario-" + "sampler-" + "k3y"
        save(view)
        compare(findChild(view.settings, "settingsStatus").text, "Added MiniMax sampler")
        tryVerify(() => sample !== null, 20000, "the sampler finished")
        compare(sample.stdout, "samples 100\n")
        const pattern = "a='scenario-'; b='sampler-k3y'; printf '%s%s\\n' \"$a\" \"$b\""
        compare(runCommand(pattern + " | grep -r -l -F -f - \"$HOME\" \"$XDG_DATA_HOME\" \"$XDG_CACHE_HOME\" \"$XDG_RUNTIME_DIR\" --exclude-dir=keyrings 2>/dev/null; true", 10000).stdout, "")
        verify(runCommand("ls \"$XDG_DATA_HOME/keyrings\"", 5000).stdout.indexOf("login.keyring") !== -1, "the throwaway keyring exists")
        verify(controller.configuration.accounts.indexOf("scenario-") === -1, "the key is not in the settings")
    }

    function test_aMissingKwalletdSaysKWalletIsNotRunningAndAddsNothing() {
        const controller = controllerWith([], { walletService: "org.kde.kwalletd6.missing" })
        const full = fullView(controller)
        const view = startAdding(full, "minimax")
        findChild(view.form, "nameField").text = "missing"
        findChild(view.form, "keyField").text = "scenario-minimax-percent"
        save(view)
        compare(findChild(view.settings, "settingsStatus").text, "KWallet is not running")
        compare(savedAccounts(controller).length, 0)
        compare(findChild(view.form, "keyField").text, "scenario-minimax-percent")
        compare(findChild(view.form, "nameField").text, "missing")
        compare(view.form.visible, true)
    }

    function test_aKeyWithASpaceIsRefusedAndTheFormKeepsIt() {
        const controller = controllerWith([])
        const full = fullView(controller)
        const view = startAdding(full, "minimax")
        findChild(view.form, "nameField").text = "space"
        findChild(view.form, "keyField").text = "two words"
        save(view)
        compare(findChild(view.settings, "settingsStatus").text, "The key must be plain ASCII without spaces or line breaks")
        compare(findChild(view.form, "keyField").text, "two words")
        compare(savedAccounts(controller).length, 0)
    }

    function test_saveWaitsForANameAndAKey() {
        const controller = controllerWith([])
        const view = startAdding(fullView(controller), "xai")
        const button = findChild(view.form, "saveButton")
        compare(button.enabled, false)
        findChild(view.form, "nameField").text = "team"
        findChild(view.form, "keyField").text = "scenario-x"
        compare(button.enabled, false)
        findChild(view.form, "field-teamId").text = "../bad"
        compare(button.enabled, false)
        findChild(view.form, "field-teamId").text = "00000000-0000-4000-8000-000000000001"
        compare(button.enabled, true)
    }

    function test_commandRunnerRunsACommandThroughTheExecutableEngine() {
        const result = runCommand("printf 'ai-usage'", 5000)
        compare(result.exitCode, 0)
        compare(result.stdout, "ai-usage")
        compare(result.timedOut, false)
    }

    function test_commandRunnerTimesOutAndStaysUsable() {
        const runner = createTemporaryObject(runnerComponent, suite)
        let slow = null
        runner.run("sleep 1", 300).then(value => { slow = value })
        tryVerify(() => slow !== null, 5000, "the caller got its time out")
        compare(slow.timedOut, true)
        compare(runner.runningCount, 1)
        tryVerify(() => runner.runningCount === 0, 5000, "the slow command still ran to its end")
        let after = null
        runner.run("printf 'after'", 5000).then(value => { after = value })
        tryVerify(() => after !== null, 5000, "the next command ran")
        compare(after.stdout, "after")
    }

    function test_commandRunnerNeverStartsASecondCopyOfARunningCommand() {
        const runner = createTemporaryObject(runnerComponent, suite)
        const command = "sleep 0.5; date +%s%N"
        const results = []
        runner.run(command, 300).then(value => results.push(value))
        tryVerify(() => results.length === 1, 5000, "the first caller timed out")
        runner.run(command, 5000).then(value => results.push(value))
        compare(runner.runningCount, 1)
        tryVerify(() => results.length === 2 && runner.runningCount === 0, 5000, "the second caller got the result of the first run")
        compare(results[0].timedOut, true)
        compare(results[1].timedOut, false)
        verify(results[1].stdout.trim().length > 0)
    }

    function test_controllerFollowsConfigurationChanges() {
        const controller = controllerWith([])
        compare(controller.viewModel.hasAccounts, false)
        controller.configuration.accounts = JSON.stringify([{ id: "alater", service: "jetbrains", name: "later" }])
        controller.configuration.valueChanged("accounts", controller.configuration.accounts)
        tryVerify(() => controller.viewModel.keys.indexOf("alater") !== -1, 10000, "the account appears after the setting changed")
    }

    function test_thePanelShowsOnlyTheIconWithAPlainName() {
        const compact = createTemporaryObject(compactComponent, stage.contentItem)
        verify(findChild(compact, "panelIcon") !== null)
        compare(findChild(compact, "highestText"), null)
        compare(findChild(compact, "errorDot"), null)
        compare(compact.Accessible.name, "AI usage")
        const spy = createTemporaryObject(spyComponent, suite, { target: compact, signalName: "activated" })
        mouseClick(compact)
        compare(spy.count, 1)
    }

    function test_widgetFilesCompile() {
        ["main.qml", "FullView.qml", "SettingsView.qml", "AccountForm.qml", "AccountCard.qml", "UnlockButton.qml", "WalletClient.qml"].forEach(file => {
            const component = Qt.createComponent(Qt.resolvedUrl("../../package/contents/ui/" + file))
            compare(component.status, Component.Ready, file + ": " + component.errorString())
        })
    }

    function test_theServiceBoxStartsEmptySoNoFileIsRead() {
        const controller = controllerWith([])
        const full = fullView(controller)
        full.openSettings(true)
        const form = findChild(full, "accountForm")
        compare(form.provider, null)
        compare(findChild(form, "serviceBox").displayText, "Pick a service")
        compare(findChild(form, "nameField").visible, false)
        compare(findChild(form, "keyField").visible, false)
        compare(findChild(form, "saveButton").enabled, false)
        compare(form.discoveryResult, null)
        compare(form.discovered.length, 0)
    }

    function test_aDisabledSaveShowsTheRuleUnderTheFailingField() {
        const controller = controllerWith([])
        const view = startAdding(fullView(controller), "xai")
        compare(findChild(view.form, "nameRule").visible, true)
        compare(findChild(view.form, "nameRule").text, "Type a name or email of 1 to 100 characters")
        compare(findChild(view.form, "keyRule").visible, true)
        compare(findChild(view.form, "keyRule").text, "Paste the key")
        compare(findChild(view.form, "fieldRule-teamId").visible, true)
        findChild(view.form, "nameField").text = "team"
        findChild(view.form, "keyField").text = "scenario-x"
        findChild(view.form, "field-teamId").text = "../bad"
        compare(findChild(view.form, "nameRule").visible, false)
        compare(findChild(view.form, "keyRule").visible, false)
        compare(findChild(view.form, "fieldRule-teamId").text, "Team ID: use letters, digits and - only, at most 64")
        compare(findChild(view.form, "fieldRule-teamId").isError, true)
        findChild(view.form, "field-teamId").text = "00000000-0000-4000-8000-000000000001"
        compare(findChild(view.form, "fieldRule-teamId").visible, false)
        compare(findChild(view.form, "saveButton").enabled, true)
    }

    function test_aPastedKeyWithATrailingNewlineIsSavedWithoutIt() {
        const controller = controllerWith([])
        const view = startAdding(fullView(controller), "minimax")
        findChild(view.form, "nameField").text = "pasted"
        findChild(view.form, "keyField").text = "scenario-minimax-percent\n"
        save(view)
        compare(findChild(view.settings, "settingsStatus").text, "Added MiniMax pasted")
        const id = savedAccounts(controller)[0].id
        compare(runCommand("secret-tool lookup server ai-usage user 'minimax." + id + "' type plaintext | wc -c", 15000).stdout.trim(), String("scenario-minimax-percent".length))
        tryVerify(() => sectionOf(controller, id) && sectionOf(controller, id).windows.length === 3, loadTimeoutMs, "the trimmed key works")
    }

    function test_theFormFollowsAPlainTabOrder() {
        const controller = controllerWith([])
        const full = fullView(controller)
        const view = startAdding(full, "minimax")
        stage.requestActivate()
        const order = ["serviceBox", "nameField", "keyField", "keyHelpButton", "cancelButton"]
        const first = findChild(view.form, order[0])
        first.forceActiveFocus()
        tryVerify(() => first.activeFocus, 2000, "the service box has focus")
        const seen = [order[0]]
        for (let step = 0; step < 12 && seen[seen.length - 1] !== "cancelButton"; step += 1) {
            keyClick(Qt.Key_Tab)
            wait(50)
            const focused = order.filter(name => findChild(view.form, name).activeFocus)
            if (focused.length === 1 && seen.indexOf(focused[0]) === -1) {
                seen.push(focused[0])
            }
        }
        compare(seen.join(","), order.join(","))
    }

    function test_aSuccessfulUnlockSaysKWalletIsOpen() {
        const controller = controllerWith([])
        const full = fullView(controller)
        const settings = openSettings(full)
        settings.walletLocked = true
        const unlock = findChild(settings, "settingsUnlock")
        tryVerify(() => unlock.visible, 2000, "the unlock button shows")
        findChild(unlock, "unlockButton").clicked()
        tryVerify(() => !unlock.busy, 30000, "the unlock finished")
        compare(findChild(unlock, "unlockStatus").visible, false)
        compare(findChild(settings, "settingsStatus").text, "KWallet is open")
        compare(unlock.visible, false)
    }

    function test_cancelClearsTheFormButClosingTheSettingsKeepsWhatWasTyped() {
        const controller = controllerWith([])
        const full = fullView(controller)
        const view = startAdding(full, "xai")
        findChild(view.form, "nameField").text = "draft"
        findChild(view.form, "keyField").text = "scenario-draft"
        findChild(view.form, "field-teamId").text = "team-draft"
        view.settings.statusText = "an old message"
        findChild(full, "settingsButton").clicked()
        compare(findChild(full, "settingsView").visible, false)
        findChild(full, "settingsButton").clicked()
        compare(findChild(full, "settingsView").visible, true)
        compare(findChild(view.settings, "settingsStatus").visible, false)
        compare(view.form.visible, true)
        compare(view.form.provider.id, "xai")
        compare(findChild(view.form, "nameField").text, "draft")
        compare(findChild(view.form, "keyField").text, "scenario-draft")
        compare(findChild(view.form, "field-teamId").text, "team-draft")
        findChild(view.form, "cancelButton").clicked()
        compare(view.form.visible, false)
        compare(findChild(view.settings, "addAccountButton").visible, true)
        findChild(view.settings, "addAccountButton").clicked()
        compare(findChild(view.form, "serviceBox").currentIndex, -1)
        findChild(view.form, "serviceBox").currentIndex = Registry.ALL_PROVIDERS.map(provider => provider.id).indexOf("xai")
        compare(findChild(view.form, "nameField").text, "")
        compare(findChild(view.form, "keyField").text, "")
        compare(findChild(view.form, "field-teamId").text, "")
    }

    function test_claudeDiscoveryAsksForAtLeastOneName() {
        const controller = controllerWith([])
        const view = startAdding(fullView(controller), "claude")
        tryVerify(() => findChild(view.form, "orgName-" + claudeOrgA) !== null, 20000, "the organizations are listed")
        compare(findChild(view.form, "discoveryRule").visible, true)
        compare(findChild(view.form, "discoveryRule").text, "Type a name or email for at least one organization")
        compare(findChild(view.form, "saveButton").enabled, false)
        findChild(view.form, "orgName-" + claudeOrgB).text = "me@example.com"
        compare(findChild(view.form, "discoveryRule").visible, false)
        compare(findChild(view.form, "saveButton").enabled, true)
    }

    function test_aMissingClaudeFileIsExplainedInTheForm() {
        compare(runCommand("mv \"$HOME/.config/Claude/plan-usage-history.json\" \"$HOME/.config/Claude/hidden.json\"; echo $?", 5000).stdout, "0\n")
        const controller = controllerWith([])
        const view = startAdding(fullView(controller), "claude")
        const text = findChild(view.form, "discoveryText")
        tryVerify(() => text.visible && view.form.discoveryResult !== null, 20000, "the discovery finished")
        compare(text.text, "The Claude desktop app file plan-usage-history.json was not found")
        compare(findChild(view.form, "saveButton").enabled, false)
        compare(runCommand("mv \"$HOME/.config/Claude/hidden.json\" \"$HOME/.config/Claude/plan-usage-history.json\"; echo $?", 5000).stdout, "0\n")
    }

    function test_editingTheXaiTeamIdSavesTheNewId() {
        const controller = controllerWith([])
        const full = fullView(controller)
        const view = startAdding(full, "xai")
        findChild(view.form, "nameField").text = "team"
        findChild(view.form, "keyField").text = "scenario-xai-happy"
        findChild(view.form, "field-teamId").text = "00000000-0000-4000-8000-000000000001"
        save(view)
        const id = savedAccounts(controller)[0].id
        tryVerify(() => sectionOf(controller, id) && sectionOf(controller, id).mainRows.length === 2, loadTimeoutMs, "the team answers with the fixture")
        findChild(view.settings, "edit-" + id).clicked()
        compare(findChild(view.form, "field-teamId").text, "00000000-0000-4000-8000-000000000001")
        findChild(view.form, "field-teamId").text = "team-two"
        save(view)
        compare(savedAccounts(controller)[0].teamId, "team-two")
        compare(savedAccounts(controller)[0].id, id)
        tryVerify(() => sectionOf(controller, id) && sectionOf(controller, id).hasError, loadTimeoutMs, "the new team ID is asked at once")
        verify(walletHas("xai", id), "the key stayed in the wallet")
    }

    function settledController(accounts) {
        const controller = controllerWith(accounts)
        tryVerify(() => settled(controller), loadTimeoutMs, "the first reads finished")
        return controller
    }

    function threeAccounts() {
        return [
            { id: "aone", service: "jetbrains", name: "one" },
            { id: "atwo", service: "chatgpt", name: "two" },
            { id: "athree", service: "claude", name: "three", org: claudeOrgA }
        ]
    }

    function cardOrder(controller) {
        const keys = []
        for (let index = 0; index < controller.sectionModel.count; index += 1) {
            keys.push(controller.sectionModel.get(index).key)
        }
        return keys.join(",")
    }

    function savedOrder(controller) {
        return savedAccounts(controller).map(account => account.id).join(",")
    }

    function test_closingThePopupClearsTheSettingsStatus() {
        const controller = controllerWith([])
        const full = fullView(controller)
        const settings = openSettings(full)
        settings.statusText = "Added Claude three"
        full.popupExpanded = false
        compare(settings.statusText, "")
        compare(full.settingsOpen, true)
    }

    function test_theBackButtonReturnsToTheCardsAndClearsTheStatus() {
        const controller = settledController(threeAccounts())
        const full = fullView(controller)
        const settings = openSettings(full)
        settings.statusText = "Added Claude three"
        compare(findChild(settings, "settingsStatus").visible, true)
        findChild(settings, "backButton").clicked()
        compare(full.settingsOpen, false)
        compare(findChild(full, "settingsView").visible, false)
        verify(findChild(full, "card-aone") !== null, "the cards are back")
        compare(settings.statusText, "")
        full.openSettings(false)
        compare(findChild(settings, "settingsStatus").visible, false)
    }

    function test_theRefreshChoiceShowsOnlyOnTheAccountList() {
        const controller = settledController(threeAccounts())
        const full = fullView(controller)
        const settings = openSettings(full)
        compare(findChild(settings, "refreshPanel").visible, true)
        findChild(settings, "addAccountButton").clicked()
        compare(findChild(settings, "refreshPanel").visible, false)
        findChild(findChild(settings, "accountForm"), "cancelButton").clicked()
        tryVerify(() => findChild(settings, "edit-aone") !== null, 2000, "the list is back")
        findChild(settings, "edit-aone").clicked()
        compare(findChild(settings, "refreshPanel").visible, false)
    }

    function test_moveUpAndDownSaveTheOrderAndTheCardsFollow() {
        const controller = settledController(threeAccounts())
        const full = fullView(controller)
        const settings = openSettings(full)
        tryVerify(() => findChild(settings, "moveUp-athree") !== null, 2000, "the rows are shown")
        compare(findChild(settings, "moveUp-aone").enabled, false)
        compare(findChild(settings, "moveDown-athree").enabled, false)
        findChild(settings, "moveUp-athree").clicked()
        compare(savedOrder(controller), "aone,athree,atwo")
        compare(cardOrder(controller), "aone,athree,atwo")
        findChild(settings, "moveDown-aone").clicked()
        compare(savedOrder(controller), "athree,aone,atwo")
        compare(cardOrder(controller), "athree,aone,atwo")
        compare(controller.viewModel.keys.join(","), "athree,aone,atwo")
        tryVerify(() => settled(controller), loadTimeoutMs, "the reads after the move finished")
    }

    function dragHandle(settings, id, rows) {
        const handle = findChild(settings, "dragHandle-" + id)
        const row = findChild(settings, "account-" + id)
        const start = handle.mapToItem(settings, handle.width / 2, handle.height / 2)
        const distance = rows * (row.height + Kirigami.Units.largeSpacing)
        mousePress(settings, start.x, start.y)
        const steps = 12
        for (let step = 1; step <= steps; step += 1) {
            mouseMove(settings, start.x, start.y + distance * step / steps, 10)
        }
        mouseRelease(settings, start.x, start.y + distance)
    }

    function test_aRealMouseDragOnTheHandleSavesTheOrderAndTheCardsFollow() {
        const controller = settledController(threeAccounts())
        const full = fullView(controller)
        const settings = openSettings(full)
        tryVerify(() => findChild(settings, "dragHandle-aone") !== null, 2000, "the drag handles are shown")
        waitForRendering(settings)
        dragHandle(settings, "aone", 2)
        tryVerify(() => savedOrder(controller) === "atwo,athree,aone", 5000, "the drop saved the new order, got " + savedOrder(controller))
        compare(cardOrder(controller), "atwo,athree,aone")
        wait(Kirigami.Units.longDuration * 2)
        waitForRendering(settings)
        dragHandle(settings, "athree", -1)
        tryVerify(() => savedOrder(controller) === "athree,atwo,aone", 5000, "the upward drop saved the new order, got " + savedOrder(controller))
        tryVerify(() => settled(controller), loadTimeoutMs, "the reads after the drop finished")
    }
}
