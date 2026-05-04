# V22.2.1 PDF Page Lifecycle Dedupe

This patch replaces:

`addons/cad-toolkit/core/PdfPageLifecycleManager.js`

## Fix
V22.2 was correctly coordinating PDF page changes, but it emitted repeated `cad:pdf-page-changed` events for the same page.

That caused repeated logs from EmptyExtractionGuard and repeated geometry refresh scheduling.

V22.2.1:
- emits only one corrected `cad:pdf-page-changed` per page transition
- still emits lightweight `cad:pdf-page-visual-ready` events
- schedules the PDF geometry bridge only once per transition
- prevents ContentRecognition late events from re-triggering page extraction

## Check
Use:

```js
window.__essamPdfPageLifecycleV22_2_1.getSummary()
```

Look for:

- `correctedEventCount`
- `duplicatePageEventsSuppressed`
- `bridgeScheduleCount`
