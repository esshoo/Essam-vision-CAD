/**
 * DrawingOverlay.js v7
 * --------------------
 * Transparent drawing layer for PDF/DXF markup.
 * v3 stores points in Viewer/world coordinates, not fixed screen pixels.
 * v4 adds geometric tools: straight line, rectangle, square, ellipse, circle.
 * v5 adds text annotations with edit/delete support.
 * v6 adds select/move/delete/copy/paste.
 * v7 adds Export PDF by flattening annotations as transparent overlays on original PDF pages.
 * v11 adds Save/Open Annotations JSON for moving annotations between browsers/devices.
 * v12 adds selected-item properties: color, line width, opacity, and text size.
 * v13 merges all drawing/properties controls into one draggable, collapsible floating panel.
 * v14 fixes floating panel buttons, minimize/close, inputs, and drag events.
 * v17 clips drawing inside the active file bounds, keeps drawings behind old project menus, and ignores UI clicks outside the viewer.
 * Result: drawings stay attached to the PDF/DXF while zooming, panning, or fitting the view.
 */
import { THREE } from "@x-viewer/core";

function css(node, styles) {
  Object.assign(node.style, styles);
}

class CADDrawingOverlay {
  constructor() {
    this.enabled = false;
    this.tool = "pen";
    this.color = "#ff3333";
    this.size = 3;
    this.fontSize = Number(localStorage.getItem("essam-cad-drawing-font-size") || 22);
    this.opacity = Number(localStorage.getItem("essam-cad-drawing-opacity") || 1);
    if (!Number.isFinite(this.opacity) || this.opacity <= 0 || this.opacity > 1) this.opacity = 1;
    this.strokes = [];
    this.currentStroke = null;
    this.lastStorageKey = null;
    this.activePointerId = null;
    this.allowTouchDrawing = localStorage.getItem("essam-cad-drawing-allow-touch") === "1";
    this.selectedIndex = -1;
    this.dragSelection = null;
    this.clipboardItem = null;
    this.annotationLayerName = "✏️ Pen";

    this.canvas = null;
    this.ctx = null;
    this.toolbar = null;
    this.status = null;
    this.propertiesPanel = null;
    this.propColorInput = null;
    this.propSizeInput = null;
    this.propOpacityInput = null;
    this.propFontSizeInput = null;
    this.propTitle = null;
    this.colorInput = null;
    this.sizeInput = null;
    this.fontSizeInput = null;
    this.opacityInput = null;
    this.toolbarHeader = null;
    this.toolbarBody = null;
    this.minimizeBtn = null;
    this.toolbarCollapsed = localStorage.getItem("essam-cad-drawing-toolbar-collapsed") === "1";
    this.toolbarDrag = null;

    this._lastViewSignature = "";
    this._raf = 0;
    this._boundResize = () => this.resizeCanvas(true);
    this._boundFileLoaded = () => this.handleFileOrPageChange();
    this._boundPageChanged = () => this.handleFileOrPageChange();
    this._boundKeyDown = (e) => this.onKeyDown(e);
  }

  init() {
    if (document.getElementById("cad-drawing-canvas")) return;

    this.canvas = document.createElement("canvas");
    this.canvas.id = "cad-drawing-canvas";
    const viewerHost = this.getViewerContainer();
    if (viewerHost) viewerHost.style.position = viewerHost.style.position || "relative";
    css(this.canvas, {
      position: viewerHost ? "absolute" : "fixed",
      inset: "0",
      width: viewerHost ? "100%" : "100vw",
      height: viewerHost ? "100%" : "100vh",
      zIndex: "3900",
      pointerEvents: "none",
      touchAction: "auto",
      cursor: "crosshair",
    });
    (viewerHost || document.body).appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");

    this.createToolbar();
    this.bindPointerEvents();
    this.resizeCanvas(false);

    window.addEventListener("resize", this._boundResize);
    window.addEventListener("cad:file-loaded", this._boundFileLoaded);
    window.addEventListener("cad:pdf-page-changed", this._boundPageChanged);
    window.addEventListener("keydown", this._boundKeyDown, true);

    setInterval(() => {
      const key = this.getStorageKey();
      if (key !== this.lastStorageKey) this.handleFileOrPageChange();
    }, 700);

    this.startViewSyncLoop();
  }

  createToolbar() {
    this.toolbar = document.createElement("div");
    this.toolbar.id = "cad-drawing-toolbar";
    const savedLeft = localStorage.getItem("essam-cad-drawing-toolbar-left") || "18px";
    const savedTop = localStorage.getItem("essam-cad-drawing-toolbar-top") || "18px";
    css(this.toolbar, {
      position: "fixed",
      top: savedTop,
      left: savedLeft,
      zIndex: "6500",
      display: "none",
      width: "min(380px, calc(100vw - 24px))",
      maxHeight: "calc(100vh - 24px)",
      borderRadius: "16px",
      border: "1px solid rgba(255,255,255,0.18)",
      background: "rgba(8,10,14,0.82)",
      color: "#fff",
      boxShadow: "0 16px 40px rgba(0,0,0,0.42)",
      backdropFilter: "blur(10px)",
      fontFamily: "Arial, sans-serif",
      userSelect: "none",
      overflow: "hidden",
    });

    this.toolbarHeader = document.createElement("div");
    css(this.toolbarHeader, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "8px",
      padding: "9px 10px",
      background: "rgba(255,255,255,0.08)",
      cursor: "move",
      borderBottom: "1px solid rgba(255,255,255,0.12)",
    });

    const title = document.createElement("div");
    title.textContent = "أدوات الرسم";
    css(title, { fontWeight: "900", fontSize: "13px", letterSpacing: "0.2px", whiteSpace: "nowrap" });

    const headerActions = document.createElement("div");
    css(headerActions, { display: "flex", alignItems: "center", gap: "6px" });

    this.toolbarBody = document.createElement("div");
    css(this.toolbarBody, {
      display: "flex",
      alignItems: "center",
      gap: "7px",
      padding: "10px",
      flexWrap: "wrap",
      maxHeight: "calc(100vh - 86px)",
      overflow: "auto",
      boxSizing: "border-box",
    });

    const makeBtn = (label, title, tool, onClick) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.title = title;
      btn.dataset.label = label;
      if (tool) btn.dataset.tool = tool;
      css(btn, this.buttonStyle());
      btn.onclick = onClick;
      return btn;
    };

    this.minimizeBtn = makeBtn(this.toolbarCollapsed ? "▣" : "—", "تصغير / تكبير نافذة الرسم", "", () => this.toggleToolbarCollapsed());
    const headerClose = makeBtn("×", "إغلاق الرسم", "", () => this.disable());
    css(this.minimizeBtn, { minWidth: "34px", padding: "6px 8px" });
    css(headerClose, { minWidth: "34px", padding: "6px 8px" });
    headerActions.append(this.minimizeBtn, headerClose);
    this.toolbarHeader.append(title, headerActions);

    this.selectBtn = makeBtn("☝️ تحديد", "Select / Move", "select", () => this.setTool("select"));
    this.penBtn = makeBtn("✏️ قلم", "Pen", "pen", () => this.setTool("pen"));
    this.highlighterBtn = makeBtn("🖍️ تظليل", "Highlighter", "highlighter", () => this.setTool("highlighter"));
    this.lineBtn = makeBtn("╱ خط", "Straight line", "line", () => this.setTool("line"));
    this.rectBtn = makeBtn("▭ مستطيل", "Rectangle", "rectangle", () => this.setTool("rectangle"));
    this.squareBtn = makeBtn("□ مربع", "Square", "square", () => this.setTool("square"));
    this.ellipseBtn = makeBtn("◯ بيضاوي", "Ellipse", "ellipse", () => this.setTool("ellipse"));
    this.circleBtn = makeBtn("● دائرة", "Circle", "circle", () => this.setTool("circle"));
    this.textBtn = makeBtn("T نص", "Text", "text", () => this.setTool("text"));
    this.eraserBtn = makeBtn("🧽 ممحاة", "Eraser", "eraser", () => this.setTool("eraser"));
    this.touchBtn = makeBtn("", "تحديد هل اللمس يرسم أم يحرك الصفحة", "", () => this.toggleTouchDrawing());
    this.updateTouchButton();

    const color = document.createElement("input");
    color.type = "color";
    color.value = this.color;
    color.title = "لون القلم / الشكل";
    this.colorInput = color;
    css(color, { width: "38px", height: "32px", borderRadius: "10px", cursor: "pointer" });
    color.oninput = () => { this.color = color.value; };

    const size = document.createElement("input");
    size.type = "range";
    size.min = "1";
    size.max = "30";
    size.value = String(this.size);
    size.title = "سمك الخط";
    this.sizeInput = size;
    css(size, { width: "86px", cursor: "pointer" });
    size.oninput = () => { this.size = Number(size.value) || 3; };

    const fontSize = document.createElement("input");
    fontSize.type = "number";
    fontSize.min = "8";
    fontSize.max = "120";
    fontSize.value = String(this.fontSize);
    fontSize.title = "حجم النص";
    this.fontSizeInput = fontSize;
    css(fontSize, { width: "58px", height: "30px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.18)", padding: "0 6px" });
    fontSize.oninput = () => {
      this.fontSize = Math.max(8, Math.min(120, Number(fontSize.value) || 22));
      localStorage.setItem("essam-cad-drawing-font-size", String(this.fontSize));
    };

    const opacityLabel = document.createElement("span");
    opacityLabel.textContent = "شفافية";
    css(opacityLabel, { fontSize: "12px", opacity: "0.85" });

    const opacity = document.createElement("input");
    opacity.type = "range";
    opacity.min = "0.05";
    opacity.max = "1";
    opacity.step = "0.05";
    opacity.value = String(this.opacity);
    opacity.title = "شفافية الرسم الجديد";
    this.opacityInput = opacity;
    css(opacity, { width: "76px", cursor: "pointer" });
    opacity.oninput = () => {
      this.opacity = Math.max(0.05, Math.min(1, Number(opacity.value) || 1));
      localStorage.setItem("essam-cad-drawing-opacity", String(this.opacity));
    };

    const textLabel = document.createElement("span");
    textLabel.textContent = "نص";
    css(textLabel, { fontSize: "12px", opacity: "0.85" });

    const deleteSelected = makeBtn("⌫ حذف", "حذف العنصر المحدد", "", () => this.deleteSelected());
    const undo = makeBtn("↶", "تراجع", "", () => this.undo());
    const clear = makeBtn("🗑️", "مسح الصفحة الحالية", "", () => this.clearCurrentPage());
    const save = makeBtn("💾", "حفظ الرسم داخل المتصفح", "", () => this.saveNow(true));
    const saveJson = makeBtn("💽 JSON", "حفظ كل التعليقات كملف JSON", "", () => this.exportAnnotationsJson());
    const openJson = makeBtn("📂 JSON", "فتح ملف تعليقات JSON", "", () => this.importAnnotationsJson());
    const exportPng = makeBtn("🖼️ PNG", "تصدير الرسم كصورة PNG", "", () => this.exportPng());
    const exportPdf = makeBtn("📄 PDF", "تصدير PDF مدمج عليه الرسم والنصوص", "", () => this.exportPdf());
    const close = makeBtn("إغلاق", "إغلاق الرسم", "", () => this.disable());

    this.status = document.createElement("span");
    this.status.textContent = "الرسم متوقف";
    css(this.status, { fontSize: "12px", opacity: "0.85", whiteSpace: "nowrap", flex: "1 1 100%" });

    this.toolbarBody.append(
      this.selectBtn,
      this.penBtn,
      this.highlighterBtn,
      this.lineBtn,
      this.rectBtn,
      this.squareBtn,
      this.ellipseBtn,
      this.circleBtn,
      this.textBtn,
      this.eraserBtn,
      this.touchBtn,
      color,
      size,
      opacityLabel,
      opacity,
      textLabel,
      fontSize,
      deleteSelected,
      undo,
      clear,
      save,
      saveJson,
      openJson,
      exportPng,
      exportPdf,
      close,
      this.status
    );
    this.toolbar.append(this.toolbarHeader, this.toolbarBody);
    document.body.appendChild(this.toolbar);
    this.createPropertiesPanel();
    this.bindToolbarWindow();
    this.applyToolbarCollapsedState();
    this.refreshToolButtons();
  }

  createPropertiesPanel() {
    this.propertiesPanel = document.createElement("div");
    this.propertiesPanel.id = "cad-drawing-properties";
    css(this.propertiesPanel, {
      position: "static",
      display: "none",
      alignItems: "center",
      gap: "7px",
      padding: "9px",
      marginTop: "4px",
      width: "100%",
      borderRadius: "14px",
      border: "1px solid rgba(0,160,255,0.38)",
      background: "rgba(0,160,255,0.10)",
      color: "#fff",
      fontFamily: "Arial, sans-serif",
      userSelect: "none",
      flexWrap: "wrap",
      boxSizing: "border-box",
    });

    const label = (text) => {
      const span = document.createElement("span");
      span.textContent = text;
      css(span, { fontSize: "12px", opacity: "0.88", whiteSpace: "nowrap" });
      return span;
    };

    const btn = (text, title, onClick) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = text;
      b.title = title;
      css(b, this.buttonStyle());
      b.onclick = onClick;
      return b;
    };

    this.propTitle = label("خصائص المحدد");
    css(this.propTitle, { fontSize: "13px", fontWeight: "800", opacity: "1", flex: "1 1 100%" });

    this.propColorInput = document.createElement("input");
    this.propColorInput.type = "color";
    css(this.propColorInput, { width: "38px", height: "32px", borderRadius: "10px", cursor: "pointer" });
    this.propColorInput.oninput = () => this.updateSelectedColor(this.propColorInput.value);

    this.propSizeInput = document.createElement("input");
    this.propSizeInput.type = "range";
    this.propSizeInput.min = "1";
    this.propSizeInput.max = "60";
    this.propSizeInput.value = "3";
    css(this.propSizeInput, { width: "86px", cursor: "pointer" });
    this.propSizeInput.oninput = () => this.updateSelectedSize(Number(this.propSizeInput.value) || 3);

    this.propOpacityInput = document.createElement("input");
    this.propOpacityInput.type = "range";
    this.propOpacityInput.min = "0.05";
    this.propOpacityInput.max = "1";
    this.propOpacityInput.step = "0.05";
    this.propOpacityInput.value = "1";
    css(this.propOpacityInput, { width: "76px", cursor: "pointer" });
    this.propOpacityInput.oninput = () => this.updateSelectedOpacity(Number(this.propOpacityInput.value) || 1);

    this.propFontSizeInput = document.createElement("input");
    this.propFontSizeInput.type = "number";
    this.propFontSizeInput.min = "8";
    this.propFontSizeInput.max = "160";
    css(this.propFontSizeInput, { width: "58px", height: "30px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.18)", padding: "0 6px" });
    this.propFontSizeInput.oninput = () => this.updateSelectedFontSize(Number(this.propFontSizeInput.value) || 22);

    const duplicate = btn("⧉ نسخ", "نسخ العنصر المحدد", () => {
      this.copySelected();
      this.pasteSelected();
      this.syncPropertiesFromSelected();
    });
    const del = btn("⌫ حذف", "حذف العنصر المحدد", () => this.deleteSelected());

    this.propertiesPanel.append(
      this.propTitle,
      label("لون"),
      this.propColorInput,
      label("سمك"),
      this.propSizeInput,
      label("شفافية"),
      this.propOpacityInput,
      label("حجم النص"),
      this.propFontSizeInput,
      duplicate,
      del
    );
    if (this.toolbarBody) this.toolbarBody.appendChild(this.propertiesPanel);
    else document.body.appendChild(this.propertiesPanel);
  }

  bindToolbarWindow() {
    if (!this.toolbar || !this.toolbarHeader) return;

    const stopInside = (e) => {
      if (!this.isToolbarTarget(e.target)) return;
      e.stopPropagation();
    };
    // Do not register these listeners in capture phase.
    // Capture-phase stopPropagation blocks the event before it reaches buttons/inputs,
    // which made the floating panel visible but unclickable.
    ["pointerdown", "pointermove", "pointerup", "pointercancel", "click", "dblclick", "wheel", "touchstart", "touchmove"].forEach((name) => {
      this.toolbar.addEventListener(name, stopInside, { capture: false, passive: false });
    });

    this.toolbarHeader.addEventListener("pointerdown", (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.target === this.minimizeBtn || e.target?.tagName === "BUTTON") return;
      const rect = this.toolbar.getBoundingClientRect();
      this.toolbarDrag = {
        pointerId: e.pointerId,
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top,
      };
      try { this.toolbarHeader.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
      e.stopPropagation();
    });

    this.toolbarHeader.addEventListener("pointermove", (e) => {
      if (!this.toolbarDrag || e.pointerId !== this.toolbarDrag.pointerId) return;
      const width = this.toolbar.offsetWidth || 360;
      const height = this.toolbar.offsetHeight || 60;
      const left = Math.max(8, Math.min(window.innerWidth - width - 8, e.clientX - this.toolbarDrag.offsetX));
      const top = Math.max(8, Math.min(window.innerHeight - Math.min(height, 120) - 8, e.clientY - this.toolbarDrag.offsetY));
      this.toolbar.style.left = Math.round(left) + "px";
      this.toolbar.style.top = Math.round(top) + "px";
      e.preventDefault();
      e.stopPropagation();
    });

    const finishDrag = (e) => {
      if (!this.toolbarDrag || e.pointerId !== this.toolbarDrag.pointerId) return;
      localStorage.setItem("essam-cad-drawing-toolbar-left", this.toolbar.style.left || "18px");
      localStorage.setItem("essam-cad-drawing-toolbar-top", this.toolbar.style.top || "18px");
      this.toolbarDrag = null;
      try { this.toolbarHeader.releasePointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
      e.stopPropagation();
    };
    this.toolbarHeader.addEventListener("pointerup", finishDrag);
    this.toolbarHeader.addEventListener("pointercancel", finishDrag);
  }

  toggleToolbarCollapsed() {
    this.toolbarCollapsed = !this.toolbarCollapsed;
    localStorage.setItem("essam-cad-drawing-toolbar-collapsed", this.toolbarCollapsed ? "1" : "0");
    this.applyToolbarCollapsedState();
  }

  applyToolbarCollapsedState() {
    if (!this.toolbarBody) return;
    this.toolbarBody.style.display = this.toolbarCollapsed ? "none" : "flex";
    if (this.minimizeBtn) this.minimizeBtn.textContent = this.toolbarCollapsed ? "▣" : "—";
  }

  buttonStyle() {
    return {
      border: "1px solid rgba(255,255,255,0.18)",
      background: "rgba(255,255,255,0.12)",
      color: "#fff",
      borderRadius: "12px",
      padding: "7px 9px",
      fontWeight: "800",
      cursor: "pointer",
      minHeight: "32px",
    };
  }

  setTool(tool) {
    this.tool = tool;
    if (tool !== "select") {
      this.selectedIndex = -1;
      this.dragSelection = null;
      this.syncPropertiesFromSelected();
    }
    this.refreshToolButtons();
    this.redraw();
  }

  refreshToolButtons() {
    [
      this.selectBtn,
      this.penBtn,
      this.highlighterBtn,
      this.lineBtn,
      this.rectBtn,
      this.squareBtn,
      this.ellipseBtn,
      this.circleBtn,
      this.textBtn,
      this.eraserBtn,
    ].forEach((btn) => {
      if (!btn) return;
      const isActive = btn.dataset.tool === this.tool;
      btn.style.background = isActive ? "rgba(0,160,255,0.55)" : "rgba(255,255,255,0.12)";
    });
    if (this.canvas) this.canvas.style.cursor = this.tool === "eraser" ? "cell" : (this.tool === "text" ? "text" : (this.tool === "select" ? "move" : "crosshair"));
  }

  isShapeTool(tool = this.tool) {
    return ["line", "rectangle", "square", "ellipse", "circle"].includes(tool);
  }

  bindPointerEvents() {
    const opts = { capture: true, passive: false };
    document.addEventListener("pointerdown", (e) => this.onPointerDown(e), opts);
    document.addEventListener("pointermove", (e) => this.onPointerMove(e), opts);
    document.addEventListener("pointerup", (e) => this.onPointerUp(e), opts);
    document.addEventListener("pointercancel", (e) => this.onPointerUp(e), opts);
    document.addEventListener("contextmenu", (e) => {
      if (this.enabled && this.isAcceptedDrawingInput(e)) e.preventDefault();
    }, opts);
  }

  enable() {
    this.enabled = true;
    this.canvas.style.pointerEvents = "none";
    this.toolbar.style.display = "block";
    this.applyToolbarCollapsedState();
    this.handleFileOrPageChange();
    this.updateStatus(this.getStatusText());
  }

  disable() {
    this.enabled = false;
    this.canvas.style.pointerEvents = "none";
    this.toolbar.style.display = "none";
    if (this.propertiesPanel) this.propertiesPanel.style.display = "none";
    this.currentStroke = null;
    this.activePointerId = null;
    this.saveNow(false);
    this.redraw();
  }

  toggle() {
    this.enabled ? this.disable() : this.enable();
  }

  onPointerDown(e) {
    if (!this.enabled || this.isUiTarget(e.target)) return;
    if (!this.isAcceptedDrawingInput(e)) return;

    const bounds = this.getActiveWorldBounds();
    const worldPoint = this.clientToWorld(e.clientX, e.clientY);
    if (!worldPoint) {
      this.updateStatus("لم أستطع قراءة إحداثيات الملف. جرّب بعد تحميل الملف بالكامل.");
      return;
    }
    if (!this.isInsideBounds(worldPoint, bounds)) {
      this.updateStatus("الرسم داخل حدود الملف فقط.");
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    if (this.tool === "select") {
      this.handleSelectDown(worldPoint, e.clientX, e.clientY, e.pointerId);
      return;
    }

    if (this.tool === "text") {
      this.handleTextClick(worldPoint, e.clientX, e.clientY);
      return;
    }

    this.selectedIndex = -1;
    this.syncPropertiesFromSelected();
    this.activePointerId = e.pointerId;
    const screenSize = this.getEffectiveScreenSize();
    const worldSize = this.pixelSizeToWorldSize(screenSize, e.clientX, e.clientY, worldPoint.z);

    this.currentStroke = {
      version: 7,
      coordSpace: "world",
      kind: this.isShapeTool() ? "shape" : "stroke",
      tool: this.tool,
      input: e.pointerType || "mouse",
      color: this.color,
      opacity: this.tool === "highlighter" ? Math.min(this.opacity, 0.35) : this.opacity,
      screenSize,
      worldSize,
      planeZ: worldPoint.z,
      pageBounds: this.getActiveWorldBounds(),
      layerName: this.annotationLayerName,
      points: [worldPoint],
    };
  }

  onPointerMove(e) {
    if (this.dragSelection && e.pointerId === this.activePointerId) {
      this.handleSelectMove(e);
      return;
    }

    if (!this.currentStroke || e.pointerId !== this.activePointerId) return;

    let worldPoint = this.clientToWorld(e.clientX, e.clientY, this.currentStroke.planeZ);
    if (!worldPoint) return;
    worldPoint = this.clampPointToBounds(worldPoint, this.currentStroke.pageBounds || this.getActiveWorldBounds());

    e.preventDefault();
    e.stopPropagation();

    if (this.isShapeTool(this.currentStroke.tool)) {
      this.currentStroke.points[1] = worldPoint;
    } else {
      this.currentStroke.points.push(worldPoint);
    }
    this.redraw();
    this.drawStroke(this.currentStroke);
  }

  onPointerUp(e) {
    if (this.dragSelection && e.pointerId === this.activePointerId) {
      e.preventDefault();
      e.stopPropagation();
      this.dragSelection = null;
      this.activePointerId = null;
      this.saveNow(false);
      this.redraw();
      this.syncPropertiesFromSelected();
      return;
    }

    if (!this.currentStroke || e.pointerId !== this.activePointerId) return;

    e.preventDefault();
    e.stopPropagation();

    if (this.currentStroke.points.length > 1) {
      this.strokes.push(this.currentStroke);
      this.saveNow(false);
    }
    this.currentStroke = null;
    this.activePointerId = null;
    this.redraw();
  }

  handleSelectDown(worldPoint, clientX, clientY, pointerId) {
    const hit = this.findItemAtClient(clientX, clientY);
    this.selectedIndex = hit ? hit.index : -1;
    this.dragSelection = null;

    if (hit) {
      this.activePointerId = pointerId;
      this.dragSelection = {
        index: hit.index,
        startWorld: { ...worldPoint },
        originalPoints: (hit.item.points || []).map((pt) => ({ ...pt })),
        originalItem: this.cloneItem(hit.item),
      };
      this.updateStatus("تم تحديد عنصر. اسحبه للتحريك أو اضغط Delete للحذف.");
    } else {
      this.updateStatus("لا يوجد عنصر في هذا المكان للتحديد.");
    }
    this.redraw();
    this.syncPropertiesFromSelected();
  }

  handleSelectMove(e) {
    const drag = this.dragSelection;
    const item = this.strokes[drag.index];
    if (!item) return;

    const planeZ = item.planeZ ?? drag.startWorld.z ?? this.getDrawingPlaneZ();
    const worldPoint = this.clientToWorld(e.clientX, e.clientY, planeZ);
    if (!worldPoint) return;

    e.preventDefault();
    e.stopPropagation();

    let dx = worldPoint.x - drag.startWorld.x;
    let dy = worldPoint.y - drag.startWorld.y;
    const dz = (worldPoint.z || 0) - (drag.startWorld.z || 0);
    ({ dx, dy } = this.clampDeltaToBounds(drag.originalPoints, dx, dy, item.pageBounds || this.getActiveWorldBounds()));
    item.points = drag.originalPoints.map((pt) => ({
      x: pt.x + dx,
      y: pt.y + dy,
      z: Number.isFinite(pt.z) ? pt.z + dz : planeZ,
    }));
    this.redraw();
  }

  findItemAtClient(clientX, clientY) {
    const click = this.clientToCanvasPoint(clientX, clientY);
    if (!click) return null;

    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const item = this.strokes[i];
      if (!item) continue;
      if (this.hitTestItem(item, click)) return { index: i, item };
    }
    return null;
  }

  hitTestItem(item, click) {
    if (item.tool === "text" || item.kind === "text") return !!this.findTextHit(item, click);
    if (!item.points || item.points.length < 1) return false;
    if (item.coordSpace !== "world") return false;

    const pts = item.points.map((pt) => this.worldToCanvas(pt)).filter(Boolean);
    if (pts.length < 1) return false;

    const pad = Math.max(10, (item.screenSize || item.size || 3) + 8) * (window.devicePixelRatio || 1);

    if (this.isShapeTool(item.tool)) {
      return this.hitTestShape(item, pts, click, pad);
    }

    for (let j = 1; j < pts.length; j++) {
      if (this.pointToSegmentDistance(click, pts[j - 1], pts[j]) <= pad) return true;
    }
    if (pts.length === 1) {
      const d = Math.hypot(click.x - pts[0].x, click.y - pts[0].y);
      return d <= pad;
    }
    return false;
  }

  findTextHit(item, click) {
    const box = this.getTextCanvasBox(item);
    if (!box) return null;
    const pad = 8 * (window.devicePixelRatio || 1);
    const inside =
      click.x >= box.x - pad &&
      click.x <= box.x + box.w + pad &&
      click.y >= box.y - box.h - pad &&
      click.y <= box.y + pad;
    return inside ? box : null;
  }

  hitTestShape(item, pts, click, pad) {
    const a = pts[0];
    const b = pts[pts.length - 1] || pts[0];
    if (!a || !b) return false;

    if (item.tool === "line") {
      return this.pointToSegmentDistance(click, a, b) <= pad;
    }

    let x = a.x;
    let y = a.y;
    let w = b.x - a.x;
    let h = b.y - a.y;

    if (item.tool === "square" || item.tool === "circle") {
      const size = Math.min(Math.abs(w), Math.abs(h));
      w = Math.sign(w || 1) * size;
      h = Math.sign(h || 1) * size;
    }

    const left = Math.min(x, x + w);
    const right = Math.max(x, x + w);
    const top = Math.min(y, y + h);
    const bottom = Math.max(y, y + h);

    if (item.tool === "rectangle" || item.tool === "square") {
      const nearBox = click.x >= left - pad && click.x <= right + pad && click.y >= top - pad && click.y <= bottom + pad;
      if (!nearBox) return false;
      const nearEdge =
        Math.abs(click.x - left) <= pad ||
        Math.abs(click.x - right) <= pad ||
        Math.abs(click.y - top) <= pad ||
        Math.abs(click.y - bottom) <= pad;
      const inside = click.x >= left && click.x <= right && click.y >= top && click.y <= bottom;
      return nearEdge || inside;
    }

    if (item.tool === "ellipse" || item.tool === "circle") {
      const cx = x + w / 2;
      const cy = y + h / 2;
      const rx = Math.max(1, Math.abs(w / 2));
      const ry = Math.max(1, Math.abs(h / 2));
      const nx = (click.x - cx) / rx;
      const ny = (click.y - cy) / ry;
      const value = nx * nx + ny * ny;
      const edgeTolerance = pad / Math.max(rx, ry);
      return value <= 1 + edgeTolerance;
    }

    return false;
  }

  pointToSegmentDistance(p, a, b) {
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const wx = p.x - a.x;
    const wy = p.y - a.y;
    const c1 = vx * wx + vy * wy;
    if (c1 <= 0) return Math.hypot(p.x - a.x, p.y - a.y);
    const c2 = vx * vx + vy * vy;
    if (c2 <= c1) return Math.hypot(p.x - b.x, p.y - b.y);
    const t = c1 / c2;
    const px = a.x + t * vx;
    const py = a.y + t * vy;
    return Math.hypot(p.x - px, p.y - py);
  }

  cloneItem(item) {
    return JSON.parse(JSON.stringify(item));
  }

  deleteSelected() {
    if (this.selectedIndex < 0 || !this.strokes[this.selectedIndex]) {
      this.updateStatus("لا يوجد عنصر محدد للحذف.");
      return;
    }
    this.strokes.splice(this.selectedIndex, 1);
    this.selectedIndex = -1;
    this.dragSelection = null;
    this.saveNow(false);
    this.redraw();
    this.syncPropertiesFromSelected();
  }

  copySelected() {
    if (this.selectedIndex < 0 || !this.strokes[this.selectedIndex]) return;
    this.clipboardItem = this.cloneItem(this.strokes[this.selectedIndex]);
    this.updateStatus("تم نسخ العنصر المحدد.");
  }

  pasteSelected() {
    if (!this.clipboardItem) return;
    const item = this.cloneItem(this.clipboardItem);
    const offset = this.getPasteWorldOffset(item);
    if (Array.isArray(item.points)) {
      item.points = item.points.map((pt) => ({
        ...pt,
        x: pt.x + offset,
        y: pt.y - offset,
      }));
    }
    this.strokes.push(item);
    this.selectedIndex = this.strokes.length - 1;
    this.saveNow(false);
    this.redraw();
    this.syncPropertiesFromSelected();
  }

  getSelectedItem() {
    if (this.selectedIndex < 0) return null;
    return this.strokes[this.selectedIndex] || null;
  }

  syncPropertiesFromSelected() {
    if (!this.propertiesPanel) return;
    const item = this.getSelectedItem();
    if (!item) {
      this.propertiesPanel.style.display = "none";
      return;
    }

    this.propertiesPanel.style.display = "flex";
    const isText = item.tool === "text" || item.kind === "text";
    if (this.propTitle) this.propTitle.textContent = isText ? "خصائص النص" : (this.isShapeTool(item.tool) ? "خصائص الشكل" : "خصائص الرسم");
    if (this.propColorInput) this.propColorInput.value = this.colorToHex(item.color || this.color || "#ff3333");
    if (this.propSizeInput) {
      this.propSizeInput.disabled = isText;
      this.propSizeInput.style.opacity = isText ? "0.35" : "1";
      this.propSizeInput.value = String(Math.max(1, Math.min(60, Math.round(item.screenSize || item.size || this.size || 3))));
    }
    if (this.propOpacityInput) this.propOpacityInput.value = String(Math.max(0.05, Math.min(1, Number(item.opacity ?? 1))));
    if (this.propFontSizeInput) {
      this.propFontSizeInput.disabled = !isText;
      this.propFontSizeInput.style.opacity = isText ? "1" : "0.35";
      this.propFontSizeInput.value = String(Math.max(8, Math.min(160, Math.round(item.fontSize || this.fontSize || 22))));
    }
  }

  updateSelectedColor(color) {
    const item = this.getSelectedItem();
    if (!item) return;
    item.color = color;
    this.saveNow(false);
    this.redraw();
  }

  updateSelectedOpacity(opacity) {
    const item = this.getSelectedItem();
    if (!item) return;
    item.opacity = Math.max(0.05, Math.min(1, Number(opacity) || 1));
    this.saveNow(false);
    this.redraw();
  }

  updateSelectedSize(screenSize) {
    const item = this.getSelectedItem();
    if (!item || item.tool === "text" || item.kind === "text") return;
    const nextSize = Math.max(1, Math.min(60, Number(screenSize) || 3));
    const oldSize = Math.max(1, Number(item.screenSize || item.size || this.size || 3));
    item.screenSize = nextSize;
    item.size = nextSize;
    if (Number.isFinite(item.worldSize) && item.worldSize > 0) {
      item.worldSize = item.worldSize * (nextSize / oldSize);
    } else if (item.points?.[0]) {
      item.worldSize = this.estimateWorldSizeFromScreenSize(nextSize, item.points[0]) || item.worldSize;
    }
    this.saveNow(false);
    this.redraw();
  }

  updateSelectedFontSize(fontSize) {
    const item = this.getSelectedItem();
    if (!item || (item.tool !== "text" && item.kind !== "text")) return;
    const nextSize = Math.max(8, Math.min(160, Number(fontSize) || 22));
    const oldSize = Math.max(8, Number(item.fontSize || this.fontSize || 22));
    item.fontSize = nextSize;
    if (Number.isFinite(item.worldFontSize) && item.worldFontSize > 0) {
      item.worldFontSize = item.worldFontSize * (nextSize / oldSize);
    } else if (item.points?.[0]) {
      item.worldFontSize = this.estimateWorldSizeFromScreenSize(nextSize, item.points[0]) || item.worldFontSize;
    }
    this.saveNow(false);
    this.redraw();
  }

  estimateWorldSizeFromScreenSize(screenSize, point) {
    const p = this.worldToCanvas(point);
    if (!p) return null;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const clientX = rect.left + p.x / dpr;
    const clientY = rect.top + p.y / dpr;
    return this.pixelSizeToWorldSize(screenSize, clientX, clientY, point.z ?? this.getDrawingPlaneZ());
  }

  colorToHex(color) {
    const value = String(color || "").trim();
    if (/^#[0-9a-f]{6}$/i.test(value)) return value;
    if (/^#[0-9a-f]{3}$/i.test(value)) {
      const r = value[1], g = value[2], b = value[3];
      return `#${r}${r}${g}${g}${b}${b}`;
    }
    const m = value.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (m) {
      const toHex = (n) => Math.max(0, Math.min(255, Number(n) || 0)).toString(16).padStart(2, "0");
      return `#${toHex(m[1])}${toHex(m[2])}${toHex(m[3])}`;
    }
    return "#ff3333";
  }

  getPasteWorldOffset(item) {
    const first = item?.points?.[0] || { x: 0, y: 0, z: this.getDrawingPlaneZ() };
    const p2 = this.clientToWorld(40, 40, first.z ?? this.getDrawingPlaneZ());
    const p3 = this.clientToWorld(0, 0, first.z ?? this.getDrawingPlaneZ());
    if (!p2 || !p3) return 10;
    const d = Math.abs(p2.x - p3.x) || Math.abs(p2.y - p3.y) || 10;
    return d;
  }

  onKeyDown(e) {
    if (!this.enabled) return;
    if (this.isUiTarget(e.target)) return;
    if (["INPUT", "TEXTAREA"].includes((e.target?.tagName || "").toUpperCase())) return;

    if (e.key === "Delete" || e.key === "Backspace") {
      if (this.selectedIndex >= 0) {
        e.preventDefault();
        this.deleteSelected();
      }
      return;
    }

    const key = String(e.key || "").toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === "c") {
      if (this.selectedIndex >= 0) {
        e.preventDefault();
        this.copySelected();
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && key === "v") {
      if (this.clipboardItem) {
        e.preventDefault();
        this.pasteSelected();
      }
    }
  }

  handleTextClick(worldPoint, clientX, clientY) {
    if (!this.isInsideBounds(worldPoint)) {
      this.updateStatus("النص داخل حدود الملف فقط.");
      return;
    }
    const hit = this.findTextAtClient(clientX, clientY);
    const currentText = hit?.text || "";
    const label = hit ? "تعديل النص:" : "اكتب النص:";
    const nextText = prompt(label, currentText);

    if (nextText === null) return;

    const cleanText = String(nextText).trim();
    if (hit) {
      if (!cleanText) {
        this.strokes.splice(hit.index, 1);
      } else {
        hit.item.text = cleanText;
        hit.item.color = this.color;
        hit.item.opacity = this.opacity;
        hit.item.fontSize = this.fontSize;
        hit.item.worldFontSize = this.pixelSizeToWorldSize(this.fontSize, clientX, clientY, worldPoint.z);
      }
      this.saveNow(false);
      this.redraw();
      this.syncPropertiesFromSelected();
      return;
    }

    if (!cleanText) return;

    this.strokes.push({
      version: 7,
      coordSpace: "world",
      kind: "text",
      tool: "text",
      text: cleanText,
      color: this.color,
      opacity: this.opacity,
      fontSize: this.fontSize,
      worldFontSize: this.pixelSizeToWorldSize(this.fontSize, clientX, clientY, worldPoint.z),
      planeZ: worldPoint.z,
      pageBounds: this.getActiveWorldBounds(),
      layerName: this.annotationLayerName,
      points: [worldPoint],
    });
    this.saveNow(false);
    this.redraw();
  }

  findTextAtClient(clientX, clientY) {
    const click = this.clientToCanvasPoint(clientX, clientY);
    if (!click) return null;

    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const item = this.strokes[i];
      if (item?.tool !== "text" && item?.kind !== "text") continue;
      const box = this.getTextCanvasBox(item);
      if (!box) continue;
      const pad = 8 * (window.devicePixelRatio || 1);
      const inside =
        click.x >= box.x - pad &&
        click.x <= box.x + box.w + pad &&
        click.y >= box.y - box.h - pad &&
        click.y <= box.y + pad;
      if (inside) return { index: i, item, text: item.text || "" };
    }
    return null;
  }

  clientToCanvasPoint(clientX, clientY) {
    if (!this.canvas) return null;
    const rect = this.canvas.getBoundingClientRect();
    const sx = this.canvas.width / Math.max(1, rect.width);
    const sy = this.canvas.height / Math.max(1, rect.height);
    return {
      x: (clientX - rect.left) * sx,
      y: (clientY - rect.top) * sy,
    };
  }

  isAcceptedDrawingInput(e) {
    const type = e.pointerType || "mouse";
    if (type === "pen" || type === "mouse") return true;
    if (type === "touch") return this.allowTouchDrawing;
    return false;
  }

  toggleTouchDrawing() {
    this.allowTouchDrawing = !this.allowTouchDrawing;
    localStorage.setItem("essam-cad-drawing-allow-touch", this.allowTouchDrawing ? "1" : "0");
    this.updateTouchButton();
    this.updateStatus(this.allowTouchDrawing ? "اللمس يرسم الآن" : "اللمس للتحريك فقط - القلم يرسم");
  }

  updateTouchButton() {
    if (!this.touchBtn) return;
    this.touchBtn.textContent = this.allowTouchDrawing ? "👆 لمس: رسم" : "✋ لمس: تحريك";
    this.touchBtn.style.background = this.allowTouchDrawing ? "rgba(0,160,255,0.55)" : "rgba(255,255,255,0.12)";
  }

  isToolbarTarget(target) {
    return !!(
      target &&
      ((this.toolbar && this.toolbar.contains(target)) ||
        (this.propertiesPanel && this.propertiesPanel.contains(target)))
    );
  }

  getEffectiveScreenSize() {
    if (this.tool === "highlighter") return Math.max(this.size * 3, 12);
    if (this.tool === "eraser") return Math.max(this.size * 2, 12);
    return this.size;
  }

  getViewer() {
    return window.cadApp?.viewer || null;
  }

  getViewerContainer() {
    return document.getElementById(window.cadApp?.containerId || "myCanvas") || null;
  }

  getCamera() {
    return this.getViewer()?.camera || null;
  }

  getViewerRect() {
    const el = this.getViewerContainer();
    return (el || this.canvas).getBoundingClientRect();
  }

  isUiTarget(target) {
    if (!target) return false;
    if (this.isToolbarTarget(target)) return true;
    const tag = String(target.tagName || "").toUpperCase();
    if (["BUTTON", "INPUT", "SELECT", "TEXTAREA", "LABEL", "A", "SUMMARY"].includes(tag)) return true;
    const closest = target.closest?.("#cad-fab, #cad-fab-menu, #layer-rules-panel, #pdf-pager, .xviewer-toolbar, .xviewer-bottom-bar, [role='dialog'], [data-ui='menu'], [data-ui='panel']");
    if (closest) return true;
    const host = this.getViewerContainer();
    if (host && !host.contains(target) && target !== this.canvas) return true;
    return false;
  }

  getSceneWorldBounds() {
    try {
      const scene = this.getViewer()?.sceneManager?.scene || this.getViewer()?.scene || null;
      if (!scene) return null;
      scene.updateMatrixWorld?.(true);
      const box = new THREE.Box3();
      let found = false;
      scene.traverse?.((obj) => {
        if (!obj || obj.visible === false) return;
        if (!(obj.isLine || obj.isLineSegments || obj.isLineLoop || obj.isMesh)) return;
        const geo = obj.geometry;
        if (!geo) return;
        if (!geo.boundingBox && geo.computeBoundingBox) geo.computeBoundingBox();
        if (!geo.boundingBox) return;
        const gbox = geo.boundingBox.clone().applyMatrix4(obj.matrixWorld);
        if (![gbox.min.x, gbox.min.y, gbox.max.x, gbox.max.y].every(Number.isFinite)) return;
        box.union(gbox);
        found = true;
      });
      if (!found) return null;
      return {
        minX: box.min.x,
        minY: box.min.y,
        maxX: box.max.x,
        maxY: box.max.y,
        width: Math.max(0.000001, box.max.x - box.min.x),
        height: Math.max(0.000001, box.max.y - box.min.y),
      };
    } catch (_) {
      return null;
    }
  }

  getActiveWorldBounds() {
    return this.getPageWorldBounds() || this.getSceneWorldBounds() || null;
  }

  isInsideBounds(point, bounds = this.getActiveWorldBounds(), tolerance = 0) {
    if (!point || !bounds) return true;
    return point.x >= bounds.minX - tolerance && point.x <= bounds.maxX + tolerance && point.y >= bounds.minY - tolerance && point.y <= bounds.maxY + tolerance;
  }

  clampPointToBounds(point, bounds = this.getActiveWorldBounds()) {
    if (!point || !bounds) return point;
    return {
      ...point,
      x: Math.max(bounds.minX, Math.min(bounds.maxX, point.x)),
      y: Math.max(bounds.minY, Math.min(bounds.maxY, point.y)),
    };
  }

  getBoundsCanvasPolygon(bounds = this.getActiveWorldBounds()) {
    if (!bounds) return null;
    const corners = [
      { x: bounds.minX, y: bounds.minY, z: this.getDrawingPlaneZ() },
      { x: bounds.maxX, y: bounds.minY, z: this.getDrawingPlaneZ() },
      { x: bounds.maxX, y: bounds.maxY, z: this.getDrawingPlaneZ() },
      { x: bounds.minX, y: bounds.maxY, z: this.getDrawingPlaneZ() },
    ].map((p) => this.worldToCanvas(p));
    if (corners.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
    return corners;
  }

  pushDrawingClip(ctx) {
    const poly = this.getBoundsCanvasPolygon();
    if (!poly || !ctx) return false;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
    ctx.closePath();
    ctx.clip();
    return true;
  }

  clampDeltaToBounds(points, dx, dy, bounds = this.getActiveWorldBounds()) {
    if (!bounds || !Array.isArray(points) || !points.length) return { dx, dy };
    const xs = points.map((p) => p.x).filter(Number.isFinite);
    const ys = points.map((p) => p.y).filter(Number.isFinite);
    if (!xs.length || !ys.length) return { dx, dy };
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    if (minX + dx < bounds.minX) dx += bounds.minX - (minX + dx);
    if (maxX + dx > bounds.maxX) dx -= (maxX + dx) - bounds.maxX;
    if (minY + dy < bounds.minY) dy += bounds.minY - (minY + dy);
    if (maxY + dy > bounds.maxY) dy -= (maxY + dy) - bounds.maxY;
    return { dx, dy };
  }

  clientToNdc(clientX, clientY) {
    const rect = this.getViewerRect();
    return new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1)
    );
  }

  getDrawingPlaneZ() {
    try {
      const box = window.cadApp?._pdfPlugin?.getPdfViewport?.();
      if (box?.getCenter) {
        const center = new THREE.Vector3();
        box.getCenter(center);
        if (Number.isFinite(center.z)) return center.z;
      }
    } catch (_) {}
    return 0;
  }

  clientToWorld(clientX, clientY, planeZ = this.getDrawingPlaneZ()) {
    const cam = this.getCamera();
    if (!cam) return null;

    try {
      cam.updateMatrixWorld?.(true);
      cam.updateProjectionMatrix?.();

      const ndc = this.clientToNdc(clientX, clientY);
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, cam);

      const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -planeZ);
      const out = new THREE.Vector3();
      const hit = raycaster.ray.intersectPlane(plane, out);
      if (!hit) return null;

      return {
        x: out.x,
        y: out.y,
        z: Number.isFinite(out.z) ? out.z : planeZ,
      };
    } catch (_) {
      return null;
    }
  }

  worldToCanvas(point) {
    const cam = this.getCamera();
    if (!cam || !point) return null;

    try {
      cam.updateMatrixWorld?.(true);
      cam.updateProjectionMatrix?.();

      const v = new THREE.Vector3(point.x, point.y, Number.isFinite(point.z) ? point.z : this.getDrawingPlaneZ());
      v.project(cam);
      if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) return null;

      return {
        x: ((v.x + 1) / 2) * this.canvas.width,
        y: ((-v.y + 1) / 2) * this.canvas.height,
        visible: v.z >= -1.2 && v.z <= 1.2,
      };
    } catch (_) {
      return null;
    }
  }

  pixelSizeToWorldSize(pixelSize, clientX, clientY, planeZ = this.getDrawingPlaneZ()) {
    const p1 = this.clientToWorld(clientX, clientY, planeZ);
    const p2 = this.clientToWorld(clientX + pixelSize, clientY, planeZ);
    if (!p1 || !p2) return null;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dz = (p2.z || 0) - (p1.z || 0);
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return Number.isFinite(d) && d > 0 ? d : null;
  }

  worldSizeToPixelSize(worldSize, refPoint, fallback = 3) {
    if (!worldSize || !refPoint) return fallback;
    const p1 = this.worldToCanvas(refPoint);
    const p2 = this.worldToCanvas({ x: refPoint.x + worldSize, y: refPoint.y, z: refPoint.z });
    if (!p1 || !p2) return fallback;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const px = Math.sqrt(dx * dx + dy * dy);
    if (!Number.isFinite(px) || px <= 0) return fallback;
    return Math.max(1, Math.min(240, px));
  }

  resizeCanvas(keepDrawings = true) {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const nextW = Math.max(1, Math.round(rect.width * dpr));
    const nextH = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width === nextW && this.canvas.height === nextH) return;

    this.canvas.width = nextW;
    this.canvas.height = nextH;
    if (keepDrawings) this.redraw();
  }

  drawStroke(stroke) {
    if (!stroke || !stroke.points) return;

    if (stroke.tool === "text" || stroke.kind === "text") {
      this.drawTextItem(stroke);
      return;
    }

    if (stroke.points.length < 2) return;

    // Old v1/v2 strokes were saved in fixed screen coordinates.
    // They are still displayed, but only new v3/v4 strokes follow zoom/pan correctly.
    if (stroke.coordSpace !== "world") {
      this.drawLegacyScreenStroke(stroke);
      return;
    }

    const ctx = this.ctx;
    const screenPoints = stroke.points.map((p) => this.worldToCanvas(p)).filter(Boolean);
    if (screenPoints.length < 2) return;

    const refPoint = stroke.points[0];
    const fallbackSize = stroke.screenSize || stroke.size || 3;
    const lineWidth = this.worldSizeToPixelSize(stroke.worldSize, refPoint, fallbackSize);

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
    ctx.globalAlpha = Math.max(0.05, Math.min(1, Number(stroke.opacity ?? 1)));
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = lineWidth;

    if (this.isShapeTool(stroke.tool)) {
      this.drawShapePath(stroke, screenPoints);
    } else {
      ctx.beginPath();
      ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
      for (let i = 1; i < screenPoints.length; i++) {
        const p = screenPoints[i];
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  drawTextItem(item) {
    if (!item || !item.points || !item.points[0]) return;
    const p = this.worldToCanvas(item.points[0]);
    if (!p) return;

    const ctx = this.ctx;
    const pxSize = this.worldSizeToPixelSize(item.worldFontSize, item.points[0], item.fontSize || 22);

    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = Math.max(0.05, Math.min(1, Number(item.opacity ?? 1)));
    ctx.fillStyle = item.color || "#ff3333";
    ctx.font = `${Math.max(8, Math.round(pxSize))}px Arial, sans-serif`;
    ctx.textBaseline = "alphabetic";

    const lines = String(item.text || "").split(/\r?\n/);
    const lineHeight = Math.max(10, pxSize * 1.25);
    lines.forEach((line, index) => {
      ctx.fillText(line, p.x, p.y + index * lineHeight);
    });
    ctx.restore();
  }

  getTextCanvasBox(item) {
    if (!item || !item.points || !item.points[0]) return null;
    const p = this.worldToCanvas(item.points[0]);
    if (!p) return null;

    const ctx = this.ctx;
    const pxSize = this.worldSizeToPixelSize(item.worldFontSize, item.points[0], item.fontSize || 22);
    const lines = String(item.text || "").split(/\r?\n/);

    ctx.save();
    ctx.font = `${Math.max(8, Math.round(pxSize))}px Arial, sans-serif`;
    const width = Math.max(1, ...lines.map((line) => ctx.measureText(line).width));
    ctx.restore();

    const lineHeight = Math.max(10, pxSize * 1.25);
    return {
      x: p.x,
      y: p.y,
      w: width,
      h: lineHeight * lines.length,
    };
  }

  drawShapePath(stroke, screenPoints) {
    const ctx = this.ctx;
    const a = screenPoints[0];
    const b = screenPoints[screenPoints.length - 1];
    if (!a || !b) return;

    let x = a.x;
    let y = a.y;
    let w = b.x - a.x;
    let h = b.y - a.y;

    if (stroke.tool === "line") {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      return;
    }

    if (stroke.tool === "square" || stroke.tool === "circle") {
      const size = Math.min(Math.abs(w), Math.abs(h));
      w = Math.sign(w || 1) * size;
      h = Math.sign(h || 1) * size;
    }

    if (stroke.tool === "rectangle" || stroke.tool === "square") {
      ctx.strokeRect(x, y, w, h);
      return;
    }

    if (stroke.tool === "ellipse" || stroke.tool === "circle") {
      const cx = x + w / 2;
      const cy = y + h / 2;
      const rx = Math.max(1, Math.abs(w / 2));
      const ry = Math.max(1, Math.abs(h / 2));
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  drawLegacyScreenStroke(stroke) {
    const ctx = this.ctx;
    const scaleX = this.canvas.width / (stroke.canvasW || this.canvas.width);
    const scaleY = this.canvas.height / (stroke.canvasH || this.canvas.height);

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
    ctx.globalAlpha = Math.max(0.05, Math.min(1, Number(stroke.opacity ?? 1)));
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = Math.max(1, (stroke.size || 3) * ((scaleX + scaleY) / 2));

    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x * scaleX, stroke.points[0].y * scaleY);
    for (let i = 1; i < stroke.points.length; i++) {
      const p = stroke.points[i];
      ctx.lineTo(p.x * scaleX, p.y * scaleY);
    }
    ctx.stroke();
    ctx.restore();
  }

  redraw() {
    this.resizeCanvas(false);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const clipped = this.pushDrawingClip(this.ctx);
    this.strokes.forEach((stroke) => this.drawStroke(stroke));
    this.drawSelectionBox();
    if (clipped) this.ctx.restore();
  }

  drawSelectionBox() {
    if (this.selectedIndex < 0 || !this.strokes[this.selectedIndex]) return;
    const box = this.getItemCanvasBox(this.strokes[this.selectedIndex]);
    if (!box) return;

    const ctx = this.ctx;
    const pad = 6 * (window.devicePixelRatio || 1);
    ctx.save();
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = 2 * (window.devicePixelRatio || 1);
    ctx.strokeStyle = "rgba(0,160,255,0.95)";
    ctx.strokeRect(box.x - pad, box.y - pad, box.w + pad * 2, box.h + pad * 2);
    ctx.restore();
  }

  getItemCanvasBox(item) {
    if (!item) return null;
    if (item.tool === "text" || item.kind === "text") {
      const box = this.getTextCanvasBox(item);
      if (!box) return null;
      return { x: box.x, y: box.y - box.h, w: box.w, h: box.h };
    }
    if (!item.points || item.points.length < 1 || item.coordSpace !== "world") return null;

    const pts = item.points.map((pt) => this.worldToCanvas(pt)).filter(Boolean);
    if (!pts.length) return null;

    if (this.isShapeTool(item.tool) && pts.length >= 2) {
      const a = pts[0];
      const b = pts[pts.length - 1];
      let x = a.x;
      let y = a.y;
      let w = b.x - a.x;
      let h = b.y - a.y;
      if (item.tool === "square" || item.tool === "circle") {
        const size = Math.min(Math.abs(w), Math.abs(h));
        w = Math.sign(w || 1) * size;
        h = Math.sign(h || 1) * size;
      }
      return {
        x: Math.min(x, x + w),
        y: Math.min(y, y + h),
        w: Math.abs(w),
        h: Math.abs(h),
      };
    }

    const xs = pts.map((pt) => pt.x);
    const ys = pts.map((pt) => pt.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const pad = Math.max(4, item.screenSize || item.size || 3) * (window.devicePixelRatio || 1);
    return { x: minX - pad, y: minY - pad, w: Math.max(1, maxX - minX + pad * 2), h: Math.max(1, maxY - minY + pad * 2) };
  }

  startViewSyncLoop() {
    const tick = () => {
      const sig = this.getViewSignature();
      if (sig !== this._lastViewSignature) {
        this._lastViewSignature = sig;
        this.redraw();
      }
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  getViewSignature() {
    const cam = this.getCamera();
    const rect = this.getViewerRect();
    if (!cam) return `no-camera|${this.canvas?.width || 0}x${this.canvas?.height || 0}`;

    const p = cam.position || { x: 0, y: 0, z: 0 };
    const r = cam.rotation || { x: 0, y: 0, z: 0 };
    const z = cam.zoom || 1;
    return [
      Math.round(rect.width),
      Math.round(rect.height),
      this.canvas.width,
      this.canvas.height,
      p.x.toFixed(4),
      p.y.toFixed(4),
      p.z.toFixed(4),
      r.x.toFixed(4),
      r.y.toFixed(4),
      r.z.toFixed(4),
      z.toFixed(5),
      window.cadApp?._pdfCurrentPage || 1,
    ].join("|");
  }

  undo() {
    this.strokes.pop();
    this.selectedIndex = -1;
    this.saveNow(false);
    this.redraw();
    this.syncPropertiesFromSelected();
  }

  clearCurrentPage() {
    const ok = confirm("مسح كل الرسم الموجود على الصفحة الحالية؟");
    if (!ok) return;
    this.strokes = [];
    this.selectedIndex = -1;
    this.saveNow(false);
    this.redraw();
    this.syncPropertiesFromSelected();
  }

  saveNow(showAlert = false, key = this.getStorageKey()) {
    if (!key) return;
    localStorage.setItem(key, JSON.stringify({ version: 17, strokes: this.strokes, savedAt: new Date().toISOString() }));
    this.lastStorageKey = key;
    window.dispatchEvent(new CustomEvent("cad:pen-layer-updated"));
    if (showAlert) alert("تم حفظ الرسم على هذا الملف/الصفحة داخل المتصفح.");
  }

  loadCurrentPage() {
    const key = this.getStorageKey();
    this.lastStorageKey = key;
    if (!key) {
      this.strokes = [];
      this.selectedIndex = -1;
      this.syncPropertiesFromSelected();
      this.redraw();
      return;
    }
    try {
      const data = JSON.parse(localStorage.getItem(key) || "{}");
      this.strokes = Array.isArray(data.strokes) ? data.strokes.map((item) => ({
        layerName: item?.layerName || this.annotationLayerName,
        ...item,
      })) : [];
      this.selectedIndex = -1;
    } catch (_) {
      this.strokes = [];
      this.selectedIndex = -1;
    }
    this.syncPropertiesFromSelected();
    this.redraw();
    window.dispatchEvent(new CustomEvent("cad:pen-layer-updated"));
  }

  handleFileOrPageChange() {
    const nextKey = this.getStorageKey();
    if (this.lastStorageKey && this.lastStorageKey !== nextKey) {
      this.saveNow(false, this.lastStorageKey);
    }
    this.resizeCanvas(false);
    this.loadCurrentPage();
    this.updateStatus(this.getStatusText());
  }

  getStatusText() {
    const app = window.cadApp;
    const fileName = app?.uploader?.file?.name || "ملف CAD/PDF";
    const page = app?._pdfCurrentPage || 1;
    const count = app?._pdfPageCount || 0;
    return count > 1 ? `${fileName} - صفحة ${page}/${count}` : fileName;
  }

  getStorageKeyForPage(pageNo, fileName = null) {
    const app = window.cadApp;
    const name = fileName || app?.uploader?.file?.name || "untitled-file";
    const page = Math.max(1, Number(pageNo) || 1);
    return `essam-cad-drawing::${name}::page-${page}`;
  }

  getStorageKey() {
    const app = window.cadApp;
    const page = app?._pdfCurrentPage || 1;
    return this.getStorageKeyForPage(page);
  }

  getCurrentFileInfo() {
    const app = window.cadApp;
    const file = app?.uploader?.file;
    return {
      fileName: file?.name || "untitled-file",
      fileSize: Number(file?.size || 0),
      fileType: file?.type || "",
      pageCount: Math.max(1, Number(app?._pdfPageCount || 1)),
      currentPage: Math.max(1, Number(app?._pdfCurrentPage || 1)),
    };
  }

  collectAllPageAnnotations() {
    this.saveNow(false);
    const info = this.getCurrentFileInfo();
    const pages = [];
    for (let pageNo = 1; pageNo <= info.pageCount; pageNo++) {
      pages.push({ page: pageNo, strokes: this.loadStrokesForPage(pageNo) });
    }
    return { info, pages };
  }

  exportAnnotationsJson() {
    const { info, pages } = this.collectAllPageAnnotations();
    const totalItems = pages.reduce((sum, page) => sum + (Array.isArray(page.strokes) ? page.strokes.length : 0), 0);
    if (!totalItems) {
      alert("لا يوجد تعليقات أو رسومات لحفظها.");
      return;
    }

    const payload = {
      type: "essam-cad-annotations",
      version: 17,
      app: "Essam-CAD-PDF-3D-VR",
      exportedAt: new Date().toISOString(),
      sourceFile: {
        name: info.fileName,
        size: info.fileSize,
        type: info.fileType,
        pageCount: info.pageCount,
      },
      pages,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeName = String(info.fileName || "cad-file").replace(/.[^.]+$/, "").replace(/[^a-z0-9_\-\u0600-\u06FF]+/gi, "-");
    link.href = url;
    link.download = safeName + "-annotations.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    this.updateStatus(`تم حفظ ملف JSON - ${totalItems} عنصر`);
  }

  importAnnotationsJson() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.style.display = "none";
    input.onchange = async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;

      try {
        const text = await file.text();
        const data = JSON.parse(text);
        this.applyAnnotationsJson(data);
      } catch (err) {
        console.error("Open annotations JSON failed:", err);
        alert("فشل فتح ملف JSON. تأكد أنه ملف تعليقات صحيح.");
      }
    };
    document.body.appendChild(input);
    input.click();
  }

  applyAnnotationsJson(data) {
    if (!data || data.type !== "essam-cad-annotations" || !Array.isArray(data.pages)) {
      alert("ملف JSON غير متوافق مع تعليقات Essam CAD.");
      return;
    }

    const info = this.getCurrentFileInfo();
    const sourceName = data.sourceFile?.name || "غير معروف";
    if (sourceName !== info.fileName) {
      const okDifferent = confirm(`ملف التعليقات معمول على: ${sourceName}\nوالملف المفتوح الآن: ${info.fileName}\nهل تريد تحميل التعليقات على الملف الحالي؟`);
      if (!okDifferent) return;
    }

    const totalItems = data.pages.reduce((sum, page) => sum + (Array.isArray(page.strokes) ? page.strokes.length : 0), 0);
    const okReplace = confirm(`سيتم استبدال تعليقات الملف الحالي بالتعليقات الموجودة في JSON.\nعدد العناصر: ${totalItems}\nهل تريد المتابعة؟`);
    if (!okReplace) return;

    const maxPage = Math.max(info.pageCount, ...data.pages.map((p) => Number(p.page) || 1));
    for (let pageNo = 1; pageNo <= maxPage; pageNo++) {
      const pageData = data.pages.find((p) => Number(p.page) === pageNo);
      const strokes = Array.isArray(pageData?.strokes) ? pageData.strokes : [];
      const key = this.getStorageKeyForPage(pageNo, info.fileName);
      localStorage.setItem(key, JSON.stringify({
        version: 17,
        strokes,
        importedAt: new Date().toISOString(),
        importedFrom: data.sourceFile || null,
      }));
    }

    this.loadCurrentPage();
    window.dispatchEvent(new CustomEvent("cad:pen-layer-updated"));
    this.updateStatus(`تم فتح JSON - ${totalItems} عنصر`);
    alert("تم تحميل التعليقات بنجاح.");
  }

  updateStatus(text) {
    if (this.status) this.status.textContent = text;
  }

  exportPng() {
    this.redraw();
    const link = document.createElement("a");
    link.download = "cad-drawing-page-" + (window.cadApp?._pdfCurrentPage || 1) + ".png";
    link.href = this.canvas.toDataURL("image/png");
    link.click();
  }

  async exportPdf() {
    const app = window.cadApp;
    const file = app?.uploader?.file;

    if (!file || !/\.pdf$/i.test(file.name || "")) {
      alert("Export PDF يعمل مع ملفات PDF فقط. افتح ملف PDF أولاً.");
      return;
    }

    if (!window.PDFLib?.PDFDocument) {
      alert("مكتبة PDF-Lib غير محملة. تأكد من وجود اتصال إنترنت أو أضف pdf-lib محلياً.");
      return;
    }

    const pageCount = app?._pdfPageCount || 1;
    const allPageStrokes = [];
    let totalItems = 0;

    this.saveNow(false);

    for (let pageNo = 1; pageNo <= pageCount; pageNo++) {
      const strokes = this.loadStrokesForPage(pageNo);
      allPageStrokes[pageNo] = strokes;
      totalItems += strokes.length;
    }

    if (!totalItems) {
      alert("لا يوجد رسم أو نصوص لتصديرها على هذا الملف.");
      return;
    }

    this.updateStatus("جاري تصدير PDF...");

    try {
      const bytes = await file.arrayBuffer();
      const PDFDocument = window.PDFLib.PDFDocument;
      const degrees = window.PDFLib.degrees;
      const pdfDoc = await PDFDocument.load(bytes);
      const pages = pdfDoc.getPages();
      const fallbackBounds = this.getPageWorldBounds();

      for (let i = 0; i < pages.length; i++) {
        const pageNo = i + 1;
        const strokes = allPageStrokes[pageNo] || [];
        if (!strokes.length) continue;

        const page = pages[i];
        const pageWidth = page.getWidth();
        const pageHeight = page.getHeight();
        const overlayDataUrl = this.renderPageAnnotationsToPng(strokes, pageWidth, pageHeight, fallbackBounds);
        if (!overlayDataUrl) continue;

        const overlayPng = await pdfDoc.embedPng(overlayDataUrl);
        this.drawOverlayRight90OnPdfPage(page, overlayPng, pageWidth, pageHeight, degrees);
      }

      const outBytes = await pdfDoc.save();
      const blob = new Blob([outBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const safeName = (file.name || "document.pdf").replace(/\.pdf$/i, "");
      link.href = url;
      link.download = safeName + "-marked.pdf";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      this.updateStatus("تم تصدير PDF بنجاح");
    } catch (err) {
      console.error("Export PDF failed:", err);
      alert("فشل تصدير PDF. افتح Console لمعرفة الخطأ.");
      this.updateStatus(this.getStatusText());
    }
  }


  drawOverlayRight90OnPdfPage(page, overlayPng, pageWidth, pageHeight, degrees) {
    if (!degrees) {
      page.drawImage(overlayPng, { x: 0, y: 0, width: pageWidth, height: pageHeight });
      return;
    }

    page.drawImage(overlayPng, {
      x: 0,
      y: pageHeight,
      width: pageHeight,
      height: pageWidth,
      rotate: degrees(-90),
    });
  }

  loadStrokesForPage(pageNo) {
    const key = this.getStorageKeyForPage(pageNo);
    try {
      const data = JSON.parse(localStorage.getItem(key) || "{}");
      return Array.isArray(data.strokes) ? data.strokes : [];
    } catch (_) {
      return [];
    }
  }

  getPageWorldBounds() {
    try {
      const box = window.cadApp?._pdfPlugin?.getPdfViewport?.();
      if (box?.min && box?.max) {
        return {
          minX: box.min.x,
          minY: box.min.y,
          maxX: box.max.x,
          maxY: box.max.y,
          width: Math.max(0.000001, box.max.x - box.min.x),
          height: Math.max(0.000001, box.max.y - box.min.y),
        };
      }
    } catch (_) {}
    return null;
  }

  getExportBoundsForStrokes(strokes, fallbackBounds) {
    const firstWithBounds = strokes.find((item) => item?.pageBounds?.width && item?.pageBounds?.height);
    if (firstWithBounds?.pageBounds) return firstWithBounds.pageBounds;
    if (fallbackBounds) return fallbackBounds;

    const points = strokes.flatMap((item) => Array.isArray(item?.points) ? item.points : []);
    if (!points.length) return null;
    const xs = points.map((p) => p.x).filter(Number.isFinite);
    const ys = points.map((p) => p.y).filter(Number.isFinite);
    if (!xs.length || !ys.length) return null;
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const padX = Math.max((maxX - minX) * 0.08, 1);
    const padY = Math.max((maxY - minY) * 0.08, 1);
    return {
      minX: minX - padX,
      minY: minY - padY,
      maxX: maxX + padX,
      maxY: maxY + padY,
      width: Math.max(0.000001, maxX - minX + padX * 2),
      height: Math.max(0.000001, maxY - minY + padY * 2),
    };
  }

  renderPageAnnotationsToPng(strokes, pageWidth, pageHeight, fallbackBounds) {
    const bounds = this.getExportBoundsForStrokes(strokes, fallbackBounds);
    if (!bounds) return null;

    const scale = Math.max(1, Math.min(3, window.devicePixelRatio || 2));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(pageWidth * scale));
    canvas.height = Math.max(1, Math.round(pageHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const toCanvas = (pt) => ({
      x: ((pt.x - bounds.minX) / bounds.width) * canvas.width,
      y: ((bounds.maxY - pt.y) / bounds.height) * canvas.height,
    });

    const worldToPx = (worldSize, fallback = 3) => {
      if (!worldSize || !Number.isFinite(worldSize)) return Math.max(1, fallback * scale);
      const px = Math.abs(worldSize / bounds.width) * canvas.width;
      return Math.max(1, Math.min(400, px));
    };

    const drawShape = (item, pts) => {
      const a = pts[0];
      const b = pts[pts.length - 1];
      if (!a || !b) return;

      let x = a.x;
      let y = a.y;
      let w = b.x - a.x;
      let h = b.y - a.y;

      if (item.tool === "line") {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        return;
      }

      if (item.tool === "square" || item.tool === "circle") {
        const size = Math.min(Math.abs(w), Math.abs(h));
        w = Math.sign(w || 1) * size;
        h = Math.sign(h || 1) * size;
      }

      if (item.tool === "rectangle" || item.tool === "square") {
        ctx.strokeRect(x, y, w, h);
        return;
      }

      if (item.tool === "ellipse" || item.tool === "circle") {
        const cx = x + w / 2;
        const cy = y + h / 2;
        const rx = Math.max(1, Math.abs(w / 2));
        const ry = Math.max(1, Math.abs(h / 2));
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    };

    for (const item of strokes) {
      if (!item || !Array.isArray(item.points) || !item.points.length) continue;
      if (item.coordSpace !== "world") continue;

      const pts = item.points.map(toCanvas);
      const color = item.color || "#ff3333";
      const lineWidth = worldToPx(item.worldSize, item.screenSize || item.size || 3);

      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalCompositeOperation = item.tool === "eraser" ? "destination-out" : "source-over";
      ctx.globalAlpha = Math.max(0.05, Math.min(1, Number(item.opacity ?? 1)));
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = lineWidth;

      if (item.tool === "text" || item.kind === "text") {
        const p = pts[0];
        const pxSize = worldToPx(item.worldFontSize, item.fontSize || 22);
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = Math.max(0.05, Math.min(1, Number(item.opacity ?? 1)));
        ctx.font = Math.max(8, Math.round(pxSize)) + "px Arial, sans-serif";
        ctx.textBaseline = "alphabetic";
        const lines = String(item.text || "").split(/\r?\n/);
        const lineHeight = Math.max(10, pxSize * 1.25);
        lines.forEach((line, index) => ctx.fillText(line, p.x, p.y + index * lineHeight));
      } else if (this.isShapeTool(item.tool)) {
        if (pts.length >= 2) drawShape(item, pts);
      } else {
        if (pts.length < 2) { ctx.restore(); continue; }
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      }
      ctx.restore();
    }

    return canvas.toDataURL("image/png");
  }

  get3DEntities() {
    const entities = [];
    const items = Array.isArray(this.strokes) ? this.strokes : [];
    for (const item of items) {
      const converted = this.itemTo3DEntities(item);
      if (converted?.length) entities.push(...converted);
    }
    return entities;
  }

  itemTo3DEntities(item) {
    if (!item || item.coordSpace !== "world" || !Array.isArray(item.points) || !item.points.length) return [];
    if (item.tool === "eraser" || item.tool === "text" || item.kind === "text") return [];

    const makeEntity = (points, closed = false) => ({
      layer: item.layerName || this.annotationLayerName,
      kind: "LINE",
      points: points.map((pt) => ({ x: Number(pt.x) || 0, y: Number(pt.y) || 0 })),
      closed,
    });

    const pts = item.points.map((pt) => ({ x: Number(pt.x) || 0, y: Number(pt.y) || 0 }));
    if (pts.length < 2) return [];

    if (item.tool === "pen" || item.tool === "highlighter" || item.tool === "line") {
      return [makeEntity(pts, false)];
    }

    const a = pts[0];
    const b = pts[pts.length - 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;

    if (item.tool === "rectangle" || item.tool === "square") {
      let w = dx, h = dy;
      if (item.tool === "square") {
        const s = Math.min(Math.abs(w), Math.abs(h));
        w = Math.sign(w || 1) * s;
        h = Math.sign(h || 1) * s;
      }
      return [makeEntity([
        { x: a.x, y: a.y },
        { x: a.x + w, y: a.y },
        { x: a.x + w, y: a.y + h },
        { x: a.x, y: a.y + h },
        { x: a.x, y: a.y },
      ], true)];
    }

    if (item.tool === "ellipse" || item.tool === "circle") {
      let w = dx, h = dy;
      if (item.tool === "circle") {
        const s = Math.min(Math.abs(w), Math.abs(h));
        w = Math.sign(w || 1) * s;
        h = Math.sign(h || 1) * s;
      }
      const cx = a.x + w / 2;
      const cy = a.y + h / 2;
      const rx = Math.max(1e-6, Math.abs(w / 2));
      const ry = Math.max(1e-6, Math.abs(h / 2));
      const samples = [];
      const segs = 48;
      for (let i = 0; i <= segs; i++) {
        const t = (i / segs) * Math.PI * 2;
        samples.push({ x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry });
      }
      return [makeEntity(samples, true)];
    }

    return [makeEntity(pts, false)];
  }

  hexToRgba(hex, alpha) {
    const value = hex.replace("#", "");
    const r = parseInt(value.substring(0, 2), 16);
    const g = parseInt(value.substring(2, 4), 16);
    const b = parseInt(value.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
}

window.cadDrawingOverlay = new CADDrawingOverlay();
window.cadDrawingOverlay.init();
