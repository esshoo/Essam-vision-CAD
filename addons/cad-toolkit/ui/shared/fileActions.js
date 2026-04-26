export function openSourceFile() {
  window.cadApp?.openFileUpload?.();
}

export function refreshPage() {
  window.location.reload();
}

export function openAnnotationsJson() {
  window.cadDrawingOverlay?.importAnnotationsJson?.();
}

export function openSaved3DView() {
  window.cad3dOpen?.();
}
