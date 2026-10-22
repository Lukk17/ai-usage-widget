import QtQuick
import org.kde.kirigami as Kirigami

import "../code/core/formatter.mjs" as Formatter
import "../code/core/contrast.mjs" as Contrast

Item {
    id: colors

    property color background: Kirigami.Theme.backgroundColor
    readonly property var cardBackground: Contrast.cardBackground(colors.background, Kirigami.Theme.textColor)

    visible: false

    function themeColor(severity) {
        switch (severity) {
        case Formatter.SEVERITY.CRITICAL:
            return Kirigami.Theme.negativeTextColor
        case Formatter.SEVERITY.WARNING:
            return Kirigami.Theme.neutralTextColor
        case Formatter.SEVERITY.UNKNOWN:
            return Kirigami.Theme.disabledTextColor
        default:
            return Kirigami.Theme.textColor
        }
    }

    function readable(color) {
        const fixed = Contrast.readableOn(color, colors.cardBackground)
        return Qt.rgba(fixed.r, fixed.g, fixed.b, 1)
    }

    function text(severity) {
        const color = themeColor(severity)
        return severity === Formatter.SEVERITY.CRITICAL || severity === Formatter.SEVERITY.WARNING ? readable(color) : color
    }

    function bar(severity) {
        return severity === Formatter.SEVERITY.NORMAL ? Kirigami.Theme.highlightColor : themeColor(severity)
    }

    function track() {
        const base = Kirigami.Theme.textColor
        return Qt.rgba(base.r, base.g, base.b, 0.15)
    }
}
