/**
 * CAD3DBridge.js (v42 - Clean Integration)
 * - Delegates all rendering and UI to EssamEngine.
 * - Handles File Picking and Overlay management only.
 */
import { EssamEngine } from './EssamEngine.js';

export const CAD3DBridge = {
  overlay: null,
  engine: null,

  createOverlay() {
    if (document.getElementById("cad-3d-overlay")) return;
    
    // 1. Create Container
    this.overlay = document.createElement("div");
    this.overlay.id = "cad-3d-overlay";
    Object.assign(this.overlay.style, {
      position: "fixed", top: "0", left: "0", width: "100%", height: "100%",
      zIndex: "9999", background: "#000", display: "flex", flexDirection: "column"
    });

    // 2. Header
    const header = document.createElement("div");
    Object.assign(header.style, {
      height: "50px", background: "#222", display: "flex", alignItems: "center",
      padding: "0 20px", borderBottom: "1px solid #444", justifyContent: "space-between", flexShrink: "0"
    });
    const title = document.createElement("span");
    title.textContent = "3D Viewer (Essam Engine)"; title.style.color = "#fff"; title.style.fontWeight = "bold";
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕ Close";
    closeBtn.style.cssText = "background:#d9534f;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;";
    closeBtn.onclick = () => this.close();
    
    header.appendChild(title); header.appendChild(closeBtn);
    this.overlay.appendChild(header);

    // 3. Canvas Container
    const canvasContainer = document.createElement("div");
    canvasContainer.id = "cad-3d-canvas"; 
    Object.assign(canvasContainer.style, { flex: "1", position: "relative", overflow: "hidden" });
    this.overlay.appendChild(canvasContainer);

    // 4. Mobile Crosshair (UI Element managed here for simplicity, or inside Engine)
    const crosshair = document.createElement("div");
    crosshair.id = "mobile-crosshair";
    Object.assign(crosshair.style, {
        position: "absolute", width: "40px", height: "40px", border: "2px solid #00ff00", borderRadius: "50%", 
        transform: "translate(-50%, -50%)", pointerEvents: "none", display: "none", zIndex: "10001"
    });
    canvasContainer.appendChild(crosshair);

    document.body.appendChild(this.overlay);

    // 5. Initialize Engine
    // The Engine will now create its own Sun Slider inside the container
    this.engine = new EssamEngine("#cad-3d-canvas");
  },

  close() {
    if (this.overlay) { 
        if(this.engine && this.engine.renderer) this.engine.renderer.setAnimationLoop(null);
        this.overlay.remove(); 
        this.overlay = null; 
        this.engine = null;
    }
  },

  loadJSON(json) {
      this.createOverlay();
      if(this.engine) {
          try {
              this.engine.buildSceneFromConfig(json, json.rulesByLayer, json.settings || {});
          } catch (e) {
              console.error('[CAD3DBridge] Failed to open 3D view:', e);
              alert('تعذر فتح العرض ثلاثي الأبعاد. افتح الكونسول لمعرفة الخطأ.');
              throw e;
          }
      }
  }
};

// --- Entry Point ---
window.cad3dOpen = (jsonData) => {
    if (jsonData) { 
        CAD3DBridge.loadJSON(jsonData); 
        return; 
    }

    const input = document.createElement("input");
    input.type = "file"; 
    input.accept = "application/json";
    input.onchange = async () => {
        if(input.files[0]) {
            try { 
                const text = await input.files[0].text();
                CAD3DBridge.loadJSON(JSON.parse(text)); 
            } 
            catch(e) { console.error("Invalid JSON", e); alert("Invalid JSON File"); }
        }
    };
    input.click();
};