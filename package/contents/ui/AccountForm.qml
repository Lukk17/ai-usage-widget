pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Layouts
import org.kde.kirigami as Kirigami
import org.kde.plasma.components as PlasmaComponents
import org.kde.plasma.extras as PlasmaExtras

import "../code/core/accounts.mjs" as Accounts
import "../code/core/formatter.mjs" as Formatter
import "../code/providers/registry.mjs" as Registry

GlassPanel {
    id: form

    property var controller
    property var editing: null
    property bool busy: false
    property bool active: false
    readonly property var providers: Registry.ALL_PROVIDERS
    readonly property var provider: editing ? Registry.findProvider(editing.service) : (serviceBox.currentIndex >= 0 ? providers[serviceBox.currentIndex] : null)
    readonly property bool hasProvider: provider !== null
    readonly property bool isDiscovery: hasProvider && editing === null && typeof provider.discover === "function"
    readonly property bool needsKey: hasProvider && provider.needsKey
    readonly property var typedFields: hasProvider ? provider.fields.filter(field => field.typed) : []
    property var fieldValues: ({})
    property var discovered: []
    property var discoveryNames: Object.create(null)
    property var discoveryResult: null
    readonly property string discoveryText: isDiscovery ? Formatter.discoveryText(provider, discoveryResult, discovered.length) : ""
    readonly property bool nameValid: Accounts.isValidName(nameField.text)
    readonly property bool namesValid: isDiscovery ? Accounts.areDiscoveryNamesValid(discoveryNames) : nameValid
    readonly property bool fieldsValid: typedFields.every(field => Accounts.isValidField(fieldValues[field.id] || ""))
    readonly property bool keyReady: !needsKey || editing !== null || Accounts.cleanKey(keyField.text) !== ""
    readonly property bool canSave: hasProvider && !busy && namesValid && fieldsValid && keyReady

    signal submitted(var work)
    signal fieldsReset()
    signal cancelled()

    implicitHeight: content.implicitHeight + Kirigami.Units.largeSpacing * 2

    function clear() {
        serviceBox.currentIndex = -1
        reset()
    }

    function reset() {
        const current = editing ? Registry.findProvider(editing.service) : (serviceBox.currentIndex >= 0 ? providers[serviceBox.currentIndex] : null)
        nameField.text = editing ? editing.name : ""
        keyField.text = ""
        const values = {}
        if (current) {
            current.fields.forEach(field => { values[field.id] = editing && typeof editing[field.id] === "string" ? editing[field.id] : "" })
        }
        fieldValues = values
        fieldsReset()
        discovered = []
        discoveryNames = Object.create(null)
        discoveryResult = null
        if (active && current && editing === null && typeof current.discover === "function" && controller) {
            discover(current.id)
        }
    }

    function discover(providerId) {
        controller.discover(providerId).then(result => {
            if (!form.hasProvider || form.provider.id !== providerId || !form.controller) {
                return
            }
            discovered = result.ok ? controller.newDiscoveries(providerId, result.items) : []
            discoveryResult = result
        })
    }

    function setDiscoveryName(org, text) {
        const names = Object.assign(Object.create(null), discoveryNames)
        names[org] = text
        discoveryNames = names
    }

    function setFieldValue(id, text) {
        const values = Object.assign({}, fieldValues)
        values[id] = text
        fieldValues = values
    }

    function cancel() {
        if (busy && controller) {
            controller.cancelWalletWait()
        }
        cancelled()
    }

    function submit() {
        const key = keyField.text
        if (isDiscovery) {
            submitted(controller.addAccounts(provider.id, discovered.map(item => ({ fields: item.fields, name: discoveryNames[item.fields.org] || "" }))))
        } else if (editing) {
            submitted(controller.editAccount(editing.id, { name: nameField.text, key: key, fields: fieldValues }))
        } else {
            submitted(controller.addAccount({ service: provider.id, name: nameField.text, key: key, fields: fieldValues }))
        }
    }

    onEditingChanged: reset()
    onProviderChanged: reset()
    onActiveChanged: reset()

    ColumnLayout {
        id: content

        anchors.fill: parent
        anchors.margins: Kirigami.Units.largeSpacing
        spacing: Kirigami.Units.smallSpacing

        Kirigami.Heading {
            level: 4
            text: form.editing && form.hasProvider ? "Edit " + form.provider.title : "Add account"
            textFormat: Text.PlainText
        }

        PlasmaComponents.ComboBox {
            id: serviceBox

            objectName: "serviceBox"
            visible: form.editing === null
            model: form.providers
            textRole: "title"
            currentIndex: -1
            displayText: currentIndex < 0 ? Formatter.serviceRuleText() : currentText
            Layout.fillWidth: true
            Accessible.name: "Service"
        }

        RowLayout {
            visible: form.hasProvider && !form.isDiscovery
            Layout.fillWidth: true

            PlasmaComponents.TextField {
                id: nameField

                objectName: "nameField"
                placeholderText: "Name or email"
                maximumLength: Accounts.MAX_ACCOUNT_NAME_LENGTH
                Layout.fillWidth: true
                Accessible.name: "Name or email"
            }

            HelpButton {
                objectName: "nameHelpButton"
                visible: form.hasProvider && !form.provider.needsKey && form.provider.keyHelp !== ""
                helpText: form.hasProvider ? form.provider.keyHelp : ""
            }
        }

        RuleText {
            objectName: "nameRule"
            visible: form.hasProvider && !form.isDiscovery && !form.nameValid
            text: Formatter.nameRuleText()
            isError: nameField.text !== ""
        }

        Repeater {
            model: form.typedFields

            ColumnLayout {
                id: typedItem

                required property var modelData

                spacing: 0
                Layout.fillWidth: true

                PlasmaComponents.TextField {
                    id: typedField

                    objectName: "field-" + typedItem.modelData.id
                    placeholderText: typedItem.modelData.label
                    onTextChanged: form.setFieldValue(typedItem.modelData.id, typedField.text)
                    Component.onCompleted: typedField.text = form.fieldValues[typedItem.modelData.id] || ""

                    Connections {
                        target: form

                        function onFieldsReset() {
                            typedField.text = form.fieldValues[typedItem.modelData.id] || ""
                        }
                    }
                    Layout.fillWidth: true
                    Accessible.name: typedItem.modelData.label
                }

                RuleText {
                    objectName: "fieldRule-" + typedItem.modelData.id
                    visible: !Accounts.isValidField(typedField.text)
                    text: Formatter.fieldRuleText(typedItem.modelData.label)
                    isError: typedField.text !== ""
                }
            }
        }

        RowLayout {
            visible: form.needsKey
            Layout.fillWidth: true

            PlasmaExtras.PasswordField {
                id: keyField

                objectName: "keyField"
                placeholderText: form.editing ? "New key, or leave empty to keep the saved key" : Formatter.keyRuleText()
                Layout.fillWidth: true
                Accessible.name: "Key"
            }

            HelpButton {
                objectName: "keyHelpButton"
                helpText: form.hasProvider ? form.provider.keyHelp : ""
            }
        }

        RuleText {
            objectName: "keyRule"
            visible: form.needsKey && !form.keyReady
            text: Formatter.keyRuleText()
            isError: false
        }

        PlasmaComponents.BusyIndicator {
            visible: form.isDiscovery && form.discoveryResult === null
            running: visible
            Accessible.name: form.discoveryText
        }

        PlasmaComponents.Label {
            objectName: "discoveryText"
            visible: form.discoveryText !== ""
            text: form.discoveryText
            textFormat: Text.PlainText
            wrapMode: Text.Wrap
            opacity: 0.7
            Layout.fillWidth: true
        }

        Repeater {
            model: form.isDiscovery ? form.discovered : []

            ColumnLayout {
                id: found

                required property var modelData

                spacing: 0
                Layout.fillWidth: true

                PlasmaComponents.Label {
                    text: found.modelData.fields.org + ": " + Formatter.usageSummaryText(found.modelData.usage)
                    textFormat: Text.PlainText
                    wrapMode: Text.WrapAnywhere
                    opacity: 0.7
                    font.pointSize: Kirigami.Theme.smallFont.pointSize
                    Layout.fillWidth: true
                }

                PlasmaComponents.TextField {
                    id: orgName

                    objectName: "orgName-" + found.modelData.fields.org
                    placeholderText: "Name or email"
                    maximumLength: Accounts.MAX_ACCOUNT_NAME_LENGTH
                    onTextChanged: form.setDiscoveryName(found.modelData.fields.org, orgName.text)
                    Layout.fillWidth: true
                    Accessible.name: "Name or email for " + found.modelData.fields.org
                }
            }
        }

        RuleText {
            objectName: "discoveryRule"
            visible: form.isDiscovery && form.discovered.length > 0 && !form.namesValid
            text: Formatter.discoveryNamesRuleText()
            isError: false
        }

        RowLayout {
            Layout.fillWidth: true

            Item {
                Layout.fillWidth: true
            }

            PlasmaComponents.Button {
                objectName: "cancelButton"
                text: "Cancel"
                onClicked: form.cancel()
            }

            PlasmaComponents.Button {
                objectName: "saveButton"
                text: "Save"
                icon.name: "document-save"
                enabled: form.canSave
                onClicked: form.submit()
            }
        }
    }
}
