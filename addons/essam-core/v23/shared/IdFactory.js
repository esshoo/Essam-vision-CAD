/** IdFactory.js - V23 */
export function stableHash(input = '') {
  const text = String(input);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function makeEntityId({ source = 'src', page = 1, layer = '0', type = 'entity', index = 0, points = [] } = {}) {
  const pointKey = Array.isArray(points) ? points.flat(2).slice(0, 12).join(',') : '';
  return `e_${stableHash(`${source}|p${page}|${layer}|${type}|${index}|${pointKey}`)}`;
}

export function makeLayerId(name = '0') {
  return `layer_${stableHash(String(name).trim() || '0')}`;
}

export function makePageId(pageNumber = 1) {
  return `page_${Number(pageNumber) || 1}`;
}
