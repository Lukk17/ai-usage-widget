import QtQuick
import QtQuick.Layouts
import org.kde.kirigami as Kirigami
import org.kde.plasma.components as PlasmaComponents

ColumnLayout {
    id: bar

    property var item

    spacing: Math.round(Kirigami.Units.smallSpacing / 2)

    Accessible.role: Accessible.ProgressBar
    Accessible.name: bar.item.label
    Accessible.description: bar.item.percentText + (bar.item.resetText !== "" ? ", " + bar.item.resetText : "")

    SeverityColors {
        id: colors
    }

    RowLayout {
        Layout.fillWidth: true

        PlasmaComponents.Label {
            objectName: "barLabel"
            text: bar.item.label
            textFormat: Text.PlainText
            elide: Text.ElideRight
            Layout.fillWidth: true
            Accessible.ignored: true
        }

        PlasmaComponents.Label {
            objectName: "percentText"
            text: bar.item.percentText
            textFormat: Text.PlainText
            color: colors.text(bar.item.severity)
            font.features: { "tnum": 1 }
            Accessible.ignored: true
        }
    }

    Rectangle {
        Layout.fillWidth: true
        implicitHeight: Kirigami.Units.smallSpacing * 1.5
        radius: height / 2
        color: colors.track()

        Rectangle {
            width: parent.width * bar.item.fraction
            height: parent.height
            radius: parent.radius
            color: colors.bar(bar.item.severity)
        }
    }

    PlasmaComponents.Label {
        objectName: "resetText"
        visible: bar.item.resetText !== ""
        text: bar.item.resetText
        textFormat: Text.PlainText
        opacity: 0.7
        font.pointSize: Kirigami.Theme.smallFont.pointSize
        Layout.fillWidth: true
        wrapMode: Text.Wrap
        Accessible.ignored: true
    }
}
