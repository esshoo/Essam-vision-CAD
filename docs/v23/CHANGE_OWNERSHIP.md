# Change Ownership

## /addons/essam-core/v23/document
Owner: Document Model.
Can define schemas and package structure.
Cannot access viewer or DOM.

## /addons/essam-core/v23/parser
Owner: Parser contracts.
Can define parser outputs.
Cannot render or export.

## /addons/essam-core/v23/converters
Owner: Temporary migration bridge.
Can read old EntityRegistry.
Cannot mutate old EntityRegistry.

## /addons/essam-core/v23/storage
Owner: Storage and package writing.
Can use IndexedDB.
Cannot use localStorage for heavy data.

## /addons/essam-core/v23/bootstrap
Owner: Safe integration.
Can expose debug APIs.
Cannot modify current viewer behavior.
