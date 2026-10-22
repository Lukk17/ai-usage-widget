pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts
import org.kde.kirigami as Kirigami
import org.kde.plasma.components as PlasmaComponents
import org.kde.plasma.extras as PlasmaExtras

import "../code/core/formatter.mjs" as Formatter

PlasmaExtras.Representation {
    id: full

    property var controller
    readonly property var viewModel: controller ? controller.viewModel : Formatter.buildViewModel([], 0)
    property bool settingsOpen: false
    property bool popupExpanded: true

    onPopupExpandedChanged: {
        if (!popupExpanded) {
            clearSettingsStatus()
        }
    }

    function clearSettingsStatus() {
        settings.close()
    }

    function closeSettings() {
        settingsOpen = false
        settings.close()
    }

    function openSettings(startAdding) {
        settingsOpen = true
        if (startAdding) {
            settings.startAdd()
        }
    }

    Layout.minimumWidth: Kirigami.Units.gridUnit * 18
    Layout.preferredWidth: Kirigami.Units.gridUnit * 22
    Layout.preferredHeight: Kirigami.Units.gridUnit * 28
    collapseMarginsHint: true

    header: PlasmaExtras.PlasmoidHeading {
        objectName: "topBar"
        visible: full.viewModel.hasAccounts || full.settingsOpen

        RowLayout {
            anchors.fill: parent
            spacing: Kirigami.Units.smallSpacing

            Kirigami.Heading {
                objectName: "topBarTitle"
                level: 3
                text: full.title
                textFormat: Text.PlainText
                elide: Text.ElideRight
                Layout.fillWidth: true
            }

            PlasmaComponents.ToolButton {
                objectName: "refreshButton"
                icon.name: "view-refresh"
                text: "Refresh"
                display: PlasmaComponents.AbstractButton.IconOnly
                onClicked: full.controller.refreshNow()
                Accessible.name: "Refresh every account now"

                QQC2.ToolTip.text: "Refresh"
                QQC2.ToolTip.visible: hovered
            }

            PlasmaComponents.ToolButton {
                objectName: "settingsButton"
                icon.name: "configure"
                text: "Settings"
                display: PlasmaComponents.AbstractButton.IconOnly
                checked: full.settingsOpen
                onClicked: full.settingsOpen ? full.closeSettings() : full.openSettings(false)
                Accessible.name: full.settingsOpen ? "Close the settings" : "Open the settings"

                QQC2.ToolTip.text: "Settings"
                QQC2.ToolTip.visible: hovered
            }
        }
    }

    PlasmaComponents.Button {
        objectName: "emptyAddButton"
        anchors.centerIn: parent
        visible: !full.viewModel.hasAccounts && !full.settingsOpen
        text: "Add account"
        icon.name: "list-add"
        onClicked: full.openSettings(true)
    }

    PlasmaComponents.ScrollView {
        id: scroll

        anchors.fill: parent
        visible: full.viewModel.hasAccounts && !full.settingsOpen
        contentWidth: availableWidth
        PlasmaComponents.ScrollBar.horizontal.policy: PlasmaComponents.ScrollBar.AlwaysOff

        ColumnLayout {
            width: scroll.availableWidth
            spacing: Kirigami.Units.largeSpacing

            Item {
                implicitHeight: 0
            }

            WalletWaitingText {
                objectName: "cardsWalletWaiting"
                controller: full.controller
                visible: full.controller ? full.controller.walletWaiting : false
                Layout.leftMargin: Kirigami.Units.largeSpacing
                Layout.rightMargin: Kirigami.Units.largeSpacing
            }

            UnlockButton {
                objectName: "cardsUnlock"
                visible: full.viewModel.walletLocked
                controller: full.controller
                Layout.leftMargin: Kirigami.Units.largeSpacing
                Layout.rightMargin: Kirigami.Units.largeSpacing
                Layout.fillWidth: true
            }

            Repeater {
                model: full.controller ? full.controller.sectionModel : null

                AccountCard {
                    required property string key

                    section: full.viewModel.sectionsByKey[key] || Formatter.EMPTY_SECTION
                    Layout.fillWidth: true
                    Layout.leftMargin: Kirigami.Units.largeSpacing
                    Layout.rightMargin: Kirigami.Units.largeSpacing
                }
            }

            Item {
                implicitHeight: 0
            }
        }
    }

    SettingsView {
        id: settings

        objectName: "settingsView"
        anchors.fill: parent
        visible: full.settingsOpen
        controller: full.controller
        onBackRequested: full.closeSettings()
    }
}
