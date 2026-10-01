/**
 * A tiny module-level flag shared between the Code page (which knows about
 * unsaved tabs) and shell actions that would discard them (switching projects,
 * closing the window).
 */

let dirty = false

export function setEditorDirty(value: boolean): void {
  dirty = value
}

export function editorIsDirty(): boolean {
  return dirty
}

/** Returns true when it's safe to continue; asks first when tabs are dirty. */
export function confirmDiscardChanges(message = "You have unsaved editor changes. Continue and discard them?"): boolean {
  if (!dirty) return true
  return window.confirm(message)
}
