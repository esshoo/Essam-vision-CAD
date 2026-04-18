/**
 * LayerRulesPanel.js (v13 - Cleaned Up)
 * - Sun slider removed (moved to 3D Scene Overlay).
 * - Retains Scale and Intensity settings.
 */
import { CADLayerKit, LayerRulesStore } from "../CADLayerKit.js";
import { CADSceneExporter } from "../CADSceneExporter.js"; 

const PROJECT_ID = "active";
let state = { layers: [], rules: {} };
let currentFileName = "Project"; 
let globalSettings = { scale: 0.001, sunIntensity: 1.0 }; // Default

// Helper functions (el, btn) ... same as before
function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "style") Object.assign(n.style, v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of children) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  return n;
}

function btn(label, onClick, color = "#fff", border = "1px solid #ccc") {
  return el("button", {
    type: "button",
    style: {
      border: border, background: color, borderRadius: "6px",
      padding: "6px 10px", cursor: "pointer", fontSize: "12px", fontWeight: "bold", flex: "1"
    },
    onclick: onClick
  }, [label]);
}

let panel, header, content, listEl, footerEl;
let collapsed = false;

function ensurePanel() {
  if (document.getElementById("layer-rules-panel")) return;

  panel = el("aside", { id: "layer-rules-panel", style: {
    position: "absolute", left: "20px", top: "20px", width: "420px", height: "85vh",
    zIndex: 4200, background: "rgba(255,255,255,0.98)", border: "1px solid #ccc",
    borderRadius: "12px", boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
    display: "flex", flexDirection: "column", fontFamily: "sans-serif", overflow: "hidden"
  }});

  header = el("div", { style: { padding: "12px", background: "#f8f9fa", borderBottom: "1px solid #ddd", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "move" }}, [
    el("span", { style: { fontWeight: "bold", color: "#333" }}, ["عصام الكهربائي 0501618112Layer Config v13"]),
    el("div", { style: { display: "flex", gap: "5px" }}, [
      btn("—", toggleCollapse),
      btn("✕", hide, "#ffebeb", "1px solid #ffcccc")
    ])
  ]);

  content = el("div", { style: { display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }});

  const tools = el("div", { style: { padding: "10px", borderBottom: "1px solid #eee", background: "#fff", display: "flex", flexDirection: "column", gap: "10px" }}, [
    // 1. Settings (Scale only now, Sun is in 3D)
    el("div", { style: { display: "flex", alignItems: "center", gap: "10px", fontSize: "12px" }}, [
        el("label", {}, ["Scale:"]),
        el("input", { 
            type: "number", value: "0.001", step: "0.001", 
            style: { width: "70px", padding: "4px", border: "1px solid #ccc", borderRadius: "4px" },
            onchange: (e) => globalSettings.scale = parseFloat(e.target.value)
        }),
        el("span", { style: { color: "#888" }}, ["(Sun is inside 3D View)"])
    ]),
    
    // 2. Actions
    el("div", { style: { display: "flex", gap: "5px" }}, [
        btn("⟳ Scan", refreshFromViewer, "#f0f8ff"),
        btn("💾 Save", saveRules, "#f0f8ff"),
    ]),
    el("div", { style: { display: "flex", gap: "5px" }}, [
        btn("📥 Export JSON", exportFinalJSON, "#fffbe6"),
        btn("🚀 Preview 3D", preview3D, "#e6f7ff", "1px solid #b3d7ff")
    ]),

    el("input", { 
        placeholder: "Search layers...", 
        style: { width: "100%", padding: "8px", border: "1px solid #ddd", borderRadius: "4px", boxSizing: "border-box" },
        oninput: renderList
    })
  ]);

  listEl = el("div", { style: { flex: "1", overflowY: "auto", padding: "10px", display: "flex", flexDirection: "column", gap: "8px", background: "#fafafa" }});
  footerEl = el("div", { style: { padding: "8px", fontSize: "11px", color: "#888", textAlign: "center", borderTop: "1px solid #eee" }}, ["Auto-detects Walls, Lights, etc."]);

  content.appendChild(tools);
  content.appendChild(listEl);
  content.appendChild(footerEl);
  panel.appendChild(header);
  panel.appendChild(content);
  document.body.appendChild(panel);

  makeDraggable(panel, header);
  loadRules();
  
  window.layerRulesUI = { show, hide, toggle, preview3D, exportFinalJSON, refreshFromViewer };

  window.addEventListener("cad:file-loaded", () => {
     if(window.cadApp?.uploader?.file) currentFileName = window.cadApp.uploader.file.name.replace(/\.(dxf|dwg)$/i, "");
     refreshFromViewer();
     show();
  });
}

function makeDraggable(target, handle) {
  let startX = 0, startY = 0, startLeft = 0, startTop = 0, dragging = false;
  handle.addEventListener("pointerdown", (e) => {
    if (e.target.tagName === "BUTTON" || e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
    dragging = true; handle.setPointerCapture(e.pointerId);
    startX = e.clientX; startY = e.clientY;
    const rect = target.getBoundingClientRect();
    startLeft = rect.left; startTop = rect.top;
  });
  handle.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    target.style.left = (startLeft + e.clientX - startX) + "px";
    target.style.top = (startTop + e.clientY - startY) + "px";
  });
  handle.addEventListener("pointerup", () => dragging = false);
}

function loadRules() { state.rules = LayerRulesStore.load(PROJECT_ID); }
function saveRules() { LayerRulesStore.save(PROJECT_ID, state.rules); }

// ... (Rest of detectType, ensureDefaults, getDefaultsForType same as V12) ...
function detectType(name) {
    const n = name.toLowerCase();
    if (n.includes("wall") || n.includes("mur")) return "walls";
    if (n.includes("glass") || n.includes("win")) return "glass";
    if (n.includes("door")) return "door";
    if (n.includes("floor") || n.includes("sol")) return "floor";
    if (n.includes("ceil")) return "ceiling";
    if (n.includes("beam")) return "beams";
    if (n.includes("light") || n.includes("lum")) return "lights";
    if (n.includes("dim") || n.includes("text") || n.includes("hatch")) return "hide";
    return "lines";
}

function ensureDefaults(layers) {
    const existing = state.rules || {};
    for (const name of layers) {
        if (!existing[name]) {
            const type = detectType(name);
            existing[name] = { type, color: "#cccccc", ...getDefaultsForType(type) };
        }
    }
    state.rules = existing;
}

function getDefaultsForType(type) {
    if(type === "walls") return { height: 3.0, thickness: 0.2, elevation: 0.0, hasCeiling: false };
    if(type === "beams") return { height: 0.5, thickness: 0.2, elevation: 2.5 };
    if(type === "floor") return { thickness: 0.1, elevation: 0.0 };
    if(type === "ceiling") return { thickness: 0.1, elevation: 3.0 };
    if(type === "lights") return { thickness: 0.1, elevation: 2.8, intensity: 2.0 };
    if(type === "glass" || type === "door") return { height: 2.1, elevation: 0.0 };
    return { height: 0.0, thickness: 0.01, elevation: 0.0 };
}

function getPenLayerEntities() {
  try {
    return window.cadDrawingOverlay?.get3DEntities?.() || [];
  } catch (err) {
    console.warn("Pen layer export failed:", err);
    return [];
  }
}

function getMergedRawData() {
  if (!window.cadApp?.viewer) return { layers: [], entities: [] };
  const rawData = CADLayerKit.extractFromViewer(window.cadApp.viewer);
  const penEntities = getPenLayerEntities();
  const layerSet = new Set(Array.isArray(rawData.layers) ? rawData.layers : []);
  if (penEntities.length) layerSet.add("✏️ Pen");
  return {
    ...rawData,
    layers: Array.from(layerSet),
    entities: [...(Array.isArray(rawData.entities) ? rawData.entities : []), ...penEntities],
  };
}

function refreshFromViewer() {
  if (!window.cadApp?.viewer) return;
  const res = getMergedRawData();
  const baseLayers = Array.isArray(res.layers) ? res.layers.slice() : [];
  if (!baseLayers.includes("✏️ Pen")) baseLayers.push("✏️ Pen");
  state.layers = baseLayers.sort((a, b) => a.localeCompare(b));
  ensureDefaults(state.layers);
  if (!state.rules["✏️ Pen"]) {
    state.rules["✏️ Pen"] = { type: "lines", color: "#ff3333", ...getDefaultsForType("lines") };
  }
  renderList();
}

function exportFinalJSON() {
  saveRules();
  if (!window.cadApp?.viewer) return;
  const rawData = getMergedRawData();
  const finalScene = CADSceneExporter.export(
      rawData.entities, state.rules, 
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
  const rawData = getMergedRawData();
  // Pass scale, Sun Intensity handled in 3D view now
  const finalScene = CADSceneExporter.export(
      rawData.entities, state.rules, 
      { fileName: currentFileName, scale: globalSettings.scale }
  );
  if (window.cad3dOpen) window.cad3dOpen(finalScene);
}

function renderList() {
    listEl.innerHTML = "";
    const q = (panel.querySelector("input[placeholder*='Search']")?.value || "").toLowerCase();
    
    state.layers.filter(l => l.toLowerCase().includes(q)).forEach(layer => {
        const rule = state.rules[layer];
        const row = el("div", { style: { border: "1px solid #eee", padding: "10px", borderRadius: "8px", background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}, [
            el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}, [
                el("strong", { style: { fontSize: "13px", color: "#444" }}, [layer]),
                typeSelect(layer, rule)
            ]),
            paramsRow(layer, rule)
        ]);
        listEl.appendChild(row);
    });
}

function typeSelect(layer, rule) {
    const sel = el("select", { style: { fontSize: "11px", padding: "3px", borderRadius: "4px", border: "1px solid #ccc" }, onchange: (e) => { 
        rule.type = e.target.value; 
        Object.assign(rule, getDefaultsForType(rule.type));
        saveRules(); renderList(); 
    }});
    const opts = [["lines","Lines"],["walls","Walls"],["floor","Floor"],["ceiling","Ceiling"],["beams","Beam"],["lights","Light"],["glass","Glass"],["door","Door/Win"],["hide","Hide"]];
    opts.forEach(([v,l]) => {
        const o = document.createElement("option"); o.value = v; o.text = l; if(rule.type===v) o.selected=true; sel.appendChild(o);
    });
    return sel;
}

function paramsRow(layer, rule) {
    const c = el("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "flex-end" } });
    const colDiv = el("div", { style: { display: "flex", flexDirection: "column" }}, [
        el("span", { style: { fontSize: "9px", color: "#888" }}, ["Color"]),
        el("input", { type: "color", value: rule.color || "#cccccc", style: { width: "30px", height: "20px", border: "none", padding: 0, cursor:"pointer" }, 
        onchange: (e) => rule.color = e.target.value })
    ]);
    c.appendChild(colDiv);

    const inp = (lbl, key, def="0") => {
        c.appendChild(el("div", { style: { display: "flex", flexDirection: "column" }}, [
            el("span", { style: { fontSize: "9px", color: "#888" }}, [lbl]),
            el("input", { type: "number", value: rule[key]??def, step: "0.1", style: { width: "50px", fontSize: "11px", padding: "3px", border: "1px solid #ddd", borderRadius: "3px" }, 
            oninput: (e) => rule[key] = parseFloat(e.target.value) })
        ]));
    };
    
    if(rule.type === "walls") { 
        inp("Height", "height"); inp("Thick", "thickness"); 
        const chk = el("input", { type: "checkbox", checked: !!rule.hasCeiling, onchange: (e) => { rule.hasCeiling = e.target.checked; } });
        c.appendChild(el("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", marginLeft: "auto" }}, [el("span", { style: { fontSize: "9px", color: "#888" }}, ["AutoCeil"]), chk]));
    }
    else if(rule.type === "lights") { inp("Elev", "elevation"); inp("Width", "thickness"); inp("Inten", "intensity", "2.0"); }
    else if(rule.type === "beams") { inp("Elev", "elevation"); inp("Depth", "height"); inp("Width", "thickness"); }
    else if(rule.type === "door" || rule.type === "glass") { inp("Sill", "elevation"); inp("Height", "height"); }
    else if(rule.type === "floor" || rule.type === "ceiling") { inp("Level", "elevation"); inp("Thick", "thickness"); }
    else if(rule.type === "lines") { inp("Elev", "elevation"); inp("Width", "thickness"); }
    
    c.addEventListener("input", () => { state.rules[layer] = rule; });
    return c;
}

function toggleCollapse() { collapsed = !collapsed; content.style.display = collapsed ? "none" : "flex"; panel.style.height = collapsed ? "auto" : "85vh"; }
function show() { panel.style.display = "flex"; if (!state.layers.length) refreshFromViewer(); }
function hide() { panel.style.display = "none"; }
function toggle() { if (panel.style.display === "none") show(); else hide(); }

ensurePanel();