import QtQuick
import QtTest

import "../../../package/contents/ui"

TestCase {
    id: suite

    name: "LockedWallet"
    when: windowShown

    Window {
        id: stage

        width: 480
        height: 900
        visible: true
    }

    Component {
        id: configurationComponent

        QtObject {
            property string accounts: JSON.stringify([{ id: "alocked", service: "minimax", name: "locked@example.com" }])
            property int refreshSeconds: 30

            signal valueChanged(string key, var value)
        }
    }

    Component {
        id: controllerComponent

        UsageController {
            tickIntervalMs: 3600000
            walletOpenWaitMs: 3000
        }
    }

    Component {
        id: fullComponent

        FullView {
            width: 440
            height: 860
        }
    }

    function test_aLockedWalletShowsTheUnlockButtonAndUnlockAsksKWallet() {
        const controller = createTemporaryObject(controllerComponent, suite, { configuration: createTemporaryObject(configurationComponent, suite) })
        tryVerify(() => controller.monitor.snapshot().every(entry => !entry.isLoading && entry.lastAttemptAt !== null), 60000, "the check finished")
        compare(controller.viewModel.walletLocked, true)
        const full = createTemporaryObject(fullComponent, stage.contentItem, { controller: controller })
        const unlock = findChild(full, "cardsUnlock")
        compare(unlock.visible, true)
        compare(findChild(unlock, "unlockButton").text, "Unlock KWallet")
        findChild(unlock, "unlockButton").clicked()
        tryVerify(() => findChild(full, "cardsWalletWaiting").visible, 5000, "the waiting text shows while KWallet is asked")
        compare(findChild(full, "cardsWalletWaiting").text, "Waiting for KWallet. Type the wallet password in the KWallet window.")
        tryVerify(() => !unlock.busy, 60000, "the unlock finished")
        compare(unlock.lastCode, "no_answer")
        compare(findChild(full, "cardsWalletWaiting").visible, false)
        compare(findChild(unlock, "unlockStatus").text, "KWallet did not answer. Unlock KWallet and try again.")
    }

    function test_aLockedWalletRefusesANewKeyAndOffersTheUnlockButton() {
        const configuration = createTemporaryObject(configurationComponent, suite, { accounts: "" })
        const controller = createTemporaryObject(controllerComponent, suite, { configuration: configuration })
        const full = createTemporaryObject(fullComponent, stage.contentItem, { controller: controller })
        full.openSettings(true)
        const settings = findChild(full, "settingsView")
        const form = findChild(settings, "accountForm")
        findChild(form, "serviceBox").currentIndex = form.providers.map(provider => provider.id).indexOf("minimax")
        findChild(form, "nameField").text = "locked"
        findChild(form, "keyField").text = "scenario-" + "locked-" + "k3y"
        findChild(form, "saveButton").clicked()
        tryVerify(() => findChild(settings, "settingsWalletWaiting").visible, 5000, "the waiting text shows while KWallet is asked")
        tryVerify(() => !settings.busy, 60000, "the save finished")
        compare(settings.lastWalletCode, "no_answer")
        compare(findChild(settings, "settingsStatus").text, "KWallet did not answer. Unlock KWallet and try again.")
        compare(findChild(settings, "settingsUnlock").visible, true)
        compare(configuration.accounts, "")
        compare(findChild(form, "keyField").text, "scenario-" + "locked-" + "k3y")
    }

    function test_theWaitForKWalletCanBeCancelledAtOnce() {
        const configuration = createTemporaryObject(configurationComponent, suite, { accounts: "" })
        const controller = createTemporaryObject(controllerComponent, suite, { configuration: configuration, walletOpenWaitMs: 60000 })
        const full = createTemporaryObject(fullComponent, stage.contentItem, { controller: controller })
        full.openSettings(true)
        const settings = findChild(full, "settingsView")
        const form = findChild(settings, "accountForm")
        findChild(form, "serviceBox").currentIndex = form.providers.map(provider => provider.id).indexOf("minimax")
        findChild(form, "nameField").text = "waiting"
        findChild(form, "keyField").text = "scenario-" + "wait-" + "k3y"
        findChild(form, "saveButton").clicked()
        const waiting = findChild(settings, "settingsWalletWaiting")
        tryVerify(() => waiting.visible, 10000, "the waiting text shows")
        const started = Date.now()
        findChild(waiting, "cancelWalletWait").clicked()
        tryVerify(() => !settings.busy, 5000, "the save stopped")
        verify(Date.now() - started < 5000, "the cancel did not wait for the 60 second limit")
        compare(settings.lastWalletCode, "cancelled")
        compare(findChild(settings, "settingsStatus").text, "Stopped waiting for KWallet")
        compare(waiting.visible, false)
        compare(form.visible, true)
        compare(findChild(form, "keyField").text, "scenario-" + "wait-" + "k3y")
        compare(configuration.accounts, "")
    }

    function test_theFormCancelAlsoStopsTheWait() {
        const configuration = createTemporaryObject(configurationComponent, suite, { accounts: "" })
        const controller = createTemporaryObject(controllerComponent, suite, { configuration: configuration, walletOpenWaitMs: 60000 })
        const full = createTemporaryObject(fullComponent, stage.contentItem, { controller: controller })
        full.openSettings(true)
        const settings = findChild(full, "settingsView")
        const form = findChild(settings, "accountForm")
        findChild(form, "serviceBox").currentIndex = form.providers.map(provider => provider.id).indexOf("minimax")
        findChild(form, "nameField").text = "waiting"
        findChild(form, "keyField").text = "scenario-" + "wait-" + "k3y"
        findChild(form, "saveButton").clicked()
        tryVerify(() => controller.walletWaiting, 10000, "the wallet wait started")
        findChild(form, "cancelButton").clicked()
        tryVerify(() => !settings.busy, 5000, "the save stopped")
        compare(settings.lastWalletCode, "cancelled")
        compare(form.visible, false)
        compare(controller.walletWaiting, false)
    }
}
