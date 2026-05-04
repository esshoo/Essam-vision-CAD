/**
 * V23DocumentPackageBootstrap.js
 * V23.1 Schema Hardening + Size Reports.
 * Safe bootstrap. Adds new architecture beside the current project.
 * It does not alter the current viewer, layers, 2D, 3D, or export logic.
 */
import { EventBus } from '../shared/EventBus.js';
import { DocumentModel } from '../document/DocumentModel.js';
import { validatePackage } from '../document/DocumentSchema.js';
import { convertRegistryToDocumentPackage } from '../converters/RegistryToDocumentPackageConverter.js';
import { IndexedDbStore } from '../storage/IndexedDbStore.js';
import {
  buildVirtualPackageFiles,
  buildPackageSizeReport,
  buildManifest,
  downloadManifestJson,
  downloadDebugPackageJson,
  downloadPackageFile,
} from '../storage/DocumentPackageWriter.js';

const VERSION = 'V23.2-package-accessors';
const eventBus = new EventBus({ debug: false });
const store = new IndexedDbStore();
const state = {
  version: VERSION,
  currentModel: null,
  lastConversion: null,
  lastStoreResult: null,
  lastReport: null,
  installedAt: new Date().toISOString(),
};

function getCurrentFile() {
  return window.cadApp?.uploader?.file || window.cadApp?.currentFile || window.__essamCurrentFile || null;
}

function createEmptyCurrentDocument() {
  state.currentModel = new DocumentModel({ eventBus, sourceFile: getCurrentFile(), sourceType: inferType(getCurrentFile()) });
  return state.currentModel.getStats();
}

function convertCurrentRegistry() {
  const sourceFile = getCurrentFile();
  const result = convertRegistryToDocumentPackage({ sourceFile, eventBus });
  state.currentModel = result.model;
  state.lastConversion = { at: new Date().toISOString(), stats: result.stats };
  state.lastReport = buildPackageSizeReport(state.currentModel.package);
  return result.stats;
}

async function saveCurrentPackageToIndexedDb(key = null) {
  if (!state.currentModel) convertCurrentRegistry();
  const file = getCurrentFile();
  const projectKey = key || `${file?.name || 'active-file'}|${file?.size || 0}`;
  state.lastStoreResult = await store.put('projects', projectKey, state.currentModel.package);
  return state.lastStoreResult;
}

async function saveCurrentPackageChunkedToIndexedDb(key = null) {
  if (!state.currentModel) convertCurrentRegistry();
  const file = getCurrentFile();
  const projectKey = key || `${file?.name || 'active-file'}|${file?.size || 0}`;
  const pkg = state.currentModel.package;
  const results = [];

  results.push(await store.put('projects', `${projectKey}::meta`, {
    project: pkg.project,
    pages: pkg.pages,
    layers: pkg.layers,
    warnings: pkg.warnings,
    manifest: buildManifest(pkg),
  }));
  results.push(await store.put('projects', `${projectKey}::edits`, pkg.edits));
  results.push(await store.put('projects', `${projectKey}::annotations`, pkg.annotations));

  for (const [page, entities] of Object.entries(pkg.entitiesByPage || {})) {
    results.push(await store.put('entities', `${projectKey}::page-${page}`, { page: Number(page), entities }));
  }
  for (const [page, items] of Object.entries(pkg.textByPage || {})) {
    results.push(await store.put('pages', `${projectKey}::text-page-${page}`, { page: Number(page), items }));
  }
  for (const [page, images] of Object.entries(pkg.imagesByPage || {})) {
    results.push(await store.put('assets', `${projectKey}::images-page-${page}`, { page: Number(page), images }));
  }

  state.lastStoreResult = { ok: true, mode: 'chunked', key: projectKey, writes: results.length, results };
  return state.lastStoreResult;
}

async function loadPackageFromIndexedDb(key) {
  const pkg = await store.get('projects', key);
  return { ok: !!pkg, package: pkg, validation: pkg ? validatePackage(pkg) : null };
}

function getVirtualPackageFiles() {
  if (!state.currentModel) convertCurrentRegistry();
  const files = buildVirtualPackageFiles(state.currentModel.package);
  return {
    fileCount: files.size,
    files: [...files.entries()].map(([path, text]) => ({
      path,
      chars: String(text).length,
      approxMb: Math.round((String(text).length / 1024 / 1024) * 100) / 100,
    })),
  };
}

function getPackageSizeReport() {
  if (!state.currentModel) convertCurrentRegistry();
  state.lastReport = buildPackageSizeReport(state.currentModel.package);
  return state.lastReport;
}

function getManifest() {
  if (!state.currentModel) convertCurrentRegistry();
  return buildManifest(state.currentModel.package);
}

function downloadManifest() {
  if (!state.currentModel) convertCurrentRegistry();
  const name = `${getCurrentFile()?.name || 'active-file'}_v23_manifest.json`;
  return downloadManifestJson(state.currentModel.package, sanitizeFileName(name));
}

function downloadPackagePath(path) {
  if (!state.currentModel) convertCurrentRegistry();
  return downloadPackageFile(state.currentModel.package, path);
}

function downloadDebugJson() {
  // V23.1: default debug download is a lightweight manifest, not the whole 60MB+ package.
  return downloadManifest();
}

function downloadFullDebugJson() {
  if (!state.currentModel) convertCurrentRegistry();
  const name = `${getCurrentFile()?.name || 'active-file'}_v23_FULL_document_package_debug.json`;
  return downloadDebugPackageJson(state.currentModel.package, sanitizeFileName(name));
}

function getCurrentPackage() {
  if (!state.currentModel) convertCurrentRegistry();
  return state.currentModel.package;
}

function getCurrentModel() {
  if (!state.currentModel) convertCurrentRegistry();
  return state.currentModel;
}

function getCurrentPackageStats() {
  if (!state.currentModel) convertCurrentRegistry();
  return state.currentModel.getStats();
}

function getSummary() {
  return {
    installed: true,
    version: VERSION,
    currentFile: getCurrentFile() ? { name: getCurrentFile().name, size: getCurrentFile().size, type: getCurrentFile().type } : null,
    hasCurrentModel: !!state.currentModel,
    currentStats: state.currentModel?.getStats?.() || null,
    lastConversion: state.lastConversion,
    lastStoreResult: state.lastStoreResult,
    lastReport: state.lastReport ? {
      totalApproxMb: state.lastReport.totalApproxMb,
      fileCount: state.lastReport.fileCount,
      largest: state.lastReport.largest?.slice?.(0, 5),
    } : null,
    eventBus: eventBus.getSummary(),
  };
}

function setDebug(value) { eventBus.debug = value === true; return getSummary(); }
function inferType(file) {
  const name = String(file?.name || '').toLowerCase();
  if (name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.dxf')) return 'dxf';
  if (name.endsWith('.dwg')) return 'dwg';
  return 'unknown';
}
function sanitizeFileName(name) {
  return String(name || 'file.json').replace(/[^a-zA-Z0-9_.\-\u0600-\u06FF]+/g, '_');
}

window.__essamV23 = {
  version: VERSION,
  eventBus,
  store,
  createEmptyCurrentDocument,
  convertCurrentRegistry,
  saveCurrentPackageToIndexedDb,
  saveCurrentPackageChunkedToIndexedDb,
  loadPackageFromIndexedDb,
  getVirtualPackageFiles,
  getPackageSizeReport,
  getManifest,
  getCurrentPackage,
  getCurrentModel,
  getCurrentPackageStats,
  downloadManifest,
  downloadPackagePath,
  downloadDebugJson,
  downloadFullDebugJson,
  getSummary,
  setDebug,
};

console.info(`[Essam V23.2] Document Package accessors installed. Use window.__essamV23.getCurrentPackage()`);

export default window.__essamV23;
