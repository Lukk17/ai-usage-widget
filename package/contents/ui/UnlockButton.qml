import QtQuick
import QtQuick.Layouts
import org.kde.kirigami as Kirigami
import org.kde.plasma.components as PlasmaComponents

import "../code/core/formatter.mjs" as Formatter

ColumnLayout {
    id: unlock

    property var controller
    property bool busy: false
    property string statusText: ""
    property string lastCode: ""

    signal unlocked()

    SeverityColors {
        id: colors
    }

    spacing: Kirigami.Units.smallSpacing

    function start() {
        busy = true
        statusText = ""
        return controller.unlockWallet().then(result => {
            busy = false
            lastCode = result.ok ? "" : result.code
            if (result.ok) {
                unlocked()
            } else {
                statusText = Formatter.walletErrorText(result.code)
            }
        })
    }

    PlasmaComponents.Button {
        objectName: "unlockButton"
        text: "Unlock KWallet"
        icon.name: "kwalletmanager"
        enabled: !unlock.busy
        onClicked: unlock.start()
    }

    PlasmaComponents.Label {
        objectName: "unlockStatus"
        visible: unlock.statusText !== ""
        text: unlock.statusText
        textFormat: Text.PlainText
        color: colors.text(Formatter.SEVERITY.CRITICAL)
        wrapMode: Text.Wrap
        Layout.fillWidth: true
    }
}
