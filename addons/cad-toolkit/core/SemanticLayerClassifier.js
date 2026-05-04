/**
 * SemanticLayerClassifier.js
 * Converts noisy CAD layer names into engineering intent.
 * The user can still override everything from LayerRulesPanel.
 */

const RULES = [
  { type: "hide", words: ["pdf text", "pdf_text", "embedded text", "ocr text"] },
  { type: "hide", words: ["pdf images", "pdf_images", "embedded image", "raster image"] },
  { type: "walls", words: ["wall", "walls", "mur", "murs", "حائط", "حوائط", "جدار", "جدران", "masonry", "partition", "a-wall"] },
  { type: "columns", words: ["column", "columns", "col", "pillar", "عمود", "اعمدة", "أعمدة", "a-col"] },
  { type: "floor", words: ["floor", "slab", "ارض", "أرض", "ارضية", "أرضية", "sol", "dalle"] },
  { type: "ceiling", words: ["ceiling", "ceil", "سقف", "false ceiling", "rcp"] },
  { type: "beams", words: ["beam", "beams", "كمرة", "كمر", "girder"] },
  { type: "lights", words: ["light", "lights", "lighting", "lamp", "lum", "اضاءة", "إضاءة", "كهرباء", "electrical", "e-light"] },
  { type: "glass", words: ["glass", "glazing", "window", "win", "زجاج", "شباك", "نافذة", "curtain"] },
  { type: "door", words: ["door", "doors", "باب", "ابواب", "أبواب", "a-door"] },
  { type: "furniture", words: ["furn", "furniture", "فرش", "اثاث", "أثاث", "chair", "table", "bed", "sofa"] },
  { type: "hide", words: ["dim", "dims", "dimension", "text", "txt", "hatch", "axis", "grid", "annotation", "مقاس", "ابعاد", "أبعاد", "نص", "تهشير"] },
];

export function classifyLayerName(layerName = "") {
  const name = normalizeForSearch(layerName);
  for (const rule of RULES) {
    if (rule.words.some((word) => name.includes(normalizeForSearch(word)))) return rule.type;
  }
  return "lines";
}

export function normalizeForSearch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\-_./\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
