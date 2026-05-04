/** DocumentPackageWriter.js - V23.1
 * Builds virtual Essam Document Package files and lightweight reports.
 * Important: avoid downloading one huge debug JSON for heavy drawings.
 */
export function buildVirtualPackageFiles(pkg) {
  const files = new Map();
  files.set('/project.json', pretty(pkg.project));
  files.set('/data/layers.json', pretty({ layers: pkg.layers }));
  files.set('/data/pages.json', pretty({ pages: pkg.pages }));
  files.set('/data/annotations.json', pretty({ annotations: pkg.annotations }));
  files.set('/data/edits.json', pretty(pkg.edits));

  for (const [page, entities] of Object.entries(pkg.entitiesByPage || {})) {
    files.set(`/data/entities/page-${page}.jsonl`, toJsonl(entities));
  }
  for (const [page, texts] of Object.entries(pkg.textByPage || {})) {
    files.set(`/data/text/page-${page}.json`, pretty({ items: texts }));
  }
  for (const [page, images] of Object.entries(pkg.imagesByPage || {})) {
    files.set(`/data/images/page-${page}.json`, pretty({ images }));
  }

  return files;
}

export function buildPackageSizeReport(pkg) {
  const files = buildVirtualPackageFiles(pkg);
  const entries = [...files.entries()].map(([path, text]) => ({
    path,
    chars: String(text).length,
    approxMb: roundMb(String(text).length),
    type: inferPathType(path),
  }));
  entries.sort((a, b) => b.chars - a.chars);
  const totalChars = entries.reduce((sum, item) => sum + item.chars, 0);
  return {
    version: 'V23.1',
    fileCount: entries.length,
    totalChars,
    totalApproxMb: roundMb(totalChars),
    largest: entries.slice(0, 12),
    byType: summarizeByType(entries),
    allFiles: entries,
  };
}

export function buildManifest(pkg) {
  const report = buildPackageSizeReport(pkg);
  return {
    schema: 'essam-document-package-manifest@v23.1',
    generatedAt: new Date().toISOString(),
    project: pkg.project,
    stats: getPackageStats(pkg),
    sizeReport: {
      fileCount: report.fileCount,
      totalChars: report.totalChars,
      totalApproxMb: report.totalApproxMb,
      largest: report.largest,
      byType: report.byType,
    },
    files: report.allFiles.map(({ path, chars, approxMb, type }) => ({ path, chars, approxMb, type })),
    warnings: pkg.warnings || [],
  };
}

export function downloadManifestJson(pkg, fileName = 'essam-document-package-manifest.json') {
  const manifest = buildManifest(pkg);
  const blob = new Blob([pretty(manifest)], { type: 'application/json;charset=utf-8' });
  return downloadBlob(fileName, blob);
}

export function downloadPackageFile(pkg, path, fileName = null) {
  const files = buildVirtualPackageFiles(pkg);
  if (!files.has(path)) return { ok: false, reason: 'file-not-found', path };
  const blob = new Blob([files.get(path)], { type: 'application/json;charset=utf-8' });
  return downloadBlob(fileName || path.split('/').pop() || 'package-file.json', blob);
}

export function downloadDebugPackageJson(pkg, fileName = 'essam-document-package-debug.json') {
  // Legacy full debug. Heavy drawings can be tens of MB. Prefer downloadManifestJson().
  const files = Object.fromEntries(buildVirtualPackageFiles(pkg));
  const blob = new Blob([pretty({ files })], { type: 'application/json;charset=utf-8' });
  return downloadBlob(fileName, blob);
}

export function getPackageStats(pkg) {
  const pages = Object.keys(pkg.entitiesByPage || {});
  const entities = Object.values(pkg.entitiesByPage || {}).reduce((sum, arr) => sum + (arr?.length || 0), 0);
  const texts = Object.values(pkg.textByPage || {}).reduce((sum, arr) => sum + (arr?.length || 0), 0);
  const images = Object.values(pkg.imagesByPage || {}).reduce((sum, arr) => sum + (arr?.length || 0), 0);
  return {
    pages: pkg.pages?.length || pages.length,
    layers: pkg.layers?.length || 0,
    entities,
    texts,
    images,
    annotations: pkg.annotations?.length || 0,
    edits: {
      deleted: pkg.edits?.deleted?.length || 0,
      hidden: pkg.edits?.hidden?.length || 0,
      movedLayer: pkg.edits?.movedLayer?.length || 0,
      modified: pkg.edits?.modified?.length || 0,
    },
  };
}

function summarizeByType(entries) {
  const out = {};
  for (const item of entries) {
    out[item.type] ||= { files: 0, chars: 0, approxMb: 0 };
    out[item.type].files += 1;
    out[item.type].chars += item.chars;
    out[item.type].approxMb = roundMb(out[item.type].chars);
  }
  return out;
}

function inferPathType(path) {
  if (path.includes('/entities/')) return 'entities';
  if (path.includes('/text/')) return 'text';
  if (path.includes('/images/')) return 'images';
  if (path.includes('layers')) return 'layers';
  if (path.includes('edits')) return 'edits';
  if (path.includes('annotations')) return 'annotations';
  if (path.includes('project')) return 'project';
  return 'other';
}

function roundMb(chars) { return Math.round((chars / 1024 / 1024) * 100) / 100; }
function pretty(value) { return JSON.stringify(value, null, 2); }
function toJsonl(rows = []) { return rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''); }

function downloadBlob(fileName, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return { ok: true, fileName, size: blob.size };
}
