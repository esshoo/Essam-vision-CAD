/**
 * LayerRulesPanel.js (v13 - Cleaned Up)
 * - Sun slider removed (moved to 3D Scene Overlay).
 * - Retains Scale and Intensity settings.
 */
import { CADLayerKit, LayerRulesStore } from "../CADLayerKit.js";
import { CADSceneExporter } from "../CADSceneExporter.js";
import { ProjectExporter } from "../core/ProjectExporter.js";
import { ProjectPersistence } from "../core/ProjectPersistence.js";
import { t } from "../core/i18n.js";
import { classifyLayerName } from "../core/SemanticLayerClassifier.js";
import { el } from "./shared/dom.js";
import { panelStyle, headerStyle, titleStyle, subtitleStyle, compactButtonStyle, inputStyle, sectionStyle, labelStyle } from "./shared/uiTheme.js";

const PROJECT_ID = "active";
let state = { layers: [], rules: {} };
let currentFileName = "Project"; 
let globalSettings = { scale: 0.001, sunIntensity: 1.0 }; // Default
const panelTranslations = {
  title: () => t("layers.title", "طبقات المشروع"),
  subtitle: () => t("layers.subtitle", "التحكم في الطبقات والتحويل إلى 3D"),
};

function btn(label, onClick, variant = "ghost", extraStyle = {}) {
  return el("button", {
    type: "button",
    style: compactButtonStyle(variant, { flex: "1", ...extraStyle }),
    onclick: onClick
  }, [label]);
}

let panel, header, content, listEl, footerEl;
let collapsed = false;

function ensurePanel() {
  if (document.getElementById("layer-rules-panel")) return;

  panel = el("aside", { id: "layer-rules-panel", style: panelStyle({
    left: "20px", top: "20px", width: "420px", height: "85vh",
    display: "none", flexDirection: "column", overflow: "hidden",
    resize: "both", minWidth: "360px", minHeight: "360px"
  })});

  header = el("div", { style: headerStyle({ cursor: "move", touchAction: "none", userSelect: "none" })}, [
    el("div", {}, [el("div", { id: "layer-rules-title", style: titleStyle() }, [panelTranslations.title()]), el("div", { id: "layer-rules-subtitle", style: subtitleStyle() }, [panelTranslations.subtitle()])]),
    el("div", { style: { display: "flex", gap: "5px" }}, [
      btn("—", toggleCollapse),
      btn("✕", hide, "danger", { width: "auto" })
    ])
  ]);

  content = el("div", { style: { display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }});

  const tools = el("div", { style: { padding: "10px", borderBottom: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.03)", display: "flex", flexDirection: "column", gap: "10px" }}, [
    // 1. Settings (Scale only now, Sun is in 3D)
    el("div", { style: { display: "flex", alignItems: "center", gap: "10px", fontSize: "12px" }}, [
        el("label", { style: { color: "rgba(255,255,255,0.82)" } }, [t("layers.scale", "المقياس") + ":"]),
        el("input", { 
            type: "number", value: "0.001", step: "0.001", 
            style: inputStyle({ width: "70px", padding: "4px", borderRadius: "8px" }),
            onchange: (e) => globalSettings.scale = parseFloat(e.target.value)
        }),
        el("span", { style: { color: "rgba(255,255,255,0.6)" }}, [t("layers.sunInside3d", "الشمس داخل عرض 3D")])
    ]),
    
    // 2. Actions
    el("div", { style: { display: "flex", gap: "5px" }}, [
        btn("⟳ " + t("layers.scan", "فحص"), refreshFromViewer),
        btn("💾 " + t("layers.save", "حفظ"), saveRules),
    ]),
    el("div", { style: { display: "flex", gap: "5px" }}, [
        btn("📥 " + t("layers.exportJson", "تصدير JSON"), exportFinalJSON),
        btn("🚀 " + t("layers.preview3d", "عرض 3D"), preview3D, "primary")
    ]),
    el("div", { style: { display: "flex", gap: "5px" }}, [
        btn("📄 PDF", exportCurrentPDF),
        btn("📐 DXF", exportCurrentDXF),
        btn("🏗️ DWG", exportCurrentDWG)
    ]),

    el("input", { 
        type: "search",
        placeholder: t("layers.search", "بحث في الطبقات"), 
        style: inputStyle({ borderRadius: "8px" }),
        oninput: renderList
    })
  ]);

  listEl = el("div", { style: { flex: "1", overflowY: "auto", padding: "10px", display: "flex", flexDirection: "column", gap: "8px", background: "rgba(255,255,255,0.02)" }});
  footerEl = el("div", { style: { padding: "8px", fontSize: "11px", color: "rgba(255,255,255,0.62)", textAlign: "center", borderTop: "1px solid rgba(255,255,255,0.12)" }}, [t("layers.footer", "تحكم في إظهار الطبقات وتحويلها إلى 3D")]);

  content.appendChild(tools);
  content.appendChild(listEl);
  content.appendChild(footerEl);
  panel.appendChild(header);
  panel.appendChild(content);
  document.body.appendChild(panel);

  makeDraggable(panel, header);
  loadRules();
  
  window.layerRulesUI = { ensureReady: ensurePanel, show, hide, toggle, isVisible, preview3D, exportFinalJSON, refreshFromViewer };
  window.layerRulesPanel = window.layerRulesUI;

  window.addEventListener("cad:file-loaded", () => {
     if(window.cadApp?.uploader?.file) currentFileName = window.cadApp.uploader.file.name.replace(/\.(dxf|dwg)$/i, "");
     refreshFromViewer();
     show();
  });

  window.addEventListener("cad:pen-layer-updated", () => refreshFromViewer());
  window.addEventListener("cad:annotation-layers-updated", () => refreshFromViewer());
  window.addEventListener("cad:content-recognition-ready", () => refreshFromViewer());
  window.addEventListener("cad:entity-registry-updated", () => refreshFromViewer());
  window.addEventListener("cad:project-state-restored", () => refreshFromViewer());
}

function makeDraggable(target, handle) {
  let startX = 0, startY = 0, startLeft = 0, startTop = 0, dragging = false, activePointerId = null;

  const stopEvent = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  handle.addEventListener("pointerdown", (e) => {
    if (e.target.tagName === "BUTTON" || e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
    dragging = true;
    activePointerId = e.pointerId;
    handle.setPointerCapture?.(e.pointerId);
    startX = e.clientX;
    startY = e.clientY;
    const rect = target.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    stopEvent(e);
  });

  handle.addEventListener("pointermove", (e) => {
    if (!dragging || e.pointerId !== activePointerId) return;
    target.style.left = (startLeft + e.clientX - startX) + "px";
    target.style.top = (startTop + e.clientY - startY) + "px";
    stopEvent(e);
  });

  const finish = (e) => {
    if (!dragging || (activePointerId !== null && e.pointerId !== activePointerId)) return;
    dragging = false;
    activePointerId = null;
    handle.releasePointerCapture?.(e.pointerId);
    stopEvent(e);
  };

  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);
}

function loadRules() { state.rules = LayerRulesStore.load(PROJECT_ID); }
function saveRules() {
  LayerRulesStore.save(PROJECT_ID, state.rules);
  ProjectPersistence.save({
    fileName: getActiveFileName(),
    registry: window.__essamEntityRegistry || null,
    rules: state.rules,
    settings: globalSettings,
  });
}

function detectType(name) {
    return classifyLayerName(name);
}

function ensureDefaults(layers) {
    const existing = state.rules || {};
    for (const name of layers) {
        if (!existing[name]) {
            const type = detectType(name);
            existing[name] = { type, color: "#cccccc", visible: true, ...getDefaultsForType(type) };
        } else if (existing[name].visible === undefined) {
            existing[name].visible = true;
        }
    }
    state.rules = existing;
}

function getDefaultsForType(type) {
    if(type === "walls") return { height: 3.0, thickness: 0.2, elevation: 0.0, hasCeiling: false };
    if(type === "columns") return { height: 3.0, thickness: 0.35, elevation: 0.0 };
    if(type === "furniture") return { height: 0.75, thickness: 0.08, elevation: 0.0 };
    if(type === "beams") return { height: 0.5, thickness: 0.2, elevation: 2.5 };
    if(type === "floor") return { thickness: 0.1, elevation: 0.0 };
    if(type === "ceiling") return { thickness: 0.1, elevation: 3.0 };
    if(type === "lights") return { thickness: 0.1, elevation: 2.8, intensity: 2.0, range: 8.0, lightSpacing: 2.4 };
    if(type === "glass" || type === "door") return { height: 2.1, elevation: 0.0 };
    return { height: 0.0, thickness: 0.01, elevation: 0.0 };
}

function getAnnotationLayerEntities() {
  try {
    return window.cadDrawingOverlay?.get3DEntities?.() || [];
  } catch (err) {
    console.warn("Annotation layer export failed:", err);
    return [];
  }
}

function getAnnotationLayerNames() {
  try {
    return window.cadDrawingOverlay?.getAnnotationLayerNames?.() || [];
  } catch (err) {
    console.warn("Annotation layer names failed:", err);
    return [];
  }
}

function applyViewerLayerVisibility(layerName, visible) {
  const app = window.cadApp;
  const viewer = app?.viewer;
  const isVisible = visible !== false;
  if (!viewer || !layerName) return;

  // Annotation/drawing layers are runtime layers, not x-viewer modelData layers.
  if (isAnnotationLayer(layerName)) {
    window.cadDrawingOverlay?.setLayerVisibility?.(layerName, isVisible, true);
    viewer?.enableRender?.();
    return;
  }

  const registry = window.__essamEntityRegistry || null;
  if (registry?.findLayerId?.(layerName)) {
    registry.hideLayer?.(layerName, !isVisible);
    window.cadEntityLayerEditor?.syncManagedRenderAfterStateChange?.();
    window.__essamScreenSelectionBridge?.syncSelectionHighlights?.();
    ProjectPersistence.save({ fileName: getActiveFileName(), registry, rules: state.rules, settings: globalSettings });
  }

  try {
    const models = Array.isArray(viewer.loadedModels) ? viewer.loadedModels : [];
    for (const model of models) {
      if (typeof model?.setLayerVisible === "function" && modelHasLayer(model, layerName)) {
        try { model.setLayerVisible(layerName, isVisible); } catch (_) {}
      }
    }
  } catch (_) {}

  const scene = viewer?.sceneManager?.scene || viewer?.scene;
  if (scene) {
    scene.traverse?.((obj) => {
      if (obj?.userData?.__essamManagedEntityRender || obj?.userData?.__essamCoreSelectionOverlay) return;
      const n = obj?.userData?.layer ?? obj?.userData?.layerName ?? obj?.userData?.dxfLayer ?? obj?.name;
      if (typeof n === "string" && n.trim() === layerName) obj.visible = isVisible;
    });
  }

  viewer?.enableRender?.();
}

function isAnnotationLayer(layerName) {
  if (!layerName) return false;
  if (window.cadDrawingOverlay?.getLayerMeta?.(layerName)) return true;
  return /^\s*(✏️|🖍️|🧽|📐|⬛|⚪|🔤|Annotation|تعليق|رسم)/i.test(String(layerName));
}

function modelHasLayer(model, layerName) {
  const layers = Array.isArray(model?.layers) ? model.layers : [];
  const target = String(layerName || "").trim();
  return layers.some((layer) => {
    if (typeof layer === "string") return layer.trim() === target;
    const name = layer?.name ?? layer?.id ?? layer?.layerName;
    return String(name || "").trim() === target;
  });
}

function getActiveFileName() {
  return window.cadApp?.uploader?.file?.name || currentFileName || "Project";
}

function getMergedRawData() {
  const registry = window.__essamEntityRegistry || null;
  if (registry?.getAll) {
    const annotationEntities = getAnnotationLayerEntities();
    const annotationLayers = getAnnotationLayerNames();
    const layerSet = new Set(registry.getLayerNames?.() || []);
    annotationLayers.forEach((name) => layerSet.add(name));
    return {
      source: "entity-registry",
      layers: Array.from(layerSet),
      entities: [
        ...registry.getAll({ includeDeleted: true }),
        ...annotationEntities,
      ],
      documentModel: window.__essamDocumentModel || null,
      entityRegistry: registry,
    };
  }

  if (!window.cadApp?.viewer) return { layers: [], entities: [] };
  const rawData = CADLayerKit.extractFromViewer(window.cadApp.viewer);
  const annotationEntities = getAnnotationLayerEntities();
  const annotationLayers = getAnnotationLayerNames();
  const layerSet = new Set(Array.isArray(rawData.layers) ? rawData.layers : []);
  annotationLayers.forEach((name) => layerSet.add(name));
  return {
    ...rawData,
    layers: Array.from(layerSet),
    entities: [...(Array.isArray(rawData.entities) ? rawData.entities : []), ...annotationEntities],
  };
}

function getVisibleExportEntities() {
  const rawData = getMergedRawData();
  return (rawData.entities || []).filter((item) => {
    if (!item) return false;
    if (item.deleted === true || item.visible === false) return false;
    const layer = item.layer || "0";
    const rule = state.rules[layer];
    if (rule?.visible === false || rule?.type === "hide") return false;
    return true;
  });
}

let isRefreshing = false; // القفل اللي هيمنع الحلقة المفرغة

function refreshFromViewer() {
  // لو الدالة شغالة حالياً، متسمحش بتشغيلها تاني من أي Event
  if (isRefreshing) return; 
  isRefreshing = true;

  try {
      if (!window.cadApp?.viewer) return;
      
      const res = getMergedRawData();
      const baseLayers = Array.isArray(res.layers) ? res.layers.slice() : [];
      
      getAnnotationLayerNames().forEach((name) => { 
          if (!baseLayers.includes(name)) baseLayers.push(name); 
      });
      
      state.layers = baseLayers.sort((a, b) => a.localeCompare(b));
      ensureDefaults(state.layers);
      
      getAnnotationLayerNames().forEach((name) => {
        if (!state.rules[name]) {
          state.rules[name] = { type: "lines", color: "#ff3333", ...getDefaultsForType("lines") };
        }
      });
      
      // Refresh is read-only. It must not push runtime layers back into x-viewer
      // and must not overwrite EntityRegistry edits.
      renderList();
      
  } finally {
      // بنفك القفل بعد 50 مللي ثانية عشان نمتص أي إشعارات متأخرة
      setTimeout(() => { isRefreshing = false; }, 50);
  }
}

function exportFinalJSON() {
  saveRules();
  if (!window.cadApp?.viewer) return;
  const visibleEntities = getVisibleExportEntities();
  const finalScene = CADSceneExporter.export(
      visibleEntities, state.rules, 
      { fileName: currentFileName, scale: globalSettings.scale }
  );
  const blob = new Blob([JSON.stringify(finalScene, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${currentFileName}_3D.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function preview3D() {
  saveRules();
  if (!window.cadApp?.viewer) return;
  const visibleEntities = getVisibleExportEntities();
  const finalScene = CADSceneExporter.export(
      visibleEntities, state.rules, 
      { fileName: currentFileName, scale: globalSettings.scale }
  );
  if (window.cad3dOpen) window.cad3dOpen(finalScene);
}

function exportCurrentDXF() {
  saveRules();
  const entities = getVisibleExportEntities();
  ProjectExporter.exportDXF({ entities, fileName: currentFileName, rules: state.rules });
}

async function exportCurrentPDF() {
  saveRules();
  const entities = getVisibleExportEntities();
  await ProjectExporter.exportPDF({ entities, fileName: currentFileName, rules: state.rules });
}

function exportCurrentDWG() {
  saveRules();
  const entities = getVisibleExportEntities();
  ProjectExporter.exportDWG({ entities, fileName: currentFileName, rules: state.rules });
}

function renderList() {
    listEl.innerHTML = "";
    const q = (panel.querySelector("input[type=search], input[placeholder]")?.value || "").toLowerCase();
    
    state.layers.filter(l => l.toLowerCase().includes(q)).forEach(layer => {
        const rule = state.rules[layer];
        const row = el("div", { style: { border: "1px solid rgba(255,255,255,0.12)", padding: "10px", borderRadius: "12px", background: "rgba(255,255,255,0.04)", boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}, [
            el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", gap: "8px" }}, [
                el("div", { style: { display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}, [
                    el("input", { type: "checkbox", checked: rule.visible !== false, onchange: (e) => { rule.visible = e.target.checked; saveRules(); applyViewerLayerVisibility(layer, rule.visible); } }),
                    el("strong", { style: { fontSize: "13px", color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}, [layer])
                ]),
                typeSelect(layer, rule)
            ]),
            paramsRow(layer, rule)
        ]);
        listEl.appendChild(row);
    });
}

function typeSelect(layer, rule) {
    const sel = el("select", { style: inputStyle({ width: "auto", fontSize: "11px", padding: "6px 8px", borderRadius: "8px" }), onchange: (e) => { 
        rule.type = e.target.value; 
        Object.assign(rule, getDefaultsForType(rule.type));
        saveRules(); renderList(); 
    }});
    const opts = [["lines",t("layerTypes.lines","خطوط")],["walls",t("layerTypes.walls","حوائط")],["columns",t("layerTypes.columns","أعمدة")],["floor",t("layerTypes.floor","أرضية")],["ceiling",t("layerTypes.ceiling","سقف")],["beams",t("layerTypes.beams","كمرة")],["lights",t("layerTypes.lights","إضاءة")],["glass",t("layerTypes.glass","زجاج")],["door",t("layerTypes.door","باب/نافذة")],["furniture",t("layerTypes.furniture","فرش")],["hide",t("layerTypes.hide","إخفاء")]];
    opts.forEach(([v,l]) => {
        const o = document.createElement("option"); o.value = v; o.text = l; if(rule.type===v) o.selected=true; sel.appendChild(o);
    });
    return sel;
}

function paramsRow(layer, rule) {
    const c = el("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "flex-end" } });
    const colDiv = el("div", { style: { display: "flex", flexDirection: "column" }}, [
        el("span", { style: { fontSize: "9px", color: "rgba(255,255,255,0.62)" }}, [t("layers.color","اللون")]),
        el("input", { type: "color", value: rule.color || "#cccccc", style: { width: "30px", height: "20px", border: "none", padding: 0, cursor:"pointer" }, 
        onchange: (e) => rule.color = e.target.value })
    ]);
    c.appendChild(colDiv);

    const inp = (lbl, key, def="0") => {
        c.appendChild(el("div", { style: { display: "flex", flexDirection: "column" }}, [
            el("span", { style: { fontSize: "9px", color: "rgba(255,255,255,0.62)" }}, [lbl]),
            el("input", { type: "number", value: rule[key]??def, step: "0.1", style: inputStyle({ width: "50px", fontSize: "11px", padding: "3px", borderRadius: "6px" }), 
            oninput: (e) => rule[key] = parseFloat(e.target.value) })
        ]));
    };
    
    if(rule.type === "walls") { 
        inp(t("layers.height","الارتفاع"), "height"); inp(t("layers.thickness","السماكة"), "thickness"); 
        const chk = el("input", { type: "checkbox", checked: !!rule.hasCeiling, onchange: (e) => { rule.hasCeiling = e.target.checked; } });
        c.appendChild(el("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", marginLeft: "auto" }}, [el("span", { style: { fontSize: "9px", color: "rgba(255,255,255,0.62)" }}, [t("layers.autoCeil","سقف تلقائي")]), chk]));
    }
    else if(rule.type === "columns") { inp(t("layers.height","الارتفاع"), "height"); inp(t("layers.thickness","السماكة"), "thickness"); inp(t("layers.elevation","المنسوب"), "elevation"); }
    else if(rule.type === "furniture") { inp(t("layers.height","الارتفاع"), "height", "0.75"); inp(t("layers.width","العرض"), "thickness", "0.08"); inp(t("layers.elevation","المنسوب"), "elevation"); }
    else if(rule.type === "lights") { inp(t("layers.elevation","المنسوب"), "elevation"); inp(t("layers.width","العرض"), "thickness"); inp(t("layers.intensity","الشدة"), "intensity", "2.0"); inp(t("layers.range","المدى"), "range", "8.0"); inp(t("layers.spacing","التباعد"), "lightSpacing", "2.4"); }
    else if(rule.type === "beams") { inp(t("layers.elevation","المنسوب"), "elevation"); inp(t("layers.depth","العمق"), "height"); inp(t("layers.width","العرض"), "thickness"); }
    else if(rule.type === "door" || rule.type === "glass") { inp(t("layers.sill","العتبة"), "elevation"); inp(t("layers.height","الارتفاع"), "height"); }
    else if(rule.type === "floor" || rule.type === "ceiling") { inp(t("layers.level","المستوى"), "elevation"); inp(t("layers.thickness","السماكة"), "thickness"); }
    else if(rule.type === "lines") { inp(t("layers.elevation","المنسوب"), "elevation"); inp(t("layers.width","العرض"), "thickness"); }
    
    c.addEventListener("input", () => { state.rules[layer] = rule; });
    return c;
}

function toggleCollapse() { collapsed = !collapsed; content.style.display = collapsed ? "none" : "flex"; panel.style.height = collapsed ? "auto" : "85vh"; }
function show() { ensurePanel(); panel.style.display = "flex"; if (!state.layers.length) refreshFromViewer(); }
function hide() { ensurePanel(); panel.style.display = "none"; }
function isVisible() { ensurePanel(); return panel && panel.style.display !== "none"; }

// التعديل الرئيسي لمنع الدبل كليك
let lastToggleTime = 0;
function toggle() { 
    const now = Date.now();
    if (now - lastToggleTime < 250) return;
    lastToggleTime = now;
    if (!isVisible()) show(); else hide(); 
}

ensurePanel();
window.layerRulesPanel = window.layerRulesUI;
window.addEventListener("cad:language-changed", () => { 
    try { 
        if (panel) {
            const titleEl = panel.querySelector("#layer-rules-title");
            if (titleEl) titleEl.textContent = panelTranslations.title();
            
            const subtitleEl = panel.querySelector("#layer-rules-subtitle");
            if (subtitleEl) subtitleEl.textContent = panelTranslations.subtitle();
        }
        renderList(); 
    } catch (_) {} 
});