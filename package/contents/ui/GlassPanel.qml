import QtQuick
import org.kde.kirigami as Kirigami

import "../code/core/contrast.mjs" as Contrast

Rectangle {
    readonly property color base: Kirigami.Theme.textColor

    radius: Kirigami.Units.cornerRadius * 2
    color: Qt.rgba(base.r, base.g, base.b, Contrast.CARD_TINT_ALPHA)
    border.width: 1
    border.color: Qt.rgba(base.r, base.g, base.b, 0.12)
}
