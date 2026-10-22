import QtQuick
import QtQuick.Layouts
import org.kde.plasma.components as PlasmaComponents

import "../code/core/formatter.mjs" as Formatter

RowLayout {
    id: waiting

    property var controller
    readonly property string text: Formatter.walletWaitingText()

    Layout.fillWidth: true

    PlasmaComponents.Label {
        text: waiting.text
        textFormat: Text.PlainText
        wrapMode: Text.Wrap
        Layout.fillWidth: true
    }

    PlasmaComponents.Button {
        objectName: "cancelWalletWait"
        text: "Cancel"
        onClicked: waiting.controller.cancelWalletWait()
        Accessible.name: "Stop waiting for KWallet"
    }
}
