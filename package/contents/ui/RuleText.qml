import QtQuick
import QtQuick.Layouts
import org.kde.kirigami as Kirigami
import org.kde.plasma.components as PlasmaComponents

import "../code/core/formatter.mjs" as Formatter

PlasmaComponents.Label {
    property bool isError: false

    SeverityColors {
        id: colors
    }

    textFormat: Text.PlainText
    wrapMode: Text.Wrap
    color: isError ? colors.text(Formatter.SEVERITY.CRITICAL) : Kirigami.Theme.textColor
    opacity: isError ? 1 : 0.7
    font.pointSize: Kirigami.Theme.smallFont.pointSize
    Layout.fillWidth: true
}
