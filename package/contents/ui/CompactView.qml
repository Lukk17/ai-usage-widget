import QtQuick
import QtQuick.Layouts
import org.kde.kirigami as Kirigami

MouseArea {
    id: compact

    signal activated()

    implicitWidth: icon.implicitWidth + Kirigami.Units.smallSpacing * 2
    implicitHeight: icon.implicitHeight
    Layout.minimumWidth: implicitWidth
    hoverEnabled: true
    activeFocusOnTab: true
    onClicked: activated()
    Keys.onReturnPressed: activated()
    Keys.onSpacePressed: activated()

    Accessible.role: Accessible.Button
    Accessible.name: "AI usage"
    Accessible.description: "Opens the AI usage details"
    Accessible.onPressAction: compact.activated()

    Kirigami.Icon {
        id: icon

        objectName: "panelIcon"
        anchors.centerIn: parent
        source: "office-chart-bar"
        implicitWidth: Kirigami.Units.iconSizes.small
        implicitHeight: Kirigami.Units.iconSizes.small
        active: compact.containsMouse
        Accessible.ignored: true
    }
}
