import QtQml
import org.kde.plasma.workspace.dbus as DBus

import "../code/core/walletMessages.mjs" as Wallet
import "../code/core/walletSession.mjs" as WalletSession

QtObject {
    id: client

    property string service: Wallet.WALLET_SERVICE
    property int openWaitMs: WalletSession.OPEN_WAIT_MS
    property int waitingCount: 0
    readonly property var session: WalletSession.createWalletSession(message => client.call(message), (ms, fire) => client.schedule(ms, fire), () => client.openWaitMs, count => { client.waitingCount = count })

    function call(message) {
        return new Promise((resolve, reject) => {
            DBus.SessionBus.asyncCall(Object.assign({}, message, { service: client.service }),
                reply => resolve(Wallet.unwrapValue(reply.value)),
                reply => reject({ name: reply && reply.error && typeof reply.error.name === "string" ? reply.error.name : "" }))
        })
    }

    function schedule(ms, fire) {
        const timer = timerComponent.createObject(client, { interval: ms })
        timer.triggered.connect(() => {
            fire()
            timer.destroy()
        })
        timer.start()
        return () => {
            timer.stop()
            timer.destroy()
        }
    }

    function save(providerId, account, key) {
        return session.save(providerId, account, key)
    }

    function remove(providerId, account) {
        return session.remove(providerId, account)
    }

    function unlock() {
        return session.unlock()
    }

    function cancelWaiting() {
        session.cancelWaiting()
    }

    property Component timerComponent: Component {
        Timer {
            repeat: false
        }
    }

    property DBus.SignalWatcher openedWatcher: DBus.SignalWatcher {
        busType: DBus.BusType.Session
        service: client.service
        path: Wallet.WALLET_PATH
        iface: Wallet.WALLET_INTERFACE

        function dbuswalletAsyncOpened(transaction, handle) {
            client.session.opened(Wallet.unwrapValue(transaction), Wallet.unwrapValue(handle))
        }

        function dbuswalletOpened() {}
        function dbuswalletClosed() {}
        function dbusallWalletsClosed() {}
        function dbuswalletListDirty() {}
        function dbuswalletCreated() {}
        function dbuswalletDeleted() {}
        function dbusfolderListUpdated() {}
        function dbusfolderUpdated() {}
        function dbusapplicationDisconnected() {}
    }
}
