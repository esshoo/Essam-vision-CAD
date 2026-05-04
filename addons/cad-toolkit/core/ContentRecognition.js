/**
 * ContentRecognition.js
 *
 * Purpose:
 * - When a PDF arrives as one big model layer, extract extra semantic layers from the PDF itself.
 * - Start with embedded PDF text and embedded image operators.
 * - Keep OCR as a later optional step for scanned PDFs.
 *
 * Output is cached on window.__essamContentRecognition so existing synchronous tools can merge it.
 */

const TEXT_LAYER = "PDF_TEXT";
const IMAGE_LAYER = "PDF_IMAGES";
const MAX_TEXT_ITEMS_PER_PAGE = 25000;
const MAX_IMAGE_ITEMS_PER_PAGE = 5000;

export class ContentRecognition {
  constructor(app) {
    this.app = app || null;
    this._lastKey = null;
    this._runningKey = null;
  }

  async recognizeCurrentFile(options = {}) {
    const app = this.app || window.cadApp;
    const file = options.file || app?.currentFile || app?.uploader?.file || null;
    const fileName = options.fileName || app?.currentFileName || file?.name || "Project";
    const currentPage = Number(options.page || app?._pdfCurrentPage || 1) || 1;

    if (!file || !isPdfFile(fileName)) {
      const empty = makeEmptyResult({ fileName, reason: "not-pdf" });
      setCache(empty);
      return empty;
    }

    const key = `${fileName}:${file.size || 0}:${file.lastModified || 0}:page-${currentPage}`;
    if (!options.force && this._lastKey === key && getCache()?.status === "ready") return getCache();
    if (this._runningKey === key) return getCache();

    this._runningKey = key;
    setCache({
      status: "running",
      fileName,
      fileType: "pdf",
      currentPage,
      layers: [],
      entities: [],
      report: { message: "recognition-running" },
      updatedAt: Date.now(),
    });

    try {
      const pdfjsLib = getPdfjsLib();
      if (!pdfjsLib?.getDocument) throw new Error("pdfjsLib.getDocument is not available");
      preparePdfWorker(pdfjsLib);

      const buffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: buffer });
      const pdf = await (loadingTask.promise || loadingTask);
      const pageCount = Number(pdf?.numPages || 0);
      const pageNumber = clamp(currentPage, 1, pageCount || 1);
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });

      const entities = [];
      const layers = new Set();

      const textEntities = await extractTextEntities(page, viewport, { fileName, pageNumber });
      if (textEntities.length) {
        layers.add(TEXT_LAYER);
        entities.push(...textEntities);
      }

      const imageEntities = await extractImageEntities(page, viewport, { fileName, pageNumber, pdfjsLib });
      if (imageEntities.length) {
        layers.add(IMAGE_LAYER);
        entities.push(...imageEntities);
      }

      const result = {
        status: "ready",
        source: "pdf-content-recognition",
        fileName,
        fileType: "pdf",
        currentPage: pageNumber,
        pageCount,
        layers: Array.from(layers),
        entities,
        report: {
          page: pageNumber,
          pageCount,
          textCount: textEntities.length,
          imageCount: imageEntities.length,
          hasText: textEntities.length > 0,
          hasImages: imageEntities.length > 0,
          note: textEntities.length ? "embedded-text-detected" : "no-embedded-text-detected",
        },
        updatedAt: Date.now(),
      };

      this._lastKey = key;
      setCache(result);
      window.dispatchEvent(new CustomEvent("cad:content-recognition-ready", { detail: result }));
      console.log(`[ContentRecognition] PDF page ${pageNumber}: text=${textEntities.length}, images=${imageEntities.length}`);
      return result;
    } catch (err) {
      const failed = makeEmptyResult({ fileName, reason: "recognition-failed", error: String(err?.message || err), currentPage });
      setCache(failed);
      window.dispatchEvent(new CustomEvent("cad:content-recognition-ready", { detail: failed }));
      console.warn("[ContentRecognition] failed:", err);
      return failed;
    } finally {
      this._runningKey = null;
    }
  }

  static getCached() {
    return getCache();
  }

  static getCachedLayers() {
    const data = getCache();
    return data?.status === "ready" && Array.isArray(data.layers) ? data.layers : [];
  }

  static getCachedEntities() {
    const data = getCache();
    return data?.status === "ready" && Array.isArray(data.entities) ? data.entities : [];
  }
}

async function extractTextEntities(page, viewport, meta) {
  const out = [];
  const textContent = await page.getTextContent({ includeMarkedContent: false, disableNormalization: false });
  const items = Array.isArray(textContent?.items) ? textContent.items : [];

  for (let i = 0; i < items.length && out.length < MAX_TEXT_ITEMS_PER_PAGE; i++) {
    const item = items[i];
    const str = String(item?.str || "").trim();
    if (!str) continue;

    const box = textItemToBox(item, viewport);
    if (!box || !isFiniteBox(box)) continue;

    out.push({
      id: makeId("txt", meta.pageNumber, i, str),
      sourceId: `pdf-text:${meta.pageNumber}:${i}`,
      layer: TEXT_LAYER,
      kind: "TEXT",
      text: str,
      points: rectToPoints(box),
      bbox: box,
      source: "pdf-text-content",
      meta: {
        page: meta.pageNumber,
        fontName: item.fontName || null,
        dir: item.dir || null,
        width: item.width || null,
        height: item.height || null,
        transform: Array.isArray(item.transform) ? item.transform.slice(0, 6) : null,
      },
    });
  }

  return out;
}

async function extractImageEntities(page, viewport, meta) {
  const out = [];
  let opList = null;
  try {
    opList = await page.getOperatorList({ intent: "display" });
  } catch (_) {
    return out;
  }

  const fnArray = Array.isArray(opList?.fnArray) ? opList.fnArray : [];
  const argsArray = Array.isArray(opList?.argsArray) ? opList.argsArray : [];
  const OPS = meta.pdfjsLib?.OPS || {};
  const imageOps = new Set([
    OPS.paintImageXObject,
    OPS.paintImageXObjectRepeat,
    OPS.paintJpegXObject,
    OPS.paintInlineImageXObject,
    OPS.paintInlineImageXObjectGroup,
    OPS.paintImageMaskXObject,
    OPS.paintImageMaskXObjectGroup,
  ].filter((v) => v !== undefined && v !== null));

  for (let i = 0; i < fnArray.length && out.length < MAX_IMAGE_ITEMS_PER_PAGE; i++) {
    if (!imageOps.has(fnArray[i])) continue;

    // PDF.js operator lists expose image drawing operations, but not always a clean user-space bbox.
    // We still create a selectable semantic entity. Later we can improve placement by replaying transforms.
    const args = argsArray[i] || [];
    const box = estimateImageBoxFromPage(viewport, out.length);
    out.push({
      id: makeId("img", meta.pageNumber, i, String(args?.[0] || "image")),
      sourceId: `pdf-image:${meta.pageNumber}:${i}`,
      layer: IMAGE_LAYER,
      kind: "IMAGE",
      points: rectToPoints(box),
      bbox: box,
      source: "pdf-operator-list",
      meta: {
        page: meta.pageNumber,
        operator: fnArray[i],
        argsPreview: safeArgsPreview(args),
        placementQuality: "estimated-page-region",
      },
    });
  }

  return out;
}

function textItemToBox(item, viewport) {
  const t = Array.isArray(item?.transform) ? item.transform : null;
  if (!t || t.length < 6) return null;

  const x = Number(t[4]) || 0;
  const y = Number(t[5]) || 0;
  const width = Math.max(0.001, Number(item.width) || Math.abs(Number(t[0])) || String(item.str || "").length * 6);
  const height = Math.max(0.001, Number(item.height) || Math.abs(Number(t[3])) || Math.abs(Number(t[0])) || 8);

  // Keep PDF user-space coordinates. This is stable for entity management.
  // Rendering alignment with x-viewer can be refined later with a PDF-to-viewer transform adapter.
  let minX = x;
  let maxX = x + width;
  let minY = y - height;
  let maxY = y;

  // Clamp wildly invalid items, but do not over-normalize because CAD PDFs may use large coordinates.
  if (viewport?.width && Math.abs(maxX - minX) > viewport.width * 10) maxX = minX + viewport.width;
  if (viewport?.height && Math.abs(maxY - minY) > viewport.height * 10) minY = maxY - viewport.height;

  return normalizeBox({ minX, minY, maxX, maxY });
}

function estimateImageBoxFromPage(viewport, index) {
  const width = Number(viewport?.width || 1000);
  const height = Number(viewport?.height || 1000);
  const inset = Math.min(width, height) * 0.04;
  const slot = Math.min(0.7, 0.18 + (index % 4) * 0.08);
  const w = width * slot;
  const h = height * slot;
  const x = inset + (index % 3) * (width * 0.05);
  const y = inset + (index % 3) * (height * 0.05);
  return normalizeBox({ minX: x, minY: y, maxX: Math.min(width - inset, x + w), maxY: Math.min(height - inset, y + h) });
}

function rectToPoints(box) {
  return [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
    { x: box.minX, y: box.minY },
  ];
}

function normalizeBox(box) {
  const minX = Math.min(Number(box.minX), Number(box.maxX));
  const maxX = Math.max(Number(box.minX), Number(box.maxX));
  const minY = Math.min(Number(box.minY), Number(box.maxY));
  const maxY = Math.max(Number(box.minY), Number(box.maxY));
  return { minX, minY, maxX, maxY };
}

function isFiniteBox(box) {
  return [box.minX, box.minY, box.maxX, box.maxY].every(Number.isFinite) && box.maxX > box.minX && box.maxY > box.minY;
}

function safeArgsPreview(args) {
  try {
    return JSON.stringify(args, (_k, v) => {
      if (v && typeof v === "object") return Array.isArray(v) ? v.slice(0, 4) : "[object]";
      return v;
    }).slice(0, 160);
  } catch (_) {
    return null;
  }
}

function getPdfjsLib() {
  return window.pdfjsLib || window.pdfjsDistBuildPdf || window.PDFJS || null;
}

function preparePdfWorker(pdfjsLib) {
  try {
    if (pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = "./libs/pdf/pdf.worker.min.js";
    }
  } catch (_) {}
}

function isPdfFile(fileName) {
  return /\.pdf$/i.test(String(fileName || ""));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function makeId(prefix, page, index, salt = "") {
  return `${prefix}_p${page}_${index}_${hashSmall(String(salt))}`;
}

function hashSmall(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function makeEmptyResult({ fileName = "Project", reason = "empty", error = null, currentPage = 1 } = {}) {
  return {
    status: error ? "error" : "empty",
    source: "pdf-content-recognition",
    fileName,
    fileType: isPdfFile(fileName) ? "pdf" : "unknown",
    currentPage,
    pageCount: 0,
    layers: [],
    entities: [],
    report: { reason, error },
    updatedAt: Date.now(),
  };
}

function setCache(data) {
  try { window.__essamContentRecognition = data; } catch (_) {}
}

function getCache() {
  try { return window.__essamContentRecognition || null; } catch (_) { return null; }
}

export const PDF_CONTENT_LAYERS = { TEXT_LAYER, IMAGE_LAYER };
