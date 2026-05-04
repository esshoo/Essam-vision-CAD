/**
 * ProjectExporter.js
 * V22.1 - No-op Export Safety
 *
 * Rule zero:
 *   If the current PDF/DXF has no real EntityRegistry edits, export the
 *   original uploaded file bytes unchanged.
 *
 * This is a stabilization patch, not a feature patch. It prevents the exporter
 * from rebuilding PDF/DXF files when the user has not made destructive edits.
 * Layer display rules are ignored for source passthrough because hide/show in
 * the UI is a view state, not a destructive file edit.
 */

export const ProjectExporter = {
  version: "V22.1",

  async exportDXF({ entities = [], fileName = "EssamVisionCAD", rules = null } = {}) {
    const registry = window.__essamEntityRegistry || null;
    const allEntities = registry?.getAll?.({ includeDeleted: true }) || entities || [];
    const sourceText = await getOriginalDXFText(fileName);

    if (sourceText) {
      // V20.1: DXF source export must not treat LayerRulesPanel display/3D rules as destructive edits.
      // The no-op baseline must export the original DXF byte/text content unchanged.
      // Only real EntityRegistry edits are destructive for DXF source export:
      // deleted / hidden / moved entities.
      const sourceExportRules = null;
      const editSummary = buildEditSummary(allEntities, sourceExportRules);

      if (editSummary.realEditCount === 0) {
        const originalFile = getOriginalUploadedFile(fileName, "dxf");
        const result = originalFile
          ? downloadOriginalFile(`${stripExt(fileName)}_edited.dxf`, originalFile, "application/dxf")
          : downloadText(`${stripExt(fileName)}_edited.dxf`, sourceText, "application/dxf;charset=utf-8");
        console.info("[ProjectExporter V22.1] Original DXF bytes passthrough exported", { ...result, editSummary, ignoredLayerRules: !!rules, byteExact: !!originalFile });
        return { ok: true, mode: "source-passthrough-no-edits", reason: "source-passthrough-no-edits", ...result, editSummary, ignoredLayerRules: !!rules, byteExact: !!originalFile };
      }

      const patched = buildSourcePatchedDXF(sourceText, allEntities, sourceExportRules);
      if (patched.ok) {
        const result = downloadText(`${stripExt(fileName)}_edited.dxf`, patched.text, "application/dxf;charset=utf-8");
        console.info("[ProjectExporter V22.1] Source-patched DXF exported", { ...result, stats: patched.stats, editSummary });
        return { ok: true, mode: "source-patched", ...result, stats: patched.stats, editSummary };
      }
      console.warn("[ProjectExporter V22.1] Source patch failed, falling back to simple export", patched);
    } else {
      console.warn("[ProjectExporter V22.1] Original DXF text not available. Falling back to simple export.");
    }

    const visibleEntities = this.getVisibleEntities({ registry, rules });
    const simple = buildSimpleDXF(visibleEntities, rules);
    if (!simple.stats.lineCount && !simple.stats.textCount) {
      alert("لا توجد عناصر هندسية قابلة للتصدير داخل DXF.");
      return { ok: false, reason: "no-exportable-entities", stats: simple.stats };
    }
    const result = downloadText(`${stripExt(fileName)}_edited.dxf`, simple.text, "application/dxf;charset=utf-8");
    return { ok: true, mode: "simple-fallback", ...result, stats: simple.stats };
  },

  async exportDWG({ entities = [], fileName = "EssamVisionCAD", rules = null } = {}) {
    alert("تصدير DWG الحقيقي يحتاج SDK أو خدمة تحويل خارجية. سيتم تصدير DXF معدل مع الحفاظ على الأصل قدر الإمكان.");
    return this.exportDXF({ entities, fileName: `${stripExt(fileName)}_dwg_fallback`, rules });
  },

  async exportPDF({ entities = [], fileName = "EssamVisionCAD", rules = null } = {}) {
    const registry = window.__essamEntityRegistry || null;
    const allEntities = registry?.getAll?.({ includeDeleted: true }) || entities || [];
    const editSummary = buildEditSummary(allEntities, null);

    // V22.1: No-op PDF export must be original bytes, not a rebuilt PDF canvas/vector approximation.
    if (editSummary.realEditCount === 0) {
      const originalFile = getOriginalUploadedFile(fileName, "pdf");
      if (originalFile) {
        const result = downloadOriginalFile(`${stripExt(fileName)}_edited.pdf`, originalFile, "application/pdf");
        console.info("[ProjectExporter V22.1] Original PDF bytes passthrough exported", { ...result, editSummary, ignoredLayerRules: !!rules, byteExact: true });
        return { ok: true, mode: "source-passthrough-no-edits", reason: "source-passthrough-no-edits", ...result, editSummary, ignoredLayerRules: !!rules, byteExact: true };
      }
      console.warn("[ProjectExporter V22.1] Original PDF file object not available. Falling back to rebuilt PDF.", { editSummary });
    }

    const PDFLib = window.PDFLib || window.pdfLib || window["pdf-lib"];
    if (!PDFLib?.PDFDocument) {
      alert("pdf-lib غير محمل في الصفحة. سيتم تصدير SVG مؤقت بدل PDF.");
      return this.exportSVG({ entities, fileName, rules });
    }

    const visible = this.getVisibleEntities({ rules });
    const { PDFDocument, rgb } = PDFLib;
    const pdfDoc = await PDFDocument.create();
    const pageW = 1190;
    const pageH = 842;
    const margin = 32;
    const page = pdfDoc.addPage([pageW, pageH]);
    const mapper = makeMapper(visible, pageW, pageH, margin);

    for (const entity of visible) {
      const pts = getPoints(entity);
      if (pts.length < 2) continue;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = mapper(pts[i]);
        const b = mapper(pts[i + 1]);
        page.drawLine({ start: a, end: b, thickness: 0.45, color: rgb(0, 0, 0) });
      }
    }

    const bytes = await pdfDoc.save();
    const result = downloadBlob(`${stripExt(fileName)}_edited.pdf`, new Blob([bytes], { type: "application/pdf" }));
    console.info("[ProjectExporter V22.1] Rebuilt PDF exported because edits exist or source file unavailable", { ...result, editSummary });
    return { ok: true, mode: "rebuilt-pdf", ...result, editSummary, byteExact: false };
  },

  exportSVG({ entities = [], fileName = "EssamVisionCAD", rules = null } = {}) {
    const visible = this.getVisibleEntities({ rules });
    const w = 1400, h = 1000, margin = 30;
    const mapper = makeMapper(visible, w, h, margin);
    const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`, `<rect width="100%" height="100%" fill="white"/>`];
    for (const entity of visible) {
      const pts = getPoints(entity);
      if (pts.length < 2) continue;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = mapper(pts[i]);
        const b = mapper(pts[i + 1]);
        parts.push(`<line x1="${a.x.toFixed(2)}" y1="${a.y.toFixed(2)}" x2="${b.x.toFixed(2)}" y2="${b.y.toFixed(2)}" stroke="black" stroke-width="1"/>`);
      }
    }
    parts.push("</svg>");
    return downloadText(`${stripExt(fileName)}_edited.svg`, parts.join("\n"), "image/svg+xml;charset=utf-8");
  },

  getVisibleEntities({ registry = window.__essamEntityRegistry, rules = null } = {}) {
    const entities = registry?.getAll?.({ includeDeleted: false }) || [];
    return entities.filter((entity) => isEntityExportVisible(entity, rules));
  },

  // Debug helper from console:
  // window.ProjectExporter.debugDXFMatch()
  async debugDXFMatch({ fileName = null, rules = null } = {}) {
    const sourceText = await getOriginalDXFText(fileName);
    const entities = window.__essamEntityRegistry?.getAll?.({ includeDeleted: true }) || [];
    if (!sourceText) return { ok: false, reason: "no-original-dxf-text", entityCount: entities.length };
    const parsed = parseDXF(sourceText);
    // Debug defaults to the same behavior as DXF source export: ignore LayerRulesPanel display rules.
    const sourceExportRules = null;
    const editSummary = buildEditSummary(entities, sourceExportRules);
    if (editSummary.realEditCount === 0) {
      return {
        ok: true,
        reason: "source-passthrough-no-edits",
        mode: "source-passthrough-no-edits",
        editSummary,
        sourceInfo: {
          textLength: sourceText.length,
          lineCount: parsed.lines?.length || 0,
          sections: parsed.sections?.map((s) => s.name) || [],
          hasEntitiesSection: !!parsed.entitiesSection,
          entityRecordCount: parsed.entityRecords?.length || 0,
          layerCount: parsed.layerNames?.size || 0,
          first80: sourceText.slice(0, 80),
        },
      };
    }
    const result = buildSourcePatchedDXF(sourceText, entities, sourceExportRules);
    return {
      ok: result.ok,
      reason: result.reason || null,
      mode: result.ok ? "source-patched" : "source-patch-failed",
      stats: result.stats,
      editSummary,
      sourceInfo: {
        textLength: sourceText.length,
        lineCount: parsed.lines?.length || 0,
        sections: parsed.sections?.map((s) => s.name) || [],
        hasEntitiesSection: !!parsed.entitiesSection,
        entityRecordCount: parsed.entityRecords?.length || 0,
        layerCount: parsed.layerNames?.size || 0,
        first80: sourceText.slice(0, 80),
      },
    };
  },


  async debugNoopExportSafety({ fileName = null } = {}) {
    const registry = window.__essamEntityRegistry || null;
    const entities = registry?.getAll?.({ includeDeleted: true }) || [];
    const editSummary = buildEditSummary(entities, null);
    const sourceFile = getOriginalUploadedFile(fileName, null);
    return {
      ok: true,
      version: this.version,
      fileName: sourceFile?.name || fileName || null,
      fileSize: sourceFile?.size || 0,
      fileType: sourceFile?.type || "",
      hasSourceFile: !!sourceFile,
      noEdits: editSummary.realEditCount === 0,
      willPassthroughOriginalBytes: !!sourceFile && editSummary.realEditCount === 0,
      editSummary,
      registryStats: registry?.getStats?.() || null,
    };
  },
};

try { window.ProjectExporter = ProjectExporter; } catch (_) {}

function getOriginalUploadedFile(fileName = null, ext = null) {
  const candidates = [
    window.cadApp?.uploader?.file,
    window.cadApp?.currentFile,
    window.__essamCurrentFile,
    window.__essamActiveFile,
  ].filter(Boolean);

  const expectedExt = ext ? String(ext).toLowerCase().replace(/^\./, "") : "";
  const wantedName = fileName ? String(fileName).toLowerCase() : "";

  for (const file of candidates) {
    const name = String(file?.name || "");
    if (!file || typeof file.size !== "number") continue;
    const lower = name.toLowerCase();
    const extOk = !expectedExt || lower.endsWith(`.${expectedExt}`);
    const nameOk = !wantedName || lower === wantedName || lower === wantedName.replace(/_edited(?=\.)/i, "");
    if (extOk && nameOk) return file;
  }

  const sourceFiles = window.__essamSourceFiles || window.__essamOriginalFiles || null;
  if (sourceFiles) {
    const keys = [fileName, String(fileName || "").toLowerCase()].filter(Boolean);
    for (const key of keys) {
      const entry = sourceFiles[key];
      const file = entry?.file || entry?.blob || entry?.sourceFile;
      if (file && typeof file.size === "number") return file;
    }
  }

  return null;
}

function downloadOriginalFile(fileName, file, fallbackType = "application/octet-stream") {
  const type = file?.type || fallbackType;
  const blob = file instanceof Blob ? file : new Blob([file], { type });
  return downloadBlob(fileName, blob);
}

async function getOriginalDXFText(fileName) {
  const file = window.cadApp?.uploader?.file || window.cadApp?.currentFile || null;
  if (file && /\.dxf$/i.test(file.name || fileName || "")) {
    try {
      const text = await file.text();
      if (looksLikeDXF(text)) return text;
    } catch (err) {
      console.warn("[ProjectExporter V22.1] Could not read original uploaded DXF file", err);
    }
  }

  const sourceFiles = window.__essamSourceFiles || window.__essamOriginalFiles || null;
  const byName = sourceFiles?.[fileName] || sourceFiles?.[String(fileName || "").toLowerCase()];
  const text = byName?.text || byName?.dxfText || null;
  if (looksLikeDXF(text)) return text;

  return null;
}

function looksLikeDXF(text) {
  return typeof text === "string" && /\bSECTION\b/i.test(text) && /\bENTITIES\b/i.test(text) && /\bEOF\b/i.test(text);
}

function buildEditSummary(entities = [], rules = null) {
  const summary = {
    realEditCount: 0,
    deletedCount: 0,
    hiddenCount: 0,
    movedCount: 0,
    ruleHiddenCount: 0,
    geometryEditCount: 0,
  };

  for (const entity of Array.isArray(entities) ? entities : []) {
    if (!isGeometryEntity(entity)) continue;
    const originalLayer = inferOriginalLayer(entity);
    const currentLayer = safeLayer(entity.layer || originalLayer || "0");
    const rule = rules?.[currentLayer];

    const deleted = entity.deleted === true;
    const hidden = entity.visible === false;
    const moved = !!(originalLayer && currentLayer && originalLayer !== currentLayer);
    const ruleHidden = rule?.visible === false || rule?.type === "hide";

    if (deleted) summary.deletedCount += 1;
    if (hidden) summary.hiddenCount += 1;
    if (moved) summary.movedCount += 1;
    if (ruleHidden) summary.ruleHiddenCount += 1;

    if (deleted || hidden || moved || ruleHidden) {
      summary.realEditCount += 1;
      summary.geometryEditCount += 1;
    }
  }

  return summary;
}

function buildSourcePatchedDXF(originalText, registryEntities = [], rules = null) {
  const parsed = parseDXF(originalText);
  if (!parsed.entitiesSection) return { ok: false, reason: "no-entities-section", stats: null };

  const editSummary = buildEditSummary(registryEntities, rules);
  if (editSummary.realEditCount === 0) {
    return { ok: true, reason: "source-passthrough-no-edits", text: originalText, stats: { editSummary, passthrough: true } };
  }

  const editIndex = buildEditIndex(registryEntities, rules);
  const stats = {
    originalRecords: parsed.entityRecords.length,
    preservedRecords: 0,
    removedRecords: 0,
    changedLayerRecords: 0,
    rewrittenPolylineRecords: 0,
    generatedLineRecords: 0,
    matchedSegments: 0,
    editSegments: editIndex.bySegment.size,
    newLayers: 0,
  };

  const desiredLayers = new Set(parsed.layerNames);
  for (const layer of editIndex.targetLayers) desiredLayers.add(layer);

  const entityLines = [];
  for (const record of parsed.entityRecords) {
    const result = patchEntityRecord(record, editIndex, desiredLayers);
    stats.matchedSegments += result.matchedSegments || 0;

    if (result.action === "remove") {
      stats.removedRecords += 1;
      continue;
    }
    if (result.action === "change-layer") {
      stats.changedLayerRecords += 1;
      entityLines.push(...pairsToLines(result.pairs));
      continue;
    }
    if (result.action === "rewrite") {
      stats.rewrittenPolylineRecords += 1;
      stats.generatedLineRecords += result.generatedLineRecords || 0;
      entityLines.push(...pairsToLines(result.pairs));
      continue;
    }

    stats.preservedRecords += 1;
    entityLines.push(...pairsToLines(record.pairs));
  }

  let outLines = [
    ...parsed.lines.slice(0, parsed.entitiesSection.contentStart),
    ...entityLines,
    ...parsed.lines.slice(parsed.entitiesSection.contentEnd),
  ];

  const beforeLayerCount = parsed.layerNames.size;
  outLines = ensureLayerTable(outLines, desiredLayers, parsed.layerNames);
  stats.newLayers = Math.max(0, desiredLayers.size - beforeLayerCount);

  return {
    ok: true,
    text: outLines.join(parsed.lineEnding) + parsed.lineEnding,
    stats,
  };
}

function patchEntityRecord(record, editIndex, desiredLayers) {
  const type = String(record.type || "").toUpperCase();
  if (type === "LINE") return patchLineRecord(record, editIndex, desiredLayers);
  if (type === "LWPOLYLINE") return patchLWPolylineRecord(record, editIndex, desiredLayers);
  if (type === "SOLID" || type === "TRACE") return patchSolidRecord(record, editIndex, desiredLayers);
  return { action: "preserve", pairs: record.pairs, matchedSegments: 0 };
}

function patchLineRecord(record, editIndex, desiredLayers) {
  const layer = recordLayer(record);
  const a = pointFromCodes(record.pairs, "10", "20", "30");
  const b = pointFromCodes(record.pairs, "11", "21", "31");
  const edit = editIndex.bySegment.get(segmentKey(layer, a, b));
  if (!edit) return { action: "preserve", pairs: record.pairs, matchedSegments: 0 };
  if (edit.remove) return { action: "remove", pairs: [], matchedSegments: 1 };
  if (edit.targetLayer && edit.targetLayer !== layer) {
    desiredLayers.add(edit.targetLayer);
    return { action: "change-layer", pairs: replaceLayer(record.pairs, edit.targetLayer), matchedSegments: 1 };
  }
  return { action: "preserve", pairs: record.pairs, matchedSegments: 1 };
}

function patchLWPolylineRecord(record, editIndex, desiredLayers) {
  const layer = recordLayer(record);
  const vertices = lwPolylineVertices(record.pairs);
  if (vertices.length < 2) return { action: "preserve", pairs: record.pairs, matchedSegments: 0 };

  const closed = isLWPolylineClosed(record.pairs);
  const segments = [];
  for (let i = 0; i < vertices.length - 1; i++) segments.push([vertices[i], vertices[i + 1]]);
  if (closed && vertices.length > 2) segments.push([vertices[vertices.length - 1], vertices[0]]);

  let matched = 0;
  let removed = 0;
  const kept = [];
  const targetLayers = new Set();

  for (const [a, b] of segments) {
    const edit = editIndex.bySegment.get(segmentKey(layer, a, b));
    if (edit) matched += 1;
    if (edit?.remove) { removed += 1; continue; }
    const targetLayer = edit?.targetLayer || layer;
    targetLayers.add(targetLayer);
    desiredLayers.add(targetLayer);
    kept.push({ a, b, layer: targetLayer });
  }

  if (!matched) return { action: "preserve", pairs: record.pairs, matchedSegments: 0 };
  if (!kept.length) return { action: "remove", pairs: [], matchedSegments: matched };

  // If only moved and all segments moved to one layer, keep the original polyline record.
  if (!removed && targetLayers.size === 1) {
    const targetLayer = Array.from(targetLayers)[0];
    if (targetLayer !== layer) return { action: "change-layer", pairs: replaceLayer(record.pairs, targetLayer), matchedSegments: matched };
    return { action: "preserve", pairs: record.pairs, matchedSegments: matched };
  }

  // Partial deletion or mixed target layers: rewrite affected polyline as LINE records.
  const pairs = [];
  for (const seg of kept) pairs.push(...makeLinePairs(seg.layer, seg.a, seg.b));
  return { action: "rewrite", pairs, matchedSegments: matched, generatedLineRecords: kept.length };
}

function patchSolidRecord(record, editIndex, desiredLayers) {
  const layer = recordLayer(record);
  const pts = [
    pointFromCodes(record.pairs, "10", "20", "30"),
    pointFromCodes(record.pairs, "11", "21", "31"),
    pointFromCodes(record.pairs, "12", "22", "32"),
    pointFromCodes(record.pairs, "13", "23", "33"),
  ].filter(Boolean);
  if (pts.length < 3) return { action: "preserve", pairs: record.pairs, matchedSegments: 0 };

  const edits = [];
  for (let i = 0; i < pts.length; i++) {
    const edit = editIndex.bySegment.get(segmentKey(layer, pts[i], pts[(i + 1) % pts.length]));
    if (edit) edits.push(edit);
  }
  if (!edits.length) return { action: "preserve", pairs: record.pairs, matchedSegments: 0 };
  if (edits.some((e) => e.remove)) return { action: "remove", pairs: [], matchedSegments: edits.length };

  const targetLayers = Array.from(new Set(edits.map((e) => e.targetLayer).filter(Boolean)));
  if (targetLayers.length === 1) {
    desiredLayers.add(targetLayers[0]);
    return { action: "change-layer", pairs: replaceLayer(record.pairs, targetLayers[0]), matchedSegments: edits.length };
  }
  return { action: "preserve", pairs: record.pairs, matchedSegments: edits.length };
}

function buildEditIndex(entities, rules) {
  const bySegment = new Map();
  const targetLayers = new Set();

  for (const entity of Array.isArray(entities) ? entities : []) {
    if (!isGeometryEntity(entity)) continue;
    const originalLayer = inferOriginalLayer(entity);
    const currentLayer = safeLayer(entity.layer || originalLayer || "0");
    const rule = rules?.[currentLayer];
    const remove = entity.deleted === true || entity.visible === false || rule?.visible === false || rule?.type === "hide";
    const moved = !remove && originalLayer && currentLayer && originalLayer !== currentLayer;

    // V20: ignore all untouched entities.
    // Without this, a no-op export still marks every segment as "matched" and rewrites ENTITIES.
    if (!remove && !moved) continue;

    const pts = getPoints(entity);
    if (pts.length < 2) continue;

    for (let i = 0; i < pts.length - 1; i++) {
      const key = segmentKey(originalLayer, pts[i], pts[i + 1]);
      if (!key) continue;
      const prev = bySegment.get(key) || { remove: false, targetLayer: null, hits: 0 };
      prev.remove = prev.remove || remove;
      if (moved) {
        prev.targetLayer = currentLayer;
        targetLayers.add(currentLayer);
      }
      prev.hits += 1;
      bySegment.set(key, prev);
    }
  }

  return { bySegment, targetLayers };
}

function inferOriginalLayer(entity) {
  const direct = entity?.originalLayer || entity?.meta?.originalLayer || entity?.meta?.layer || entity?.meta?.userData?.layer;
  if (direct) return safeLayer(direct);

  // Current ids often start with the original layer:
  // PDF_DD-axis__PDF_DD-axis__obj___line-segment_...
  const id = String(entity?.id || "");
  const fromId = id.includes("__") ? id.split("__")[0] : "";
  if (fromId) return safeLayer(fromId);

  return safeLayer(entity?.layer || "0");
}

function isGeometryEntity(entity) {
  const kind = String(entity?.kind || "").toUpperCase();
  return kind === "LINE" || kind === "MESH_EDGE" || kind === "POLYLINE" || kind === "LWPOLYLINE" || entity?.entityClass === "geometry";
}

function parseDXF(text) {
  const lineEnding = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  const sections = findSections(lines);
  const entitiesSection = sections.find((s) => /^ENTITIES$/i.test(s.name));
  const entityRecords = entitiesSection ? parseEntityRecords(lines, entitiesSection.contentStart, entitiesSection.contentEnd) : [];
  const layerNames = readLayerNames(lines);
  return { lines, lineEnding, sections, entitiesSection, entityRecords, layerNames };
}

function findSections(lines) {
  const sections = [];

  // Tolerant scan: scan line-by-line, not only by even DXF pair indices.
  // Real DXF files may start with 999 comment pairs, BOMs, empty lines,
  // or exporter-specific headers that shift the SECTION pair alignment.
  for (let i = 0; i < lines.length - 3; i += 1) {
    if (code(lines[i]) === "0" && value(lines[i + 1]) === "SECTION" && code(lines[i + 2]) === "2") {
      const name = value(lines[i + 3]);
      let end = -1;
      for (let j = i + 4; j < lines.length - 1; j += 1) {
        if (code(lines[j]) === "0" && value(lines[j + 1]) === "ENDSEC") {
          end = j;
          break;
        }
      }
      if (end >= 0) {
        sections.push({ name, start: i, contentStart: i + 4, contentEnd: end, endStart: end, endEnd: end + 2 });
        i = end + 1;
      }
    }
  }
  return sections;
}

function parseEntityRecords(lines, start, end) {
  const records = [];
  let current = null;
  for (let i = start; i < end - 1; i += 2) {
    const p = pairFromLines(lines[i], lines[i + 1]);
    if (p.code === "0") {
      if (current) records.push(current);
      current = { type: p.value, pairs: [p] };
    } else if (current) {
      current.pairs.push(p);
    }
  }
  if (current) records.push(current);
  return records;
}

function readLayerNames(lines) {
  const names = new Set();
  let inLayerTable = false;
  for (let i = 0; i < lines.length - 3; i += 1) {
    if (!inLayerTable && code(lines[i]) === "0" && value(lines[i + 1]) === "TABLE" && code(lines[i + 2]) === "2" && value(lines[i + 3]) === "LAYER") {
      inLayerTable = true;
      i += 3;
      continue;
    }
    if (inLayerTable && code(lines[i]) === "0" && value(lines[i + 1]) === "ENDTAB") break;
    if (inLayerTable && code(lines[i]) === "2") names.add(value(lines[i + 1]));
  }
  return names;
}

function ensureLayerTable(lines, desiredLayers, existingLayers) {
  const missing = Array.from(desiredLayers).filter((layer) => layer && !existingLayers.has(layer));
  if (!missing.length) return lines;

  const out = [...lines];
  let inLayerTable = false;
  for (let i = 0; i < out.length - 3; i += 1) {
    if (!inLayerTable && code(out[i]) === "0" && value(out[i + 1]) === "TABLE" && code(out[i + 2]) === "2" && value(out[i + 3]) === "LAYER") {
      inLayerTable = true;
      i += 3;
      continue;
    }
    if (inLayerTable && code(out[i]) === "0" && value(out[i + 1]) === "ENDTAB") {
      const insert = [];
      for (const layer of missing) insert.push(...pairsToLines(makeLayerPairs(layer)));
      out.splice(i, 0, ...insert);
      return out;
    }
  }
  return out;
}

function pairFromLines(codeRaw, valueRaw) {
  return { codeRaw: String(codeRaw ?? ""), valueRaw: String(valueRaw ?? ""), code: code(codeRaw), value: value(valueRaw) };
}
function code(line) { return String(line ?? "").trim(); }
function value(line) { return String(line ?? "").trim(); }

function pairsToLines(pairs) {
  const out = [];
  for (const p of pairs || []) {
    out.push(String(p.codeRaw ?? p.code ?? ""));
    out.push(String(p.valueRaw ?? p.value ?? ""));
  }
  return out;
}

function firstValue(pairs, targetCode) {
  const found = pairs.find((p) => p.code === targetCode);
  return found ? found.value : null;
}
function recordLayer(record) { return safeLayer(firstValue(record.pairs, "8") || "0"); }

function replaceLayer(pairs, layer) {
  const next = pairs.map((p) => ({ ...p }));
  const safe = safeLayer(layer);
  const layerPair = next.find((p) => p.code === "8");
  if (layerPair) {
    layerPair.value = safe;
    layerPair.valueRaw = safe;
  } else {
    next.splice(1, 0, makePair("8", safe));
  }
  return next;
}

function lwPolylineVertices(pairs) {
  const vertices = [];
  let x = null;
  for (const p of pairs) {
    if (p.code === "10") x = Number(p.value);
    else if (p.code === "20" && Number.isFinite(x)) {
      const y = Number(p.value);
      if (Number.isFinite(y)) vertices.push({ x, y, z: 0 });
      x = null;
    }
  }
  return vertices;
}
function isLWPolylineClosed(pairs) { return (Number(firstValue(pairs, "70") || 0) & 1) === 1; }

function pointFromCodes(pairs, xCode, yCode, zCode) {
  const x = Number(firstValue(pairs, xCode));
  const y = Number(firstValue(pairs, yCode));
  const zRaw = firstValue(pairs, zCode);
  const z = zRaw === null || zRaw === undefined ? 0 : Number(zRaw);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y, z: Number.isFinite(z) ? z : 0 } : null;
}

function makeLinePairs(layer, a, b) {
  return [
    makePair("0", "LINE"), makePair("8", safeLayer(layer)),
    makePair("10", dxfNumber(a.x)), makePair("20", dxfNumber(a.y)), makePair("30", dxfNumber(a.z || 0)),
    makePair("11", dxfNumber(b.x)), makePair("21", dxfNumber(b.y)), makePair("31", dxfNumber(b.z || 0)),
  ];
}
function makeLayerPairs(layer) {
  return [makePair("0", "LAYER"), makePair("2", safeLayer(layer)), makePair("70", "0"), makePair("62", "7"), makePair("6", "CONTINUOUS")];
}
function makePair(c, v) { return { code: String(c), value: String(v), codeRaw: String(c), valueRaw: String(v) }; }

function segmentKey(layer, p1, p2) {
  const a = toPoint3(p1), b = toPoint3(p2);
  if (!a || !b) return "";
  const l = safeLayer(layer || "0").toLowerCase();
  const k1 = `${r(a.x)},${r(a.y)},${r(a.z)}`;
  const k2 = `${r(b.x)},${r(b.y)},${r(b.z)}`;
  return k1 < k2 ? `${l}|${k1}|${k2}` : `${l}|${k2}|${k1}`;
}
function r(n) { return (Math.round(Number(n || 0) * 1000) / 1000).toFixed(3); }

function getPoints(entity) {
  const world = entity?.meta?.worldPoints;
  if (Array.isArray(world) && world.length) return world.map(toPoint3).filter(Boolean);
  if (Array.isArray(entity?.points) && entity.points.length) return entity.points.map(toPoint3).filter(Boolean);
  return [];
}
function toPoint3(p) {
  if (!p) return null;
  const x = Number(p.x ?? p[0]);
  const y = Number(p.y ?? p[1]);
  const z = Number(p.z ?? p[2] ?? 0);
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? { x, y, z } : null;
}
function safeLayer(v) {
  const raw = String(v ?? "0").trim() || "0";
  return raw.replace(/[<>\\/";?*|=,]/g, "_").slice(0, 240) || "0";
}
function dxfNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.round(n * 1000000) / 1000000) : "0";
}

function isEntityExportVisible(entity, rules) {
  if (!entity || entity.deleted === true || entity.visible === false) return false;
  const layer = entity.layer || "0";
  const rule = rules?.[layer];
  return !(rule?.visible === false || rule?.type === "hide");
}

function buildSimpleDXF(entities, rules = null) {
  const lines = [];
  const push = (...a) => lines.push(...a.map(String));
  const stats = { lineCount: 0, textCount: 0, inputCount: entities.length };
  const layers = new Set(["0"]);
  for (const e of entities) if (isEntityExportVisible(e, rules)) layers.add(safeLayer(e.layer || "0"));
  push("0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1009", "0", "ENDSEC");
  push("0", "SECTION", "2", "TABLES", "0", "TABLE", "2", "LAYER", "70", String(layers.size));
  for (const l of layers) push("0", "LAYER", "2", l, "70", "0", "62", "7", "6", "CONTINUOUS");
  push("0", "ENDTAB", "0", "ENDSEC", "0", "SECTION", "2", "BLOCKS", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES");
  for (const e of entities) {
    if (!isEntityExportVisible(e, rules)) continue;
    const pts = getPoints(e);
    for (let i = 0; i < pts.length - 1; i++) { push(...pairsToLines(makeLinePairs(e.layer || "0", pts[i], pts[i + 1]))); stats.lineCount++; }
  }
  push("0", "ENDSEC", "0", "EOF");
  return { text: lines.join("\r\n") + "\r\n", stats };
}

function makeMapper(entities, width, height, margin) {
  const pts = entities.flatMap(getPoints);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 1; maxY = 1; }
  const sx = (width - margin * 2) / Math.max(1e-9, maxX - minX);
  const sy = (height - margin * 2) / Math.max(1e-9, maxY - minY);
  const scale = Math.min(sx, sy);
  const ox = margin + (width - margin * 2 - (maxX - minX) * scale) / 2;
  const oy = margin + (height - margin * 2 - (maxY - minY) * scale) / 2;
  return (p) => ({ x: ox + (Number(p.x) - minX) * scale, y: height - (oy + (Number(p.y) - minY) * scale) });
}
function bboxCenter(bbox) { return bbox ? { x: (Number(bbox.minX) + Number(bbox.maxX)) / 2, y: (Number(bbox.minY) + Number(bbox.maxY)) / 2, z: 0 } : { x: 0, y: 0, z: 0 }; }
function stripExt(name) { return String(name || "EssamVisionCAD").replace(/\.[^.]+$/, "") || "EssamVisionCAD"; }
function downloadText(fileName, text, type = "text/plain;charset=utf-8") { return downloadBlob(fileName, new Blob([text], { type })); }
function downloadBlob(fileName, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  return { fileName, size: blob.size };
}
