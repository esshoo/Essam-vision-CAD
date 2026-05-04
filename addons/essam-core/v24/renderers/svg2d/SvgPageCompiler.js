/**
 * SvgPageCompiler.js - V24.5 SVG entity selection support
 * Converts Essam Document Package page entities into SVG text.
 * Safe prototype: does not replace the current viewer.
 *
 * V24.4 keeps V24.3 fixes and adds:
 * - SVG coordinate normalization with optional Y flip
 * - normalized 0..width/height viewBox to avoid inverted CAD/PDF coordinates
 * - balanced preview entity limiting across layers instead of first-N truncation
 * - diagnostics for transform and layer distribution
 */

const DEFAULT_OPTIONS = {
  page: 1,
  maxEntities: 30000,
  includeHiddenLayers: false,
  strokeScale: 1,
  minStroke: 0.35,
  background: '#ffffff',
  paddingRatio: 0.025,
  decimalPlaces: 2,
  boundsMode: 'robust', // raw | robust
  trimPercent: 0.0025,
  skipOutsideRobustBounds: true,
  outsidePaddingRatio: 0.03,
  minEntitySize: 0,
  coordinateMode: 'normalized-flip-y', // raw | normalized | normalized-flip-y
  limitStrategy: 'balanced-by-layer', // first | balanced-by-layer
  maxLayersInPreview: 0,
};

export function compilePageToSvg(pkg, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...(options || {}) };
  const page = Number(opts.page || 1) || 1;
  const layers = Array.isArray(pkg?.layers) ? pkg.layers : [];
  const layerByName = new Map(layers.map((l) => [String(l.name || l.id || '0'), l]));
  const all = (pkg?.entitiesByPage?.[page] || []).filter((e) => shouldIncludeEntity(e, layerByName, opts));

  // V24.2: compute bounds from all eligible data first, not from first-N preview data.
  // This prevents first-N preview from picking one diagonal/outlier and compressing the page.
  const boundsReport = computeBoundsReport(all, opts);
  const activeBounds = opts.boundsMode === 'raw' ? boundsReport.rawBounds : boundsReport.robustBounds;
  const renderBounds = activeBounds || boundsReport.rawBounds || fallbackBounds();
  const filterBounds = expandBounds(renderBounds, Math.max(renderBounds.width, renderBounds.height) * Number(opts.outsidePaddingRatio || 0));

  const insideBounds = opts.boundsMode === 'robust' && opts.skipOutsideRobustBounds !== false
    ? all.filter((e) => entityIntersectsBounds(e, filterBounds))
    : all;

  const capped = limitEntitiesForPreview(insideBounds, opts);
  const view = makeViewBox(renderBounds, opts);
  const transform = makeCoordinateTransform(renderBounds, view, opts);
  const groups = groupByLayer(capped, opts);
  const parts = [];

  parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" version="1.1" data-essam-svg="v24.5" data-page="${escapeAttr(page)}" viewBox="${view.viewBox}" width="100%" height="100%" overflow="hidden">`);
  parts.push(`<metadata>${escapeText(JSON.stringify({ generator: 'Essam V24.5 SvgPageCompiler', page, source: pkg?.project?.source || null, stats: { input: all.length, output: capped.length, boundsMode: opts.boundsMode, coordinateMode: opts.coordinateMode, rawBounds: boundsReport.rawBounds, robustBounds: boundsReport.robustBounds } }))}</metadata>`);
  parts.push(`<rect class="essam-svg-background" x="${view.x}" y="${view.y}" width="${view.width}" height="${view.height}" fill="${escapeAttr(opts.background)}"/>`);
  parts.push(`<g class="essam-page" data-page="${escapeAttr(page)}">`);

  for (const [layer, rows] of groups.entries()) {
    const layerMeta = layerByName.get(layer) || { name: layer };
    const visible = layerMeta.visible2D !== false;
    const color = normalizeColor(layerMeta.color || rows[0]?.style?.stroke || '#111111');
    parts.push(`<g class="essam-layer" id="${escapeAttr(makeDomId('layer', layer))}" data-layer="${escapeAttr(layer)}" data-visible2d="${visible}" style="${visible ? '' : 'display:none'}">`);
    parts.push(`<title>${escapeText(layer)}</title>`);
    for (const entity of rows) parts.push(renderEntity(entity, { color, opts, transform }));
    parts.push(`</g>`);
  }

  parts.push(`</g>`);
  parts.push(`</svg>`);

  const svgText = parts.join('\n');
  return {
    ok: true,
    version: 'V24.5-svg-entity-selection',
    page,
    svgText,
    stats: {
      page,
      layers: groups.size,
      inputEntities: all.length,
      outputEntities: capped.length,
      eligibleAfterBounds: insideBounds.length,
      truncated: capped.length < insideBounds.length,
      skippedByLimit: insideBounds.length - capped.length,
      skippedAsOutliers: all.length - insideBounds.length,
      boundsMode: opts.boundsMode,
      coordinateMode: opts.coordinateMode,
      limitStrategy: opts.limitStrategy,
      rawBounds: boundsReport.rawBounds,
      robustBounds: boundsReport.robustBounds,
      robustInfo: boundsReport.robustInfo,
      viewBox: view,
      transformInfo: transform.info,
      chars: svgText.length,
      approxMb: roundMb(svgText.length),
    },
  };
}

export function getSvgPageCompileEstimate(pkg, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...(options || {}) };
  const page = Number(opts.page || 1) || 1;
  const layers = Array.isArray(pkg?.layers) ? pkg.layers : [];
  const layerByName = new Map(layers.map((l) => [String(l.name || l.id || '0'), l]));
  const all = (pkg?.entitiesByPage?.[page] || []).filter((e) => shouldIncludeEntity(e, layerByName, opts));
  const boundsReport = computeBoundsReport(all, opts);
  return {
    ok: true,
    version: 'V24.5-svg-entity-selection',
    page,
    inputEntities: all.length,
    layerCount: new Set(all.map((e) => e.layer || '0')).size,
    estimatedFullSvgMb: roundMb(all.length * 210),
    defaultPreviewLimit: opts.maxEntities,
    coordinateMode: opts.coordinateMode,
    limitStrategy: opts.limitStrategy,
    boundsMode: opts.boundsMode,
    rawBounds: boundsReport.rawBounds,
    robustBounds: boundsReport.robustBounds,
    robustInfo: boundsReport.robustInfo,
    suspectedOutlierProblem: isOutlierProblem(boundsReport),
  };
}

export function diagnoseSvgPageData(pkg, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...(options || {}) };
  const page = Number(opts.page || 1) || 1;
  const rows = pkg?.entitiesByPage?.[page] || [];
  let validPointEntities = 0;
  let invalidPointEntities = 0;
  const typeCounts = {};
  const layerCounts = {};
  const pointShapes = {};
  const sample = [];

  for (const e of rows) {
    const type = String(e?.type || 'unknown');
    const layer = String(e?.layer || '0');
    typeCounts[type] = (typeCounts[type] || 0) + 1;
    layerCounts[layer] = (layerCounts[layer] || 0) + 1;
    const pts = getEntityPoints(e);
    if (pts.length) validPointEntities += 1; else invalidPointEntities += 1;
    const shapeKey = describePointShape(e?.points);
    pointShapes[shapeKey] = (pointShapes[shapeKey] || 0) + 1;
    if (sample.length < 10) sample.push({ id: e?.id, type, layer, pointShape: shapeKey, pointCount: pts.length, points: pts.slice(0, 3), rawPoints: Array.isArray(e?.points) ? e.points.slice(0, 2) : e?.points });
  }

  const estimate = getSvgPageCompileEstimate(pkg, opts);
  return {
    ok: true,
    version: 'V24.5-svg-entity-selection',
    page,
    totalEntities: rows.length,
    validPointEntities,
    invalidPointEntities,
    typeCounts,
    topLayers: Object.entries(layerCounts).sort((a, b) => b[1] - a[1]).slice(0, 15),
    pointShapes,
    svgCoordinateNote: "V24.5 supports runtime coordinate mode switching, layer-aware DOM control, and SVG entity selection. Default is normalized-flip-y. Use setCoordinateMode(\'normalized\') if a file appears inverted.",
    estimate,
    sample,
  };
}

export function getSvgLayerStats(pkg, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...(options || {}) };
  const page = Number(opts.page || 1) || 1;
  const layers = Array.isArray(pkg?.layers) ? pkg.layers : [];
  const layerByName = new Map(layers.map((l) => [String(l.name || l.id || '0'), l]));
  const all = (pkg?.entitiesByPage?.[page] || []).filter((e) => shouldIncludeEntity(e, layerByName, opts));
  const boundsReport = computeBoundsReport(all, opts);
  const activeBounds = opts.boundsMode === 'raw' ? boundsReport.rawBounds : boundsReport.robustBounds;
  const renderBounds = activeBounds || boundsReport.rawBounds || fallbackBounds();
  const filterBounds = expandBounds(renderBounds, Math.max(renderBounds.width, renderBounds.height) * Number(opts.outsidePaddingRatio || 0));
  const insideBounds = opts.boundsMode === 'robust' && opts.skipOutsideRobustBounds !== false
    ? all.filter((e) => entityIntersectsBounds(e, filterBounds))
    : all;
  const map = new Map();
  for (const e of insideBounds) {
    const layer = String(e.layer || '0');
    if (!map.has(layer)) map.set(layer, { layer, count: 0, types: {} });
    const row = map.get(layer);
    row.count += 1;
    const type = String(e.type || 'unknown');
    row.types[type] = (row.types[type] || 0) + 1;
  }
  const layerStats = Array.from(map.values()).sort((a, b) => b.count - a.count);
  return {
    ok: true,
    version: 'V24.5-svg-entity-selection',
    page,
    inputEntities: all.length,
    eligibleAfterBounds: insideBounds.length,
    layerCount: layerStats.length,
    layerStats,
    boundsMode: opts.boundsMode,
    coordinateMode: opts.coordinateMode,
    rawBounds: boundsReport.rawBounds,
    robustBounds: boundsReport.robustBounds,
  };
}

function shouldIncludeEntity(entity, layerByName, opts) {
  if (!entity || entity.deleted === true) return false;
  const layer = String(entity.layer || '0');
  if (Array.isArray(opts.includeLayers) && opts.includeLayers.length) {
    const allowed = new Set(opts.includeLayers.map((x) => String(x)));
    if (!allowed.has(layer)) return false;
  }
  if (Array.isArray(opts.excludeLayers) && opts.excludeLayers.length) {
    const blocked = new Set(opts.excludeLayers.map((x) => String(x)));
    if (blocked.has(layer)) return false;
  }
  const layerMeta = layerByName.get(layer);
  if (!opts.includeHiddenLayers && layerMeta?.visible2D === false) return false;
  const type = String(entity.type || '').toLowerCase();
  if (type === 'image' || type === 'text') return false;
  const pts = getEntityPoints(entity);
  return pts.length > 0;
}

function groupByLayer(entities, opts = {}) {
  const groups = new Map();
  for (const e of entities) {
    const layer = String(e.layer || '0');
    if (!groups.has(layer)) groups.set(layer, []);
    groups.get(layer).push(e);
  }
  if (Number(opts.maxLayersInPreview || 0) > 0 && groups.size > Number(opts.maxLayersInPreview)) {
    const keep = new Set(Array.from(groups.entries()).sort((a,b)=>b[1].length-a[1].length).slice(0, Number(opts.maxLayersInPreview)).map(([k])=>k));
    for (const key of Array.from(groups.keys())) if (!keep.has(key)) groups.delete(key);
  }
  return groups;
}

function renderEntity(entity, ctx) {
  const type = String(entity.type || '').toLowerCase();
  const id = escapeAttr(entity.id || 'entity');
  const layer = escapeAttr(entity.layer || '0');
  const stroke = escapeAttr(normalizeColor(entity.style?.stroke || ctx.color || '#111111'));
  const width = fmt(Math.max(ctx.opts.minStroke, Number(entity.style?.width || 1) * Number(ctx.opts.strokeScale || 1)), ctx.opts);
  const common = `id="${id}" data-entity-id="${id}" data-layer="${layer}" vector-effect="non-scaling-stroke" stroke="${stroke}" stroke-width="${width}" fill="none"`;
  const ptsRaw = getEntityPoints(entity);
  const pts = ptsRaw.map((p) => ctx.transform.point(p));

  if (type === 'circle') {
    const c = pts[0] || ctx.transform.point(pointFromEntity(entity) || [0, 0]);
    const rRaw = Number(entity.r || entity.radius || distance(ptsRaw[0], ptsRaw[1]) || 1) || 1;
    const r = Math.max(0.1, rRaw * ctx.transform.scale);
    return `<circle ${common} cx="${fmt(c[0], ctx.opts)}" cy="${fmt(c[1], ctx.opts)}" r="${fmt(r, ctx.opts)}"/>`;
  }

  if (type === 'line' && pts.length >= 2) {
    return `<line ${common} x1="${fmt(pts[0][0], ctx.opts)}" y1="${fmt(pts[0][1], ctx.opts)}" x2="${fmt(pts[1][0], ctx.opts)}" y2="${fmt(pts[1][1], ctx.opts)}"/>`;
  }

  if (pts.length >= 2) {
    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${fmt(p[0], ctx.opts)} ${fmt(p[1], ctx.opts)}`).join(' ');
    return `<path ${common} d="${escapeAttr(d)}"/>`;
  }

  const p = pts[0] || [0, 0];
  return `<circle ${common} cx="${fmt(p[0], ctx.opts)}" cy="${fmt(p[1], ctx.opts)}" r="1"/>`;
}

export function getEntityPoints(entity) {
  const raw = entity?.points || entity?.vertices || entity?.path || [];
  const pts = [];

  if (Array.isArray(raw)) {
    for (const p of raw) {
      const xy = pointToXY(p);
      if (xy) pts.push(xy);
    }
  }

  if (!pts.length) {
    const a = pointToXY(entity?.start || entity?.from || entity?.p1 || entity?.a);
    const b = pointToXY(entity?.end || entity?.to || entity?.p2 || entity?.b);
    if (a && b) pts.push(a, b);
  }

  if (!pts.length) {
    const c = pointFromEntity(entity);
    if (c) pts.push(c);
  }

  return pts;
}

function pointToXY(p) {
  if (!p) return null;
  if (Array.isArray(p)) {
    const x = toFiniteNumber(p[0]);
    const y = toFiniteNumber(p[1]);
    return x === null || y === null ? null : [x, y];
  }
  if (typeof p === 'object') {
    const x = firstFinite(p.x, p.X, p._x, p.cx, p.CX, p.u, p[0]);
    const y = firstFinite(p.y, p.Y, p._y, p.cy, p.CY, p.v, p[1]);
    return x === null || y === null ? null : [x, y];
  }
  return null;
}

function pointFromEntity(entity) {
  if (!entity) return null;
  const x = firstFinite(entity.x, entity.X, entity.cx, entity.CX, entity.left);
  const y = firstFinite(entity.y, entity.Y, entity.cy, entity.CY, entity.top);
  return x === null || y === null ? null : [x, y];
}

function firstFinite(...values) {
  for (const value of values) {
    const n = toFiniteNumber(value);
    if (n !== null) return n;
  }
  return null;
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}


function limitEntitiesForPreview(entities, opts) {
  const max = Number(opts.maxEntities || 0);
  if (!Number.isFinite(max) || max <= 0 || entities.length <= max) return entities;
  if (opts.limitStrategy !== 'balanced-by-layer') return entities.slice(0, max);

  const groups = new Map();
  for (const e of entities) {
    const layer = String(e.layer || '0');
    if (!groups.has(layer)) groups.set(layer, []);
    groups.get(layer).push(e);
  }

  const orderedGroups = Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);
  const output = [];
  let cursor = 0;
  // Round-robin gives every layer representation in the preview.
  while (output.length < max && orderedGroups.length) {
    let added = 0;
    for (const [, rows] of orderedGroups) {
      if (cursor < rows.length && output.length < max) {
        output.push(rows[cursor]);
        added += 1;
      }
    }
    if (!added) break;
    cursor += 1;
  }
  return output;
}

function computeBoundsReport(entities, opts) {
  const allPoints = [];
  for (const entity of entities) for (const p of getEntityPoints(entity)) allPoints.push(p);
  const rawBounds = computeBoundsFromPoints(allPoints);
  const robust = computeRobustBoundsFromPoints(allPoints, opts);
  return {
    rawBounds,
    robustBounds: robust.bounds || rawBounds,
    robustInfo: robust.info,
  };
}

function computeBoundsFromPoints(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) return fallbackBounds();
  return { minX, minY, maxX, maxY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function computeRobustBoundsFromPoints(points, opts) {
  const valid = points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (valid.length < 20) return { bounds: computeBoundsFromPoints(valid), info: { mode: 'raw-small-sample', validPoints: valid.length } };
  const xs = valid.map((p) => p[0]).sort((a, b) => a - b);
  const ys = valid.map((p) => p[1]).sort((a, b) => a - b);
  const trim = Math.max(0, Math.min(0.05, Number(opts.trimPercent ?? 0.0025)));
  const loIndex = Math.floor((xs.length - 1) * trim);
  const hiIndex = Math.ceil((xs.length - 1) * (1 - trim));
  const bounds = {
    minX: xs[loIndex],
    maxX: xs[hiIndex],
    minY: ys[loIndex],
    maxY: ys[hiIndex],
  };
  bounds.width = Math.max(1, bounds.maxX - bounds.minX);
  bounds.height = Math.max(1, bounds.maxY - bounds.minY);
  return { bounds, info: { mode: 'percentile', validPoints: valid.length, trimPercent: trim, loIndex, hiIndex } };
}

function isOutlierProblem(report) {
  const r = report.rawBounds;
  const b = report.robustBounds;
  if (!r || !b) return false;
  return r.width > b.width * 5 || r.height > b.height * 5;
}

function entityIntersectsBounds(entity, bounds) {
  const pts = getEntityPoints(entity);
  if (!pts.length) return false;
  for (const [x, y] of pts) {
    if (x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY) return true;
  }
  return false;
}

function expandBounds(bounds, pad) {
  return { minX: bounds.minX - pad, minY: bounds.minY - pad, maxX: bounds.maxX + pad, maxY: bounds.maxY + pad, width: bounds.width + pad * 2, height: bounds.height + pad * 2 };
}

function fallbackBounds() { return { minX: 0, minY: 0, maxX: 100, maxY: 100, width: 100, height: 100 }; }

function makeViewBox(bounds, opts) {
  const pad = Math.max(bounds.width, bounds.height) * Number(opts.paddingRatio || 0);
  if (String(opts.coordinateMode || '').startsWith('normalized')) {
    const width = bounds.width + pad * 2;
    const height = bounds.height + pad * 2;
    return { x: 0, y: 0, width, height, pad, normalized: true, viewBox: `0 0 ${fmt(width, opts)} ${fmt(height, opts)}` };
  }
  const x = bounds.minX - pad;
  const y = bounds.minY - pad;
  const width = bounds.width + pad * 2;
  const height = bounds.height + pad * 2;
  return { x, y, width, height, pad, normalized: false, viewBox: `${fmt(x, opts)} ${fmt(y, opts)} ${fmt(width, opts)} ${fmt(height, opts)}` };
}

function makeCoordinateTransform(bounds, view, opts) {
  const mode = String(opts.coordinateMode || 'normalized-flip-y');
  const pad = Number(view.pad || 0);
  if (mode === 'raw') {
    return { scale: 1, info: { mode, flipY: false, normalized: false }, point: (p) => p || [0, 0] };
  }
  const scale = 1;
  const minX = Number(bounds.minX || 0);
  const minY = Number(bounds.minY || 0);
  const maxY = Number(bounds.maxY || 0);
  const flipY = mode === 'normalized-flip-y';
  return {
    scale,
    info: { mode, flipY, normalized: true, minX, minY, maxY, pad, width: view.width, height: view.height },
    point(p) {
      if (!p) return [0, 0];
      const x = Number(p[0]);
      const y = Number(p[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return [0, 0];
      return [
        (x - minX) + pad,
        flipY ? (maxY - y) + pad : (y - minY) + pad,
      ];
    },
  };
}

function describePointShape(points) {
  if (!Array.isArray(points)) return typeof points;
  if (!points.length) return 'empty-array';
  const first = points[0];
  if (Array.isArray(first)) return `array[${first.length}]`;
  if (first && typeof first === 'object') return `object:${Object.keys(first).slice(0, 6).join(',')}`;
  return typeof first;
}

function normalizeColor(value) {
  const s = String(value || '').trim();
  if (/^#[0-9a-f]{3,8}$/i.test(s)) return s;
  if (/^rgb/i.test(s)) return s;
  // Avoid white-on-white prototype output.
  if (!s || s.toLowerCase() === 'white' || s === '#fff' || s === '#ffffff') return '#111111';
  return s;
}

function makeDomId(prefix, value) { return `${prefix}-${String(value).replace(/[^a-zA-Z0-9_\-\u0600-\u06FF]+/g, '-')}`; }
function fmt(value, opts) { return Number(value || 0).toFixed(Number(opts.decimalPlaces ?? 2)).replace(/\.00$/, ''); }
function escapeAttr(value) { return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escapeText(value) { return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function distance(a, b) { if (!a || !b) return 0; return Math.hypot(Number(a[0]) - Number(b[0]), Number(a[1]) - Number(b[1])); }
function roundMb(chars) { return Math.round((Number(chars || 0) / 1024 / 1024) * 100) / 100; }
