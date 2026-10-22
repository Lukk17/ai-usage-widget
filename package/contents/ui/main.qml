pragma ComponentBehavior: Bound

import QtQuick
import org.kde.plasma.core as PlasmaCore
import org.kde.plasma.plasmoid

PlasmoidItem {
    id: root

    readonly property bool onDesktop: Plasmoid.formFactor === PlasmaCore.Types.Planar || Plasmoid.formFactor === PlasmaCore.Types.MediaCenter

    toolTipMainText: "AI usage"
    toolTipSubText: ""
    toolTipTextFormat: Text.PlainText
    preferredRepresentation: onDesktop ? fullRepresentation : compactRepresentation
    Plasmoid.backgroundHints: PlasmaCore.Types.TranslucentBackground

    UsageController {
        id: usage
        legacyConfiguration: Plasmoid.configuration
    }

    compactRepresentation: CompactView {
        onActivated: root.expanded = !root.expanded
    }

    fullRepresentation: FullView {
        controller: usage
        title: Plasmoid.title
        popupExpanded: root.expanded
    }
}
