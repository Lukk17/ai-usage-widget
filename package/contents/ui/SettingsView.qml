pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Layouts
import org.kde.kirigami as Kirigami
import org.kde.plasma.components as PlasmaComponents

import "../code/core/accounts.mjs" as Accounts
import "../code/core/formatter.mjs" as Formatter
import "../code/core/listSync.mjs" as ListSync
import "../code/providers/registry.mjs" as Registry

PlasmaComponents.ScrollView {
    id: view

    property var controller
    property string mode: "list"
    property var editing: null
    property string confirmingId: ""
    property int pendingWork: 0
    readonly property bool busy: pendingWork > 0
    property string statusText: ""
    property bool statusIsError: false
    property bool walletLocked: false
    property string lastWalletCode: ""

    signal backRequested()

    contentWidth: availableWidth
    PlasmaComponents.ScrollBar.horizontal.policy: PlasmaComponents.ScrollBar.AlwaysOff

    function titleOf(account) {
        const provider = Registry.findProvider(account.service)
        return provider ? provider.title : account.service
    }

    function startAdd() {
        editing = null
        confirmingId = ""
        mode = "add"
    }

    function startEdit(account) {
        editing = account
        confirmingId = ""
        mode = "edit"
    }

    function closeForm() {
        mode = "list"
        editing = null
        form.clear()
    }

    function close() {
        confirmingId = ""
        statusText = ""
        statusIsError = false
        walletLocked = false
    }

    function track(start) {
        pendingWork += 1
        return Promise.resolve().then(start).then(value => {
            pendingWork -= 1
            return value
        }, () => {
            pendingWork -= 1
            return showFailure()
        })
    }

    function showResult(result) {
        lastWalletCode = result.ok ? "" : result.walletCode
        walletLocked = !result.ok && Formatter.isWalletLockedError(result.walletCode)
        statusIsError = !result.ok
        statusText = Formatter.resultText(result, form.provider)
        return result
    }

    function showFailure() {
        walletLocked = false
        statusIsError = true
        statusText = Formatter.saveFailedText()
        return { ok: false }
    }

    function remove(account) {
        confirmingId = ""
        return track(() => controller.deleteAccount(account.id).then(showResult, showFailure))
    }

    ListModel {
        id: accountModel
    }

    function syncAccountModel() {
        const ids = controller ? controller.accounts.map(account => account.id) : []
        const current = []
        for (let index = 0; index < accountModel.count; index += 1) {
            current.push(accountModel.get(index).accountId)
        }
        ListSync.planListSync(current, ids).forEach(step => {
            if (step.op === "remove") {
                accountModel.remove(step.index, 1)
            } else if (step.op === "insert") {
                accountModel.insert(step.index, { accountId: step.key })
            } else {
                accountModel.move(step.from, step.to, 1)
            }
        })
    }

    function accountById(id) {
        const matches = controller ? controller.accounts.filter(account => account.id === id) : []
        return matches.length > 0 ? matches[0] : null
    }

    function saveModelOrder() {
        const ids = []
        for (let index = 0; index < accountModel.count; index += 1) {
            ids.push(accountModel.get(index).accountId)
        }
        controller.setAccountOrder(ids)
    }

    function moveAccount(id, step) {
        controller.moveAccount(id, step)
    }

    Connections {
        target: view.controller
        ignoreUnknownSignals: true

        function onAccountsChanged() {
            view.syncAccountModel()
        }
    }

    Component.onCompleted: syncAccountModel()

    ColumnLayout {
        width: view.availableWidth
        spacing: Kirigami.Units.largeSpacing

        SeverityColors {
            id: severityColors
        }

        RowLayout {
            Layout.fillWidth: true
            Layout.leftMargin: Kirigami.Units.largeSpacing
            Layout.rightMargin: Kirigami.Units.largeSpacing
            Layout.topMargin: Kirigami.Units.largeSpacing

            PlasmaComponents.ToolButton {
                objectName: "backButton"
                icon.name: "go-previous"
                text: "Back"
                display: PlasmaComponents.AbstractButton.TextBesideIcon
                onClicked: view.backRequested()
                Accessible.name: "Back to the accounts"
            }

            Kirigami.Heading {
                level: 3
                text: "Settings"
                textFormat: Text.PlainText
                Layout.fillWidth: true
            }
        }

        GlassPanel {
            objectName: "refreshPanel"
            visible: view.mode === "list"
            Layout.fillWidth: true
            Layout.leftMargin: Kirigami.Units.largeSpacing
            Layout.rightMargin: Kirigami.Units.largeSpacing
            implicitHeight: refreshRow.implicitHeight + Kirigami.Units.largeSpacing * 2

            RowLayout {
                id: refreshRow

                anchors.fill: parent
                anchors.margins: Kirigami.Units.largeSpacing

                PlasmaComponents.Label {
                    text: "Refresh every"
                    Layout.fillWidth: true
                }

                PlasmaComponents.ComboBox {
                    objectName: "refreshBox"
                    model: Accounts.REFRESH_CHOICES_SECONDS.map(seconds => Formatter.refreshChoiceText(seconds))
                    currentIndex: view.controller ? Accounts.REFRESH_CHOICES_SECONDS.indexOf(view.controller.refreshSeconds) : 0
                    onActivated: index => view.controller.setRefreshSeconds(Accounts.REFRESH_CHOICES_SECONDS[index])
                    Accessible.name: "Refresh every"
                }
            }
        }

        ListView {
            id: accountList

            objectName: "accountList"
            visible: view.mode === "list"
            model: accountModel
            interactive: false
            spacing: Kirigami.Units.largeSpacing
            implicitHeight: contentHeight
            Layout.fillWidth: true
            Layout.leftMargin: Kirigami.Units.largeSpacing
            Layout.rightMargin: Kirigami.Units.largeSpacing

            delegate: Item {
                id: row

                required property string accountId
                required property int index
                readonly property var account: view.accountById(accountId) || ({ id: accountId, service: "", name: "" })
                readonly property string fullName: view.titleOf(account) + " " + account.name

                objectName: "account-" + accountId
                width: ListView.view ? ListView.view.width : 0
                implicitHeight: panel.implicitHeight

                GlassPanel {
                    id: panel

                    width: row.width
                    implicitHeight: rowContent.implicitHeight + Kirigami.Units.largeSpacing * 2

                    RowLayout {
                        id: rowContent

                        anchors.fill: parent
                        anchors.margins: Kirigami.Units.largeSpacing
                        spacing: Kirigami.Units.smallSpacing

                        Kirigami.ListItemDragHandle {
                            objectName: "dragHandle-" + row.accountId
                            listItem: panel
                            listView: accountList
                            enabled: !view.busy
                            onMoveRequested: (oldIndex, newIndex) => accountModel.move(oldIndex, newIndex, 1)
                            onDropped: () => view.saveModelOrder()
                            Accessible.name: "Drag to move " + row.fullName
                        }

                        ColumnLayout {
                            spacing: 0
                            Layout.fillWidth: true

                            PlasmaComponents.Label {
                                text: view.titleOf(row.account)
                                textFormat: Text.PlainText
                                font.bold: true
                                elide: Text.ElideRight
                                Layout.fillWidth: true
                            }

                            PlasmaComponents.Label {
                                text: row.account.name
                                textFormat: Text.PlainText
                                opacity: 0.7
                                elide: Text.ElideRight
                                Layout.fillWidth: true
                            }
                        }

                        PlasmaComponents.ToolButton {
                            objectName: "moveUp-" + row.accountId
                            visible: view.confirmingId !== row.accountId
                            icon.name: "go-up"
                            text: "Move up"
                            display: PlasmaComponents.AbstractButton.IconOnly
                            enabled: !view.busy && row.index > 0
                            onClicked: view.moveAccount(row.accountId, -1)
                            Accessible.name: "Move " + row.fullName + " up"
                        }

                        PlasmaComponents.ToolButton {
                            objectName: "moveDown-" + row.accountId
                            visible: view.confirmingId !== row.accountId
                            icon.name: "go-down"
                            text: "Move down"
                            display: PlasmaComponents.AbstractButton.IconOnly
                            enabled: !view.busy && row.index < accountModel.count - 1
                            onClicked: view.moveAccount(row.accountId, 1)
                            Accessible.name: "Move " + row.fullName + " down"
                        }

                        PlasmaComponents.ToolButton {
                            objectName: "edit-" + row.accountId
                            visible: view.confirmingId !== row.accountId
                            icon.name: "document-edit"
                            text: "Edit"
                            display: PlasmaComponents.AbstractButton.IconOnly
                            enabled: !view.busy
                            onClicked: view.startEdit(row.account)
                            Accessible.name: "Edit " + row.fullName
                        }

                        PlasmaComponents.ToolButton {
                            objectName: "delete-" + row.accountId
                            visible: view.confirmingId !== row.accountId
                            icon.name: "edit-delete"
                            text: "Delete"
                            display: PlasmaComponents.AbstractButton.IconOnly
                            enabled: !view.busy
                            onClicked: view.confirmingId = row.accountId
                            Accessible.name: "Delete " + row.fullName
                        }

                        PlasmaComponents.Button {
                            objectName: "confirmDelete-" + row.accountId
                            visible: view.confirmingId === row.accountId
                            text: "Delete now"
                            icon.name: "edit-delete"
                            enabled: !view.busy
                            onClicked: view.remove(row.account)
                            Accessible.name: "Delete " + row.fullName + " now"
                        }

                        PlasmaComponents.Button {
                            objectName: "cancelDelete-" + row.accountId
                            visible: view.confirmingId === row.accountId
                            text: "Cancel"
                            onClicked: view.confirmingId = ""
                        }
                    }
                }
            }
        }

        PlasmaComponents.Button {
            objectName: "addAccountButton"
            visible: view.mode === "list"
            text: "Add account"
            icon.name: "list-add"
            enabled: !view.busy
            onClicked: view.startAdd()
            Layout.leftMargin: Kirigami.Units.largeSpacing
        }

        AccountForm {
            id: form

            objectName: "accountForm"
            visible: view.mode !== "list"
            active: view.mode !== "list"
            controller: view.controller
            editing: view.editing
            busy: view.busy
            Layout.fillWidth: true
            Layout.leftMargin: Kirigami.Units.largeSpacing
            Layout.rightMargin: Kirigami.Units.largeSpacing
            onSubmitted: work => view.track(() => work.then(result => {
                view.showResult(result)
                if (result.ok) {
                    view.closeForm()
                }
                return result
            }, () => view.showFailure()))
            onCancelled: view.closeForm()
        }

        PlasmaComponents.Label {
            objectName: "settingsStatus"
            visible: view.statusText !== ""
            text: view.statusText
            textFormat: Text.PlainText
            color: view.statusIsError ? severityColors.text(Formatter.SEVERITY.CRITICAL) : Kirigami.Theme.textColor
            wrapMode: Text.Wrap
            Layout.fillWidth: true
            Layout.leftMargin: Kirigami.Units.largeSpacing
            Layout.rightMargin: Kirigami.Units.largeSpacing
        }

        WalletWaitingText {
            objectName: "settingsWalletWaiting"
            controller: view.controller
            visible: view.controller ? view.controller.walletWaiting : false
            Layout.leftMargin: Kirigami.Units.largeSpacing
            Layout.rightMargin: Kirigami.Units.largeSpacing
        }

        UnlockButton {
            objectName: "settingsUnlock"
            visible: view.walletLocked
            controller: view.controller
            onUnlocked: {
                view.walletLocked = false
                view.statusIsError = false
                view.statusText = Formatter.doneText("unlock", "", "")
            }
            Layout.leftMargin: Kirigami.Units.largeSpacing
            Layout.rightMargin: Kirigami.Units.largeSpacing
            Layout.fillWidth: true
        }

        Item {
            implicitHeight: Kirigami.Units.largeSpacing
        }
    }
}
