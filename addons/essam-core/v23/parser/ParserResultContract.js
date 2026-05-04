/** ParserResultContract.js - V23 */
export function normalizeParserResult(result = {}) {
  return {
    sourceInfo: result.sourceInfo || {},
    pages: Array.isArray(result.pages) ? result.pages : [],
    layers: Array.isArray(result.layers) ? result.layers : [],
    entitiesByPage: result.entitiesByPage || {},
    textsByPage: result.textsByPage || {},
    imagesByPage: result.imagesByPage || {},
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
  };
}

export function validateParserResult(result = {}) {
  const errors = [];
  if (!result.sourceInfo) errors.push('sourceInfo is required.');
  if (!Array.isArray(result.pages)) errors.push('pages must be an array.');
  if (!Array.isArray(result.layers)) errors.push('layers must be an array.');
  if (!result.entitiesByPage || typeof result.entitiesByPage !== 'object') errors.push('entitiesByPage must be an object keyed by page number.');
  return { ok: errors.length === 0, errors };
}
