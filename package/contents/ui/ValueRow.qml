import QtQuick
import QtQuick.Layouts
import org.kde.kirigami as Kirigami
import org.kde.plasma.components as PlasmaComponents

import "../code/core/formatter.mjs" as Formatter

RowLayout {
    id: row

    property string label
    property string value
    property bool isProblem: false

    SeverityColors {
        id: colors
    }

    PlasmaComponents.Label {
        text: row.label
        textFormat: Text.PlainText
        elide: Text.ElideRight
        Layout.fillWidth: !row.isProblem
        Layout.alignment: Qt.AlignTop
    }

    PlasmaComponents.Label {
        objectName: "valueText"
        text: row.value
        textFormat: Text.PlainText
        color: row.isProblem ? colors.text(Formatter.SEVERITY.WARNING) : Kirigami.Theme.textColor
        wrapMode: row.isProblem ? Text.Wrap : Text.NoWrap
        horizontalAlignment: Text.AlignRight
        font.features: { "tnum": 1 }
        Layout.fillWidth: row.isProblem
    }
}
