import QtQuick
import QtQuick.Controls as QQC2
import org.kde.kirigami as Kirigami
import org.kde.plasma.components as PlasmaComponents

PlasmaComponents.ToolButton {
    id: help

    property string helpText

    icon.name: "help-contextual"
    text: "?"
    display: PlasmaComponents.AbstractButton.IconOnly
    focusPolicy: Qt.StrongFocus
    implicitWidth: Kirigami.Units.iconSizes.medium
    implicitHeight: Kirigami.Units.iconSizes.medium
    Accessible.name: "Help"
    Accessible.description: help.helpText

    QQC2.ToolTip.text: help.helpText
    QQC2.ToolTip.visible: help.hovered || help.pressed || help.activeFocus
    QQC2.ToolTip.delay: Kirigami.Units.toolTipDelay
}
