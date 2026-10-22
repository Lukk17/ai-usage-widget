pragma ComponentBehavior: Bound

import QtQuick

import "../code/core/monitor.mjs" as Monitor
import "../code/core/formatter.mjs" as Formatter
import "../code/core/accounts.mjs" as Accounts
import "../code/core/accountActions.mjs" as AccountActions
import "../code/core/check.mjs" as Check
import "../code/core/curlCommand.mjs" as CurlCommand
import "../code/core/listSync.mjs" as ListSync
import "../code/core/units.mjs" as Units
import "../code/providers/registry.mjs" as Registry

Item {
    id: controller

    property var configuration: null
    property int tickIntervalMs: 5000
    property var clock: () => Date.now()
    property alias walletService: wallet.service
    property alias walletOpenWaitMs: wallet.openWaitMs
    readonly property bool walletWaiting: wallet.waitingCount > 0
    readonly property var providers: Registry.ALL_PROVIDERS
    readonly property int refreshSeconds: Accounts.refreshSeconds(configuration ? configuration.refreshSeconds : undefined)
    property var accounts: []
    property var viewModel: Formatter.buildViewModel([], clock())
    readonly property ListModel sectionModel: ListModel {}
    readonly property var tools: ({
        runCommand: (command, timeoutMs) => commandRunner.run(command, timeoutMs),
        clock: () => controller.clock(),
        newBoundary: () => CurlCommand.newBoundary()
    })

    property var monitor: null
    property var actions: null

    function syncSections(keys) {
        const current = []
        for (let index = 0; index < sectionModel.count; index += 1) {
            current.push(sectionModel.get(index).key)
        }
        ListSync.planListSync(current, keys).forEach(step => {
            if (step.op === "remove") {
                sectionModel.remove(step.index, 1)
            } else if (step.op === "insert") {
                sectionModel.insert(step.index, { key: step.key })
            } else {
                sectionModel.move(step.from, step.to, 1)
            }
        })
    }

    function refreshView() {
        const next = Formatter.buildViewModel(monitor.snapshot(), clock())
        viewModel = next
        syncSections(next.keys)
    }

    function readAccounts() {
        return Accounts.parseAccounts(configuration ? configuration.accounts : "", Registry.findProvider)
    }

    function reconfigure() {
        if (!monitor) {
            return
        }
        accounts = readAccounts()
        monitor.configure({ accounts: accounts, intervalMs: refreshSeconds * Units.SECOND_MS })
        monitor.tick()
    }

    function writeAccounts(list) {
        configuration.accounts = Accounts.serializeAccounts(list)
        reconfigure()
    }

    function setAccountOrder(ids) {
        writeAccounts(Accounts.withOrder(readAccounts(), ids))
    }

    function moveAccount(id, step) {
        writeAccounts(Accounts.withAccountMoved(readAccounts(), id, step))
    }

    function setRefreshSeconds(seconds) {
        configuration.refreshSeconds = Accounts.refreshSeconds(seconds)
        reconfigure()
    }

    function refreshNow() {
        return monitor.refreshNow()
    }

    function addAccount(spec) {
        return actions.add(spec)
    }

    function addAccounts(service, items) {
        return actions.addMany(service, items)
    }

    function newDiscoveries(providerId, items) {
        return Accounts.newDiscoveries(items, accounts, providerId)
    }

    function editAccount(id, spec) {
        return actions.edit(id, spec)
    }

    function deleteAccount(id) {
        return actions.remove(id)
    }

    function unlockWallet() {
        return wallet.unlock().then(result => {
            if (result.ok) {
                monitor.refreshNow()
            }
            return result
        })
    }

    function cancelWalletWait() {
        wallet.cancelWaiting()
    }

    function discover(providerId) {
        return Check.discoverAccounts(Registry.findProvider(providerId), tools)
    }

    CommandRunner {
        id: commandRunner
    }

    WalletClient {
        id: wallet
    }

    Connections {
        target: controller.configuration
        ignoreUnknownSignals: true

        function onValueChanged() {
            controller.reconfigure()
        }
    }

    Timer {
        interval: controller.tickIntervalMs
        repeat: true
        running: controller.monitor !== null
        onTriggered: {
            controller.monitor.tick()
            controller.refreshView()
        }
    }

    Component.onCompleted: {
        monitor = Monitor.createMonitor({
            findProvider: Registry.findProvider,
            checkAccount: (provider, account) => Check.checkAccount(provider, account, tools),
            now: () => controller.clock(),
            onChange: refreshView
        })
        actions = AccountActions.createAccountActions({
            wallet: wallet,
            getAccounts: () => controller.readAccounts(),
            setAccounts: list => controller.writeAccounts(list),
            findProvider: Registry.findProvider,
            newId: existing => Accounts.newAccountId(existing),
            recheck: id => controller.monitor.recheck(id)
        })
        reconfigure()
    }
}
