import { THREE } from "@x-viewer/core";
import { CADLayerKit } from "../CADLayerKit.js";
import { ScreenSelectionBridge } from "../core/ScreenSelectionBridge.js";
import { EntityRenderBridge } from "../core/EntityRenderBridge.js";
import { css, el } from "./shared/dom.js";
import { panelStyle, headerStyle, titleStyle, subtitleStyle, buttonStyle as themeButtonStyle, inputStyle, infoCardStyle as themeInfoCardStyle, sectionStyle as themeSectionStyle, labelStyle as themeLabelStyle } from "./shared/uiTheme.js";

class CADEntityLayerEditor {
  constructor() {
    this.enabled = false;
    this.visible = false;
    this.panel = null;
    this.modeBtn = null;
    this.selectionInfo = null;
    this.layerSelect = null;
    this.newLayerInput = null;
    this.layerListInfo = null;
    this.restoreBtn = null;
    this.undoBtn = null; // تمت إضافة زر التراجع
    this.selectedEntries = new Map();
    this.highlightCache = new Map();
    this.edits = this.emptyEdits();
    this.pointerDown = null;
    this.dragSelect = null;
    this.selectionBoxEl = null;
    this.fileName = null;
    this.refreshTimer = null;
    this.screenSelectionBridge = null;
    this.entityRenderBridge = null;

    // نظام التراجع
    this.history = [];
    this.MAX_HISTORY = 30;

    this.boundPointerDown = (e) => this.onPointerDown(e);
    this.boundPointerMove = (e) => this.onPointerMove(e);
    this.boundPointerUp = (e) => this.onPointerUp(e);
    this.boundContextMenu = (e) => this.onContextMenu(e);
    this.boundKeyDown = (e) => this.onKeyDown(e);
    this.boundFileLoaded = () => this.onFileLoaded();
    this.boundEntityRegistryReady = () => this.onEntityRegistryReady();

    this.ensurePanel();
    requestAnimationFrame(() => this.refreshLayerOptions());
    window.addEventListener("cad:file-loaded", this.boundFileLoaded);
    window.addEventListener("cad:entity-registry-ready", this.boundEntityRegistryReady);
    window.addEventListener("cad:annotation-layers-updated", () => this.refreshLayerOptions());
  }

  // --- دوال التراجع (Undo System) ---
  captureSnapshot() {
    return {
      schema: "essam-entity-editor-snapshot@2",
      edits: JSON.parse(JSON.stringify(this.edits || this.emptyEdits())),
      registry: this.getRegistry()?.exportState?.() || null,
    };
  }

  saveSnapshot() {
    this.history.push(this.captureSnapshot());
    if (this.history.length > this.MAX_HISTORY) this.history.shift();
    this.updateUndoBtn();
  }

  clearHistory() {
    this.history = [];
    this.updateUndoBtn();
  }

  updateUndoBtn() {
    if (!this.undoBtn) return;
    const enabled = this.history.length > 0;
    this.undoBtn.style.opacity = enabled ? "1" : "0.45";
    this.undoBtn.style.cursor = enabled ? "pointer" : "not-allowed";
    this.undoBtn.disabled = !enabled;
  }

  undo() {
    if (this.history.length === 0) return;
    const lastState = this.history.pop();
    try {
      const snapshot = typeof lastState === "string" ? { edits: JSON.parse(lastState), registry: null } : lastState;
      this.edits = snapshot?.edits || this.emptyEdits();
      if (snapshot?.registry) this.getRegistry()?.restoreState?.(snapshot.registry);
      this.saveEdits();
      this.applyEditsToScene({ fromUndo: true });
    } catch (err) {
      console.warn("[EntityLayerEditor] Undo failed", err);
    }
    this.updateUndoBtn();
    this.clearSelection();
  }
  // ------------------------------------

  emptyEdits() {
    return {
      hiddenIds: [],
      deletedIds: [],
      layerById: {},
      hiddenComponentIds: [],
      deletedComponentIds: [],
      layerByComponentId: {},
    };
  }

  getViewer() { return window.cadApp?.viewer || null; }
  getScene() { return this.getViewer()?.sceneManager?.scene || this.getViewer()?.scene || null; }
  getCamera() { return this.getViewer()?.camera || null; }
  getContainer() { return document.getElementById(window.cadApp?.containerId || "myCanvas") || null; }
  getCurrentFileName() { return window.cadApp?.uploader?.file?.name || this.fileName || "active-file"; }
  getStorageKey(name = null) { return `essam-source-entity-edits-v42::${name || this.getCurrentFileName()}`; }
  getRegistry() { return window.__essamEntityRegistry || null; }
  getLayerManager() { return window.__essamLayerManager || null; }
  getSelectionEngine() { return window.__essamSelectionEngine || null; }

  getScreenSelectionBridge() {
    const registry = this.getRegistry();
    const viewer = this.getViewer();
    if (!registry || !viewer) return null;
    if (!this.screenSelectionBridge) {
      this.screenSelectionBridge = new ScreenSelectionBridge({
        viewer,
        registry,
        selectionEngine: this.getSelectionEngine(),
        container: this.getContainer(),
        renderBridge: this.getEntityRenderBridge(),
      });
      window.__essamScreenSelectionBridge = this.screenSelectionBridge;
    } else {
      this.screenSelectionBridge.setContext({
        viewer,
        registry,
        selectionEngine: this.getSelectionEngine(),
        container: this.getContainer(),
        renderBridge: this.getEntityRenderBridge(),
      });
    }
    return this.screenSelectionBridge;
  }

  getEntityRenderBridge() {
    const registry = this.getRegistry();
    const viewer = this.getViewer();
    if (!registry || !viewer) return null;
    if (!this.entityRenderBridge) {
      this.entityRenderBridge = new EntityRenderBridge({ viewer, registry });
      window.__essamEntityRenderBridge = this.entityRenderBridge;
    } else {
      this.entityRenderBridge.setContext({ viewer, registry });
    }
    return this.entityRenderBridge;
  }

  rebuildManagedEntityRender() {
    const bridge = this.getEntityRenderBridge();
    if (!bridge) return null;
    if (this.enabled) return bridge.rebuild();
    return bridge.getDebugSummary?.() || null;
  }

  onEntityRegistryReady() {
    this.getScreenSelectionBridge()?.syncSelectionHighlights?.();
    const renderBridge = this.getEntityRenderBridge();
    if (this.enabled) renderBridge?.enable?.();
    this.refreshLayerOptions();
    this.updateSelectionInfo();
  }

  ensureSelectionBox() {
    if (this.selectionBoxEl && document.body.contains(this.selectionBoxEl)) return this.selectionBoxEl;
    this.selectionBoxEl = el("div", {
      id: "cad-entity-editor-selection-box",
      style: {
        position: "fixed",
        left: "0px",
        top: "0px",
        width: "0px",
        height: "0px",
        display: "none",
        zIndex: 7003,
        pointerEvents: "none",
        border: "1px dashed #ffd54f",
        background: "rgba(255, 213, 79, 0.16)",
        boxSizing: "border-box"
      }
    });
    document.body.appendChild(this.selectionBoxEl);
    return this.selectionBoxEl;
  }

  showSelectionBox(rect) {
    const box = this.ensureSelectionBox();
    box.style.display = "block";
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.top}px`;
    box.style.width = `${Math.max(1, rect.width)}px`;
    box.style.height = `${Math.max(1, rect.height)}px`;
  }

  hideSelectionBox() {
    if (!this.selectionBoxEl) return;
    this.selectionBoxEl.style.display = "none";
    this.selectionBoxEl.style.width = "0px";
    this.selectionBoxEl.style.height = "0px";
  }

  rectFromPoints(x0, y0, x1, y1) {
    const left = Math.min(x0, x1);
    const top = Math.min(y0, y1);
    const right = Math.max(x0, x1);
    const bottom = Math.max(y0, y1);
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  loadEdits(name = null) {
    try {
      const raw = localStorage.getItem(this.getStorageKey(name));
      const data = raw ? JSON.parse(raw) : null;
      this.edits = {
        hiddenIds: Array.isArray(data?.hiddenIds) ? data.hiddenIds : [],
        deletedIds: Array.isArray(data?.deletedIds) ? data.deletedIds : [],
        layerById: data?.layerById && typeof data.layerById === "object" ? data.layerById : {},
        hiddenComponentIds: Array.isArray(data?.hiddenComponentIds) ? data.hiddenComponentIds : [],
        deletedComponentIds: Array.isArray(data?.deletedComponentIds) ? data.deletedComponentIds : [],
        layerByComponentId: data?.layerByComponentId && typeof data.layerByComponentId === "object" ? data.layerByComponentId : {},
      };
    } catch (_) {
      this.edits = this.emptyEdits();
    }
    // مسح الذاكرة عند تحميل ملف جديد
    this.history = [];
    this.updateUndoBtn();
    this.updateRestoreInfo();
    return this.edits;
  }

  saveEdits(name = null) {
    try {
      localStorage.setItem(this.getStorageKey(name), JSON.stringify(this.edits));
    } catch (_) {}
    this.updateRestoreInfo();
  }

  ensurePanel() {
    if (document.getElementById("cad-entity-editor-panel")) {
      this.panel = document.getElementById("cad-entity-editor-panel");
      return;
    }

    const title = el("div", { style: titleStyle() }, ["إدارة عناصر المخطط"]);
    const sub = el("div", { style: subtitleStyle() }, ["اختَر عنصرًا أو جزءًا من الرسم مباشرة، ثم انقله لطبقة أخرى أو أخفه أو احذفه."]);

    this.modeBtn = el("button", {
      type: "button",
      onclick: () => this.toggleMode(),
      style: this.buttonStyle("primary")
    }, ["🎯 تفعيل اختيار العناصر"]);

    const clearBtn = el("button", {
      type: "button",
      onclick: () => this.clearSelection(),
      style: this.buttonStyle("ghost")
    }, ["إلغاء التحديد"]);

    this.selectionInfo = el("div", { style: this.infoCardStyle() }, ["لا يوجد عنصر محدد."]);
    this.ensureSelectionBox();

    this.layerSelect = el("select", {
      style: inputStyle()
    });

    const moveBtn = el("button", {
      type: "button",
      onclick: () => this.moveSelectionToLayer(this.layerSelect.value),
      style: this.buttonStyle("success")
    }, ["نقل المحدد إلى الطبقة المختارة"]);

    this.newLayerInput = el("input", {
      type: "text",
      placeholder: "اسم طبقة جديدة",
      style: inputStyle()
    });

    const createMoveBtn = el("button", {
      type: "button",
      onclick: () => this.createLayerAndMoveSelection(),
      style: this.buttonStyle("warning")
    }, ["إنشاء طبقة جديدة ونقل المحدد"]);

    const hideBtn = el("button", {
      type: "button",
      onclick: () => this.hideSelection(),
      style: this.buttonStyle("ghost")
    }, ["إخفاء المحدد"]);

    const deleteBtn = el("button", {
      type: "button",
      onclick: () => this.deleteSelection(),
      style: this.buttonStyle("danger")
    }, ["حذف المحدد من المشروع"]);

    const selectLayerBtn = el("button", {
      type: "button",
      onclick: () => this.selectFullLayersFromSelection(),
      style: this.buttonStyle("ghost")
    }, ["تحديد كامل طبقة المحدد"]);

    const moveLayerBtn = el("button", {
      type: "button",
      onclick: () => this.moveSelectedLayersToLayer(this.layerSelect.value),
      style: this.buttonStyle("success")
    }, ["نقل طبقة/طبقات المحدد"]);

    const hideLayerBtn = el("button", {
      type: "button",
      onclick: () => this.hideSelectedLayers(),
      style: this.buttonStyle("ghost")
    }, ["إخفاء طبقة/طبقات المحدد"]);

    const deleteLayerBtn = el("button", {
      type: "button",
      onclick: () => this.deleteSelectedLayers(),
      style: this.buttonStyle("danger")
    }, ["حذف طبقة/طبقات المحدد"]);

    this.restoreBtn = el("button", {
      type: "button",
      onclick: () => this.restoreAllEdits(),
      style: this.buttonStyle("ghost")
    }, ["استرجاع كل المخفي/المحذوف"]);

    this.undoBtn = el("button", {
      type: "button",
      onclick: () => this.undo(),
      style: this.buttonStyle("undo"), // لون برتقالي لزر التراجع
      disabled: true
    }, ["↩ تراجع عن آخر عملية"]);

    this.layerListInfo = el("div", { style: { fontSize: "11px", color: "rgba(255,255,255,0.72)", lineHeight: 1.4 } }, [""]);

    const closeBtn = el("button", {
      type: "button",
      onclick: () => this.hide(),
      style: {
        ...themeButtonStyle("ghost", { width: "auto", padding: "6px 10px" })
      }
    }, ["✕"]);

    const header = el("div", { style: headerStyle() }, [el("div", {}, [title, sub]), closeBtn]);

    this.panel = el("aside", {
      id: "cad-entity-editor-panel",
      style: panelStyle({
        right: "18px", top: "18px", width: "360px", maxWidth: "calc(100vw - 36px)",
        maxHeight: "80vh", overflow: "auto", zIndex: 7002, display: "none", padding: "14px"
      })
    }, [
      header,
      el("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "12px" } }, [this.modeBtn, clearBtn]),
      this.selectionInfo,
      el("div", { style: this.sectionStyle() }, [
        el("div", { style: this.labelStyle() }, ["الطبقة المستهدفة"]),
        this.layerSelect,
        moveBtn,
      ]),
      el("div", { style: this.sectionStyle() }, [
        el("div", { style: this.labelStyle() }, ["إنشاء طبقة جديدة"]),
        this.newLayerInput,
        createMoveBtn,
      ]),
      el("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "10px" } }, [hideBtn, deleteBtn]),
      el("div", { style: this.sectionStyle() }, [
        el("div", { style: this.labelStyle() }, ["عمليات على كامل الطبقة/الطبقات"]),
        selectLayerBtn,
        moveLayerBtn,
        el("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" } }, [hideLayerBtn, deleteLayerBtn]),
      ]),
      el("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "10px" } }, [this.undoBtn, this.restoreBtn]), // تم إضافة التراجع هنا
      el("hr", { style: { border: 0, borderTop: "1px solid rgba(255,255,255,0.12)", margin: "12px 0" } }),
      this.layerListInfo,
    ]);

    document.body.appendChild(this.panel);
    this.refreshLayerOptions();
    this.updateRestoreInfo();
    this.updateUndoBtn();
  }

  buttonStyle(variant = "ghost", overrides = {}) { return themeButtonStyle(variant, overrides); }

  sectionStyle() { return themeSectionStyle(); }
  labelStyle() { return themeLabelStyle(); }
  infoCardStyle() { return themeInfoCardStyle(); }

  show() {
    this.visible = true;
    this.panel.style.display = "block";
    this.refreshLayerOptions();
    this.onFileLoaded();
  }

  hide() {
    this.visible = false;
    this.panel.style.display = "none";
    this.setMode(false);
  }

  toggle() { this.visible ? this.hide() : this.show(); }
  toggleMode() { this.setMode(!this.enabled); }

  setMode(flag) {
    this.enabled = !!flag;
    const container = this.getContainer();
    if (this.enabled) {
      container?.addEventListener("pointerdown", this.boundPointerDown, true);
      container?.addEventListener("pointermove", this.boundPointerMove, true);
      container?.addEventListener("pointerup", this.boundPointerUp, true);
      container?.addEventListener("contextmenu", this.boundContextMenu, true);
      window.addEventListener("keydown", this.boundKeyDown, true);
      document.body.style.cursor = "crosshair";
      this.getEntityRenderBridge()?.enable?.();
      this.getScreenSelectionBridge()?.setContext?.({ viewer: this.getViewer(), registry: this.getRegistry(), selectionEngine: this.getSelectionEngine(), container: this.getContainer(), renderBridge: this.getEntityRenderBridge() });
      this.modeBtn.textContent = "✅ اختيار العناصر مفعل";
      css(this.modeBtn, { background: "#0f9d58" });
    } else {
      container?.removeEventListener("pointerdown", this.boundPointerDown, true);
      container?.removeEventListener("pointermove", this.boundPointerMove, true);
      container?.removeEventListener("pointerup", this.boundPointerUp, true);
      container?.removeEventListener("contextmenu", this.boundContextMenu, true);
      window.removeEventListener("keydown", this.boundKeyDown, true);
      document.body.style.cursor = "";
      this.modeBtn.textContent = "🎯 تفعيل اختيار العناصر";
      css(this.modeBtn, { background: "#2f6fed" });
      this.pointerDown = null;
      this.dragSelect = null;
      this.hideSelectionBox();
      this.getEntityRenderBridge()?.disable?.();
    }
  }

  onPointerDown(event) {
    if (!this.enabled || this.isUiTarget(event.target)) return;
    if (event.button === 2) {
      this.dragSelect = {
        x0: event.clientX,
        y0: event.clientY,
        x1: event.clientX,
        y1: event.clientY,
        additive: !!(event.shiftKey || event.ctrlKey || event.metaKey),
      };
      this.showSelectionBox(this.rectFromPoints(event.clientX, event.clientY, event.clientX, event.clientY));
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.button !== 0) return;
    this.pointerDown = { x: event.clientX, y: event.clientY, shift: !!event.shiftKey, ctrl: !!event.ctrlKey, pointerType: event.pointerType || "mouse", time: performance.now() };
  }

  onPointerMove(event) {
    if (!this.enabled || !this.dragSelect) return;
    this.dragSelect.x1 = event.clientX;
    this.dragSelect.y1 = event.clientY;
    this.showSelectionBox(this.rectFromPoints(this.dragSelect.x0, this.dragSelect.y0, this.dragSelect.x1, this.dragSelect.y1));
    event.preventDefault();
    event.stopPropagation();
  }

  onPointerUp(event) {
    if (!this.enabled || this.isUiTarget(event.target)) return;
    if (this.dragSelect) {
      const drag = this.dragSelect;
      this.dragSelect = null;
      const rect = this.rectFromPoints(drag.x0, drag.y0, event.clientX, event.clientY);
      this.hideSelectionBox();
      event.preventDefault();
      event.stopPropagation();
      if (Math.max(rect.width, rect.height) < 8) return;
      const entries = this.collectEntriesInScreenRect(rect);
      this.selectEntries(entries, drag.additive);
      return;
    }
    if (!this.pointerDown) return;
    const dx = event.clientX - this.pointerDown.x;
    const dy = event.clientY - this.pointerDown.y;
    const dist = Math.hypot(dx, dy);
    const dt = performance.now() - this.pointerDown.time;
    const additive = this.pointerDown.shift || this.pointerDown.ctrl || event.shiftKey || event.ctrlKey || event.metaKey;
    this.pointerDown = null;
    if (dist > 6 || dt > 450) return;
    const entry = this.pickEntity(event.clientX, event.clientY);
    if (!entry) {
      if (!additive) this.clearSelection();
      return;
    }
    this.toggleEntrySelection(entry, additive);
    event.preventDefault();
    event.stopPropagation();
  }

  onContextMenu(event) {
    if (!this.enabled) return;
    if (this.dragSelect || event.button === 2 || !this.isUiTarget(event.target)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  onKeyDown(event) {
    if (!this.enabled) return;
    if (event.key === "Escape") {
      this.clearSelection();
      event.preventDefault();
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && this.selectedEntries.size) {
      this.deleteSelection();
      event.preventDefault();
    }
  }

  isUiTarget(target) {
    if (!target) return false;
    const tag = String(target.tagName || "").toUpperCase();
    if (["BUTTON", "INPUT", "SELECT", "TEXTAREA", "LABEL", "A"].includes(tag)) return true;
    return !!target.closest?.("#cad-fab, #cad-fab-menu, #layer-rules-panel, #cad-entity-editor-panel, #pdf-pager, .xviewer-toolbar, .xviewer-bottom-bar, [role='dialog']");
  }

  getSelectableObjects() {
    const scene = this.getScene();
    if (!scene) return [];
    const out = [];
    scene.traverse?.((obj) => {
      if (!obj || obj.visible === false) return;
      if (!(obj.isLine || obj.isLineSegments || obj.isLineLoop || obj.isMesh)) return;
      if (!obj.geometry?.attributes?.position) return;
      if (!this.hasSourceLayer(obj)) return;
      out.push(obj);
    });
    return out;
  }

  pickEntity(clientX, clientY) {
    const coreEntry = this.getScreenSelectionBridge()?.pickEntryAt?.(clientX, clientY, {
      tolerance: this.pointerDown?.pointerType === "touch" ? 18 : this.pointerDown?.pointerType === "pen" ? 12 : 10,
      worldThreshold: this.getLineThreshold(clientX, clientY),
    });
    if (coreEntry) return coreEntry;

    const camera = this.getCamera();
    const container = this.getContainer();
    if (!camera || !container) return null;
    const rect = container.getBoundingClientRect();
    const mouse = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
    const raycaster = new THREE.Raycaster();
    raycaster.params.Line = raycaster.params.Line || {};
    raycaster.params.Line.threshold = this.getLineThreshold(clientX, clientY);
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(this.getSelectableObjects(), false);
    if (!intersects?.length) return null;
    const hit = intersects[0];
    const obj = hit.object || null;
    if (!obj) return null;
    const managedEntityId = obj.userData?.__essamCoreEntityId;
    if (managedEntityId && this.getRegistry()?.get?.(managedEntityId)) {
      const entity = this.getRegistry().get(managedEntityId);
      return { id: entity.id, kind: "coreEntity", entity, layerName: entity.layer || "0", hit: { reason: "managed-render-fallback-raycast", rawHit: hit } };
    }
    if (this.isSegmentedObject(obj)) {
      const compEntry = this.resolveComponentEntry(obj, hit);
      if (compEntry) return compEntry;
    }
    return this.makeObjectEntry(obj);
  }

  selectEntries(entries, additive = false) {
    const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
    if (!additive) this.clearSelection();
    const coreIds = list.filter((entry) => entry.kind === "coreEntity").map((entry) => entry.id);
    if (coreIds.length) this.getRegistry()?.selectMany?.(coreIds, { additive: true });
    list.forEach((entry) => {
      if (!entry?.id || this.selectedEntries.has(entry.id)) return;
      this.selectedEntries.set(entry.id, entry);
      this.highlightEntry(entry);
    });
    this.getScreenSelectionBridge()?.syncSelectionHighlights?.();
    this.updateSelectionInfo();
  }

  collectEntriesInScreenRect(rect) {
    const coreEntries = this.getScreenSelectionBridge()?.queryInScreenRect?.(rect, {});
    if (coreEntries?.length) return coreEntries;

    const scene = this.getScene();
    const camera = this.getCamera();
    const container = this.getContainer();
    if (!scene || !camera || !container) return [];
    const out = [];
    const containerRect = container.getBoundingClientRect();
    scene.updateMatrixWorld?.(true);
    scene.traverse?.((obj) => {
      if (!obj || obj.visible === false) return;
      if (!(obj.isLine || obj.isLineSegments || obj.isLineLoop || obj.isMesh)) return;
      if (!this.hasSourceLayer(obj)) return;
      if (this.isSegmentedObject(obj)) {
        const model = this.ensureComponentModel(obj);
        (model?.components || []).forEach((component) => {
          if (this.componentIntersectsScreenRect(obj, component, rect, camera, containerRect)) {
            out.push({ id: component.id, kind: "component", obj, component, layerName: this.getEffectiveComponentLayer(obj, component.id) });
          }
        });
        return;
      }
      if (this.objectIntersectsScreenRect(obj, rect, camera, containerRect)) {
        out.push(this.makeObjectEntry(obj));
      }
    });
    return out;
  }

  componentIntersectsScreenRect(obj, component, rect, camera, containerRect) {
    const model = this.ensureComponentModel(obj);
    if (!model || !component?.segIndices?.length) return false;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let hasPoint = false;
    component.segIndices.forEach((segIdx) => {
      const seg = model.segments[segIdx];
      if (!seg) return;
      [seg.a, seg.b].forEach((p) => {
        const s = this.projectPointToScreen(obj, p, camera, containerRect);
        if (!s) return;
        hasPoint = true;
        minX = Math.min(minX, s.x); minY = Math.min(minY, s.y);
        maxX = Math.max(maxX, s.x); maxY = Math.max(maxY, s.y);
      });
    });
    if (!hasPoint) return false;
    return !(maxX < rect.left || minX > rect.right || maxY < rect.top || minY > rect.bottom);
  }

  objectIntersectsScreenRect(obj, rect, camera, containerRect) {
    const geo = obj.userData?.__entityEditorOriginalGeometry || obj.geometry;
    if (!geo?.boundingBox && geo?.computeBoundingBox) geo.computeBoundingBox();
    const bbox = geo?.boundingBox;
    if (!bbox) return false;
    const points = [
      [bbox.min.x, bbox.min.y, bbox.min.z], [bbox.min.x, bbox.min.y, bbox.max.z],
      [bbox.min.x, bbox.max.y, bbox.min.z], [bbox.min.x, bbox.max.y, bbox.max.z],
      [bbox.max.x, bbox.min.y, bbox.min.z], [bbox.max.x, bbox.min.y, bbox.max.z],
      [bbox.max.x, bbox.max.y, bbox.min.z], [bbox.max.x, bbox.max.y, bbox.max.z],
    ];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let hasPoint = false;
    points.forEach((p) => {
      const s = this.projectPointToScreen(obj, p, camera, containerRect);
      if (!s) return;
      hasPoint = true;
      minX = Math.min(minX, s.x); minY = Math.min(minY, s.y);
      maxX = Math.max(maxX, s.x); maxY = Math.max(maxY, s.y);
    });
    if (!hasPoint) return false;
    return !(maxX < rect.left || minX > rect.right || maxY < rect.top || minY > rect.bottom);
  }

  projectPointToScreen(obj, pointArray, camera, containerRect) {
    const v = new THREE.Vector3(pointArray[0] || 0, pointArray[1] || 0, pointArray[2] || 0).applyMatrix4(obj.matrixWorld);
    v.project(camera);
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) return null;
    return {
      x: ((v.x + 1) * 0.5) * containerRect.width + containerRect.left,
      y: ((-v.y + 1) * 0.5) * containerRect.height + containerRect.top,
      z: v.z,
    };
  }

  getLineThreshold(clientX, clientY) {
    try {
      const ov = window.cadDrawingOverlay;
      const val = ov?.pixelSizeToWorldSize?.(10, clientX, clientY, ov.getDrawingPlaneZ?.()) || ov?.pixelSizeToWorldSize?.(10, clientX, clientY) || 0.6;
      return Math.max(0.15, Number.isFinite(val) ? val : 0.6);
    } catch (_) {
      return 0.6;
    }
  }

  resolveLayerName(obj) {
    const ud = obj?.userData || {};
    const n = ud.__sourceOriginalLayer ?? ud.layer ?? ud.layerName ?? ud.dxfLayer ?? null;
    return (typeof n === "string" && n.trim()) ? n.trim() : null;
  }

  hasSourceLayer(obj) {
    if (!obj || obj.userData?.__entityEditorIgnore) return false;
    const name = `${obj.name || ""} ${obj.userData?.name || ""}`.toLowerCase();
    if (/(paper|background|sheet|canvas|overlay|grid|helper|measure|markup|annotation|teleport|controller|gizmo|axis)/.test(name)) return false;
    return !!this.resolveLayerName(obj);
  }

  getStableObjectId(obj) {
    if (!obj) return null;
    if (obj.userData?.__entityEditorStableId) return obj.userData.__entityEditorStableId;
    const originalLayer = obj.userData?.__sourceOriginalLayer || this.resolveLayerName(obj);
    obj.userData.__sourceOriginalLayer = originalLayer;
    const geo = obj.userData?.__entityEditorOriginalGeometry || obj.geometry;
    const pos = geo?.attributes?.position?.array;
    const count = pos ? Math.floor(pos.length / 3) : 0;
    const sample = this.samplePoints(obj, pos);
    if (!geo.boundingBox && geo?.computeBoundingBox) geo.computeBoundingBox();
    const bbox = geo?.boundingBox?.clone()?.applyMatrix4(obj.matrixWorld);
    const sig = [
      obj.type || "obj",
      originalLayer,
      count,
      sample.map((p) => `${this.fmt(p.x)},${this.fmt(p.y)},${this.fmt(p.z)}`).join("|"),
      bbox ? [this.fmt(bbox.min.x), this.fmt(bbox.min.y), this.fmt(bbox.max.x), this.fmt(bbox.max.y)].join(",") : "no-bbox"
    ].join("::");
    const id = `src_${this.hash(sig)}`;
    obj.userData.__entityEditorStableId = id;
    return id;
  }

  samplePoints(obj, pos) {
    if (!pos || pos.length < 3) return [{ x: 0, y: 0, z: 0 }];
    const count = Math.floor(pos.length / 3);
    const ids = [0, Math.max(0, Math.floor((count - 1) / 2)), Math.max(0, count - 1)];
    return ids.map((i) => {
      const k = i * 3;
      const v = new THREE.Vector3(pos[k] || 0, pos[k + 1] || 0, pos[k + 2] || 0);
      return v.applyMatrix4(obj.matrixWorld);
    });
  }

  fmt(n) { return Number.isFinite(n) ? Number(n).toFixed(3) : "0.000"; }

  hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i += 1) h = ((h << 5) + h) ^ str.charCodeAt(i);
    return (h >>> 0).toString(36);
  }

  isSegmentedObject(obj) {
    return !!(obj && (obj.isLineSegments || obj.type === "LineSegments"));
  }

  ensureOriginalGeometry(obj) {
    if (!obj?.geometry) return null;
    if (!obj.userData.__entityEditorOriginalGeometry) {
      obj.userData.__entityEditorOriginalGeometry = obj.geometry.clone();
    }
    return obj.userData.__entityEditorOriginalGeometry;
  }

  ensureComponentModel(obj) {
    if (!this.isSegmentedObject(obj)) return null;
    const originalGeometry = this.ensureOriginalGeometry(obj);
    if (!originalGeometry?.attributes?.position?.array) return null;
    if (obj.userData.__entityEditorComponentModel) return obj.userData.__entityEditorComponentModel;

    const pos = Array.from(originalGeometry.attributes.position.array || []);
    const index = originalGeometry.index?.array ? Array.from(originalGeometry.index.array) : null;
    const segments = [];
    if (index?.length) {
      for (let i = 0; i + 1 < index.length; i += 2) {
        const ia = index[i] * 3;
        const ib = index[i + 1] * 3;
        if (ib + 2 >= pos.length) continue;
        segments.push({
          idx: segments.length,
          a: [pos[ia], pos[ia + 1], pos[ia + 2]],
          b: [pos[ib], pos[ib + 1], pos[ib + 2]],
        });
      }
    } else {
      for (let i = 0; i + 5 < pos.length; i += 6) {
        segments.push({
          idx: segments.length,
          a: [pos[i], pos[i + 1], pos[i + 2]],
          b: [pos[i + 3], pos[i + 4], pos[i + 5]],
        });
      }
    }

    const pointMap = new Map();
    const keyOf = (p) => `${Math.round((p[0] || 0) * 1000)},${Math.round((p[1] || 0) * 1000)},${Math.round((p[2] || 0) * 1000)}`;
    segments.forEach((seg) => {
      const ka = keyOf(seg.a);
      const kb = keyOf(seg.b);
      seg.ka = ka;
      seg.kb = kb;
      if (!pointMap.has(ka)) pointMap.set(ka, []);
      if (!pointMap.has(kb)) pointMap.set(kb, []);
      pointMap.get(ka).push(seg.idx);
      pointMap.get(kb).push(seg.idx);
    });

    const visited = new Set();
    const segToComponent = new Array(segments.length).fill(-1);
    const objectId = this.getStableObjectId(obj);
    const components = [];

    segments.forEach((seg) => {
      if (visited.has(seg.idx)) return;
      const queue = [seg.idx];
      visited.add(seg.idx);
      const segIndices = [];
      while (queue.length) {
        const currentIdx = queue.pop();
        segIndices.push(currentIdx);
        const current = segments[currentIdx];
        [current.ka, current.kb].forEach((key) => {
          (pointMap.get(key) || []).forEach((nIdx) => {
            if (!visited.has(nIdx)) {
              visited.add(nIdx);
              queue.push(nIdx);
            }
          });
        });
      }
      segIndices.sort((a, b) => a - b);
      const compId = `${objectId}::c${components.length}_${this.hash(segIndices.join(","))}`;
      const component = { id: compId, segIndices };
      segIndices.forEach((s) => { segToComponent[s] = components.length; });
      components.push(component);
    });

    obj.userData.__entityEditorDisplayMap = segments.map((s) => s.idx);
    obj.userData.__entityEditorComponentModel = { segments, components, segToComponent };
    return obj.userData.__entityEditorComponentModel;
  }

  resolveIntersectSegmentIndex(obj, intersect) {
    const model = this.ensureComponentModel(obj);
    if (!model) return -1;
    const displayMap = obj.userData.__entityEditorDisplayMap || model.segments.map((s) => s.idx);
    if (Number.isInteger(intersect?.index) && displayMap[intersect.index] != null) return displayMap[intersect.index];
    const point = intersect?.point;
    if (!point) return displayMap[0] ?? -1;
    let best = displayMap[0] ?? -1;
    let bestDist = Infinity;
    displayMap.forEach((origIdx) => {
      const seg = model.segments[origIdx];
      if (!seg) return;
      const a = new THREE.Vector3(...seg.a).applyMatrix4(obj.matrixWorld);
      const b = new THREE.Vector3(...seg.b).applyMatrix4(obj.matrixWorld);
      const d = this.distancePointToSegment(point, a, b);
      if (d < bestDist) { bestDist = d; best = origIdx; }
    });
    return best;
  }

  distancePointToSegment(p, a, b) {
    const ab = new THREE.Vector3().subVectors(b, a);
    const ap = new THREE.Vector3().subVectors(p, a);
    const t = THREE.MathUtils.clamp(ap.dot(ab) / Math.max(1e-9, ab.lengthSq()), 0, 1);
    const closest = new THREE.Vector3().copy(a).addScaledVector(ab, t);
    return closest.distanceTo(p);
  }

  resolveComponentEntry(obj, intersect) {
    const model = this.ensureComponentModel(obj);
    if (!model) return null;
    const originalSegIdx = this.resolveIntersectSegmentIndex(obj, intersect);
    if (originalSegIdx < 0) return null;
    const compIndex = model.segToComponent[originalSegIdx];
    const component = model.components[compIndex];
    if (!component) return null;
    return {
      id: component.id,
      kind: "component",
      obj,
      component,
      layerName: this.getEffectiveComponentLayer(obj, component.id),
    };
  }

  makeObjectEntry(obj) {
    return {
      id: this.getStableObjectId(obj),
      kind: "object",
      obj,
      layerName: this.getEffectiveObjectLayer(obj),
    };
  }

  toggleEntrySelection(entry, additive = false) {
    if (!entry?.id) return;
    if (!additive) this.clearSelection();
    if (this.selectedEntries.has(entry.id)) {
      this.unhighlightEntry(this.selectedEntries.get(entry.id));
      this.selectedEntries.delete(entry.id);
      const entity = this.getRegistry()?.get?.(entry.id);
      if (entity) {
        entity.selected = false;
        this.getRegistry()?.selectedIds?.delete?.(entry.id);
      }
    } else {
      this.selectedEntries.set(entry.id, entry);
      if (entry.kind === "coreEntity") this.getRegistry()?.select?.(entry.id, { additive: true });
      this.highlightEntry(entry);
    }
    this.getScreenSelectionBridge()?.syncSelectionHighlights?.();
    this.updateSelectionInfo();
  }

  clearSelection() {
    Array.from(this.selectedEntries.values()).forEach((entry) => this.unhighlightEntry(entry));
    this.selectedEntries.clear();
    this.getRegistry()?.clearSelection?.();
    this.getScreenSelectionBridge()?.clearHighlights?.();
    this.updateSelectionInfo();
  }

  highlightEntry(entry) {
    if (entry?.kind === "coreEntity") {
      this.getScreenSelectionBridge()?.syncSelectionHighlights?.();
      return;
    }
    if (!entry?.obj) return;
    if (entry.kind === "component" && this.isSegmentedObject(entry.obj)) {
      const scene = this.getScene();
      const model = this.ensureComponentModel(entry.obj);
      if (!scene || !model) return;
      const positions = [];
      entry.component.segIndices.forEach((segIdx) => {
        const seg = model.segments[segIdx];
        if (!seg) return;
        const a = new THREE.Vector3(...seg.a).applyMatrix4(entry.obj.matrixWorld);
        const b = new THREE.Vector3(...seg.b).applyMatrix4(entry.obj.matrixWorld);
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      const mat = new THREE.LineBasicMaterial({ color: 0xffd54f, transparent: true, opacity: 0.95 });
      const overlay = new THREE.LineSegments(geo, mat);
      overlay.name = "entity-editor-overlay";
      overlay.userData.__entityEditorIgnore = true;
      scene.add(overlay);
      this.highlightCache.set(entry.id, overlay);
      return;
    }

    const obj = entry.obj;
    if (this.highlightCache.has(entry.id) || Array.isArray(obj.material)) return;
    const material = obj.material;
    this.highlightCache.set(entry.id, {
      obj,
      color: material?.color?.clone?.() || null,
      emissive: material?.emissive?.clone?.() || null,
      opacity: material?.opacity,
      transparent: material?.transparent,
    });
    if (material?.color) material.color.set("#ffd54f");
    if (material?.emissive) material.emissive.set("#442200");
    material.needsUpdate = true;
  }

  unhighlightEntry(entry) {
    if (entry?.kind === "coreEntity") {
      this.getScreenSelectionBridge()?.syncSelectionHighlights?.();
      return;
    }
    if (!entry?.id) return;
    const saved = this.highlightCache.get(entry.id);
    if (!saved) return;
    if (saved.isLineSegments || saved.name === "entity-editor-overlay") {
      saved.geometry?.dispose?.();
      saved.material?.dispose?.();
      saved.parent?.remove?.(saved);
      this.highlightCache.delete(entry.id);
      return;
    }
    const material = saved.obj?.material;
    if (!Array.isArray(material)) {
      if (saved.color && material?.color) material.color.copy(saved.color);
      if (saved.emissive && material?.emissive) material.emissive.copy(saved.emissive);
      if (typeof saved.opacity === "number" && material) material.opacity = saved.opacity;
      if (typeof saved.transparent === "boolean" && material) material.transparent = saved.transparent;
      if (material) material.needsUpdate = true;
    }
    this.highlightCache.delete(entry.id);
  }

  updateSelectionInfo() {
    if (!this.selectionInfo) return;
    const items = Array.from(this.selectedEntries.values());
    if (!items.length) {
      this.selectionInfo.textContent = "لا يوجد عنصر محدد. فعّل اختيار العناصر ثم اضغط على عنصر، أو اسحب بالزر الأيمن لتحديد مساحة. يمكنك أيضًا إضافة عناصر متعددة بالضغط مع Shift.";
      return;
    }
    const layers = Array.from(new Set(items.map((entry) => entry.kind === "coreEntity" ? (entry.entity?.layer || entry.layerName || "0") : entry.kind === "component" ? this.getEffectiveComponentLayer(entry.obj, entry.component.id) : this.getEffectiveObjectLayer(entry.obj))));
    const kinds = Array.from(new Set(items.map((entry) => entry.kind === "coreEntity" ? (entry.entity?.kind || "Entity") : entry.kind === "component" ? "جزء من طبقة" : (entry.obj.type || "Object"))));
    const text = [
      `العناصر المحددة: ${items.length}`,
      `الطبقة الحالية: ${layers.length === 1 ? layers[0] : `متعددة (${layers.length})`}`,
      `النوع: ${kinds.join(" / ")}`,
      `يمكنك تطبيق العملية على المحدد فقط، أو على كامل طبقة/طبقات العناصر المحددة.`,
      `تلميح: Shift لإضافة عناصر، أو اسحب بالزر الأيمن لتحديد مساحة.`
    ].join("\n");
    this.selectionInfo.textContent = text;
  }

  getCurrentLayerNames() {
    try {
      const regLayers = this.getRegistry()?.listLayers?.();
      if (Array.isArray(regLayers) && regLayers.length) {
        const names = new Set(regLayers.map((layer) => layer.name || layer.id).filter(Boolean));
        Object.values(this.edits.layerByComponentId || {}).forEach((name) => { if (name) names.add(name); });
        (window.cadDrawingOverlay?.getAnnotationLayerNames?.() || []).forEach((name) => names.add(name));
        return Array.from(names).sort((a, b) => a.localeCompare(b));
      }
      const viewer = this.getViewer();
      const scene = this.getScene();
      const names = new Set();
      if (viewer && scene) {
        const raw = CADLayerKit.extractFromViewer(viewer, { respectVisibility: false });
        (Array.isArray(raw?.layers) ? raw.layers : []).forEach((name) => { if (name) names.add(name); });
        scene.traverse?.((obj) => {
          if (!this.hasSourceLayer(obj)) return;
          const layer = this.getEffectiveObjectLayer(obj);
          if (layer) names.add(layer);
        });
      }
      Object.values(this.edits.layerByComponentId || {}).forEach((name) => { if (name) names.add(name); });
      (window.cadDrawingOverlay?.getAnnotationLayerNames?.() || []).forEach((name) => names.add(name));
      return Array.from(names).sort((a, b) => a.localeCompare(b));
    } catch (_) {
      return window.cadDrawingOverlay?.getAnnotationLayerNames?.() || [];
    }
  }

  refreshLayerOptions() {
    if (!this.layerSelect || !this.layerListInfo) return;
    const raw = this.getCurrentLayerNames();
    const previous = this.layerSelect.value;
    this.layerSelect.innerHTML = "";
    raw.forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      this.layerSelect.appendChild(option);
    });
    if (raw.includes(previous)) this.layerSelect.value = previous;
    else if (raw.length) this.layerSelect.value = raw[0];
    this.layerListInfo.textContent = `الطبقات الحالية في الملف: ${raw.length ? raw.join(" ، ") : "لا توجد طبقات متاحة"}`;
  }

  getEffectiveObjectLayer(obj) {
    const id = this.getStableObjectId(obj);
    return this.edits.layerById?.[id] || obj.userData?.__sourceOriginalLayer || this.resolveLayerName(obj) || "0";
  }

  getEffectiveComponentLayer(obj, componentId) {
    return this.edits.layerByComponentId?.[componentId] || obj.userData?.__sourceOriginalLayer || this.resolveLayerName(obj) || "0";
  }

  makeCoreEntry(entity) {
    if (!entity?.id) return null;
    return {
      id: entity.id,
      kind: "coreEntity",
      entity,
      layerName: entity.layer || "0",
      hit: { reason: "entity-layer-editor" },
    };
  }

  getSelectedLayerIds() {
    const layers = new Set();
    for (const entry of this.selectedEntries.values()) {
      if (entry?.kind === "coreEntity") layers.add(entry.entity?.layer || entry.layerName || "0");
      else if (entry?.kind === "component") layers.add(this.getEffectiveComponentLayer(entry.obj, entry.component.id));
      else if (entry?.obj) layers.add(this.getEffectiveObjectLayer(entry.obj));
    }
    this.getRegistry()?.getSelected?.()?.forEach((entity) => layers.add(entity.layer || "0"));
    return Array.from(layers).filter(Boolean);
  }

  syncSelectedEntriesFromRegistry() {
    const selected = this.getRegistry()?.getSelected?.() || [];
    this.selectedEntries.clear();
    selected.forEach((entity) => {
      const entry = this.makeCoreEntry(entity);
      if (entry) this.selectedEntries.set(entry.id, entry);
    });
    this.getScreenSelectionBridge()?.syncSelectionHighlights?.();
    this.updateSelectionInfo();
  }

  selectFullLayersFromSelection({ additive = false } = {}) {
    const layerIds = this.getSelectedLayerIds();
    if (!layerIds.length) return 0;
    const count = this.getRegistry()?.selectLayers?.(layerIds, { additive, includeHidden: false }) || 0;
    this.syncSelectedEntriesFromRegistry();
    return count;
  }

  moveSelectedLayersToLayer(layerName) {
    const target = String(layerName || "").trim();
    const layerIds = this.getSelectedLayerIds();
    if (!target || !layerIds.length) return;
    this.saveSnapshot();
    let moved = 0;
    const registry = this.getRegistry();
    for (const layerId of layerIds) moved += registry?.moveLayerToLayer?.(layerId, target) || 0;
    registry?.selectLayer?.(target, { additive: false, includeHidden: false });
    this.syncSelectedEntriesFromRegistry();
    this.saveEdits();
    this.afterSceneMutation();
    return moved;
  }

  hideSelectedLayers() {
    const layerIds = this.getSelectedLayerIds();
    if (!layerIds.length) return;
    this.saveSnapshot();
    let count = 0;
    const registry = this.getRegistry();
    for (const layerId of layerIds) count += registry?.hideLayer?.(layerId, true) || 0;
    this.selectedEntries.clear();
    this.saveEdits();
    this.clearSelection();
    this.afterSceneMutation();
    return count;
  }

  deleteSelectedLayers() {
    const layerIds = this.getSelectedLayerIds();
    if (!layerIds.length) return;
    this.saveSnapshot();
    let count = 0;
    const registry = this.getRegistry();
    for (const layerId of layerIds) count += registry?.deleteLayer?.(layerId, true) || 0;
    this.selectedEntries.clear();
    this.saveEdits();
    this.clearSelection();
    this.afterSceneMutation();
    return count;
  }

  moveSelectionToLayer(layerName) {
    const target = String(layerName || "").trim();
    if (!target || !this.selectedEntries.size) return;
    this.saveSnapshot(); // حفظ قبل النقل
    this.selectedEntries.forEach((entry) => this.applyLayerToEntry(entry, target));
    this.saveEdits();
    this.syncSelectedEntriesFromRegistry();
    this.afterSceneMutation();
  }

  createLayerAndMoveSelection() {
    const raw = String(this.newLayerInput?.value || "").trim();
    if (!raw) return;
    // حفظ التراجع داخل دالة moveSelectionToLayer
    this.moveSelectionToLayer(raw);
    this.newLayerInput.value = "";
  }

  applyLayerToEntry(entry, layerName) {
    if (entry?.kind === "coreEntity") {
      this.getRegistry()?.moveToLayer?.(entry.id, layerName);
      if (entry.entity) entry.entity.layer = layerName;
      entry.layerName = layerName;
      return;
    }
    if (!entry?.obj) return;
    if (entry.kind === "component") {
      this.edits.layerByComponentId[entry.component.id] = layerName;
      entry.obj.userData.__entityEditorComponentLayerMap = { ...(entry.obj.userData.__entityEditorComponentLayerMap || {}), [entry.component.id]: layerName };
      entry.layerName = layerName;
    } else {
      const id = this.getStableObjectId(entry.obj);
      this.edits.layerById[id] = layerName;
      this.applyLayer(entry.obj, layerName);
      entry.layerName = layerName;
    }
  }

  applyLayer(obj, layerName) {
    if (!obj) return;
    obj.userData = obj.userData || {};
    obj.userData.layer = layerName;
    obj.userData.layerName = layerName;
    obj.userData.dxfLayer = layerName;
  }

  hideSelection() {
    if (!this.selectedEntries.size) return;
    this.saveSnapshot(); // حفظ قبل الإخفاء
    this.selectedEntries.forEach((entry) => this.hideEntry(entry));
    this.saveEdits();
    this.clearSelection();
    this.afterSceneMutation();
  }

  deleteSelection() {
    if (!this.selectedEntries.size) return;
    this.saveSnapshot(); // حفظ قبل الحذف
    this.selectedEntries.forEach((entry) => this.deleteEntry(entry));
    this.saveEdits();
    this.clearSelection();
    this.afterSceneMutation();
  }

  hideEntry(entry) {
    if (entry?.kind === "coreEntity") {
      this.getRegistry()?.hide?.(entry.id, true);
      return;
    }
    if (entry.kind === "component") {
      this.pushUnique(this.edits.hiddenComponentIds, entry.component.id);
      this.removeValue(this.edits.deletedComponentIds, entry.component.id);
      this.rebuildObjectDisplay(entry.obj);
      return;
    }
    const id = this.getStableObjectId(entry.obj);
    entry.obj.visible = false;
    entry.obj.userData = entry.obj.userData || {};
    entry.obj.userData.__entityHidden = true;
    this.pushUnique(this.edits.hiddenIds, id);
    this.removeValue(this.edits.deletedIds, id);
  }

  deleteEntry(entry) {
    if (entry?.kind === "coreEntity") {
      this.getRegistry()?.delete?.(entry.id, true);
      return;
    }
    if (entry.kind === "component") {
      this.pushUnique(this.edits.deletedComponentIds, entry.component.id);
      this.removeValue(this.edits.hiddenComponentIds, entry.component.id);
      this.rebuildObjectDisplay(entry.obj);
      return;
    }
    const id = this.getStableObjectId(entry.obj);
    entry.obj.visible = false;
    entry.obj.userData = entry.obj.userData || {};
    entry.obj.userData.__entityDeleted = true;
    this.pushUnique(this.edits.deletedIds, id);
    this.removeValue(this.edits.hiddenIds, id);
  }

  pushUnique(arr, value) { if (!arr.includes(value)) arr.push(value); }
  removeValue(arr, value) {
    const idx = arr.indexOf(value);
    if (idx >= 0) arr.splice(idx, 1);
  }

  rebuildObjectDisplay(obj) {
    if (!this.isSegmentedObject(obj)) return;
    const model = this.ensureComponentModel(obj);
    const originalGeometry = this.ensureOriginalGeometry(obj);
    if (!model || !originalGeometry) return;

    const hidden = new Set(this.edits.hiddenComponentIds || []);
    const deleted = new Set(this.edits.deletedComponentIds || []);
    obj.userData.__entityEditorHiddenComponentIds = model.components.filter((c) => hidden.has(c.id)).map((c) => c.id);
    obj.userData.__entityEditorDeletedComponentIds = model.components.filter((c) => deleted.has(c.id)).map((c) => c.id);
    obj.userData.__entityEditorComponentLayerMap = { ...(obj.userData.__entityEditorComponentLayerMap || {}) };
    Object.keys(this.edits.layerByComponentId || {}).forEach((compId) => {
      if (compId.startsWith(`${this.getStableObjectId(obj)}::`)) obj.userData.__entityEditorComponentLayerMap[compId] = this.edits.layerByComponentId[compId];
    });

    const visibleSegs = [];
    model.components.forEach((component) => {
      if (hidden.has(component.id) || deleted.has(component.id)) return;
      component.segIndices.forEach((segIdx) => visibleSegs.push(segIdx));
    });
    visibleSegs.sort((a, b) => a - b);

    const current = obj.geometry;
    if (!visibleSegs.length) {
      if (current && current !== originalGeometry) current.dispose?.();
      obj.geometry = new THREE.BufferGeometry();
      obj.geometry.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
      obj.userData.__entityEditorDisplayMap = [];
      obj.visible = false;
      return;
    }

    if (visibleSegs.length === model.segments.length) {
      if (current && current !== originalGeometry) current.dispose?.();
      obj.geometry = originalGeometry.clone();
      obj.userData.__entityEditorDisplayMap = model.segments.map((s) => s.idx);
      obj.visible = true;
      return;
    }

    const positions = [];
    visibleSegs.forEach((segIdx) => {
      const seg = model.segments[segIdx];
      if (!seg) return;
      positions.push(...seg.a, ...seg.b);
    });
    if (current && current !== originalGeometry) current.dispose?.();
    const next = new THREE.BufferGeometry();
    next.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    obj.geometry = next;
    obj.userData.__entityEditorDisplayMap = visibleSegs.slice();
    obj.visible = true;
  }

  restoreAllEdits() {
    // Restore All is treated as a clean reset, not as another undoable edit.
    // This avoids the confusing "Undo last operation" button appearing after a full reset.
    this.edits = this.emptyEdits();
    this.saveEdits();
    this.getRegistry()?.restoreAll?.();
    this.getScreenSelectionBridge()?.applyVisibilityToScene?.();

    const scene = this.getScene();
    const managedRenderActive = this.getEntityRenderBridge()?.enabled === true;
    scene?.traverse?.((obj) => {
      if (!this.shouldTouchSceneObjectForEdits(obj)) return;
      if (obj.userData.__sourceOriginalLayer) this.applyLayer(obj, obj.userData.__sourceOriginalLayer);
      delete obj.userData.__entityHidden;
      delete obj.userData.__entityDeleted;
      delete obj.userData.__entityEditorHiddenComponentIds;
      delete obj.userData.__entityEditorDeletedComponentIds;
      delete obj.userData.__entityEditorComponentLayerMap;

      if (this.isSegmentedObject(obj) && obj.userData.__entityEditorOriginalGeometry) {
        obj.geometry?.dispose?.();
        obj.geometry = obj.userData.__entityEditorOriginalGeometry.clone();
        const model = this.ensureComponentModel(obj);
        obj.userData.__entityEditorDisplayMap = model?.segments?.map((s) => s.idx) || [];
      }

      // If the managed per-entity renderer is active, the original x-viewer objects must stay hidden.
      obj.visible = managedRenderActive && obj.userData.__essamManagedOriginalVisible !== undefined ? false : true;
    });

    this.clearSelection();
    this.clearHistory();
    this.afterSceneMutation();
  }

  updateRestoreInfo() {
    if (!this.restoreBtn) return;
    const hidden = (this.edits.hiddenIds?.length || 0) + (this.edits.hiddenComponentIds?.length || 0);
    const deleted = (this.edits.deletedIds?.length || 0) + (this.edits.deletedComponentIds?.length || 0);
    this.restoreBtn.textContent = hidden || deleted ? `استرجاع الكل (${hidden} مخفي / ${deleted} محذوف)` : "استرجاع كل المخفي/المحذوف";
  }

  afterSceneMutation() {
    this.getEntityRenderBridge()?.rebuild?.();
    this.getScreenSelectionBridge()?.syncSelectionHighlights?.();
    this.refreshLayerOptions();
    window.dispatchEvent(new CustomEvent("cad:source-entities-updated"));
    window.dispatchEvent(new CustomEvent("cad:entity-registry-updated", { detail: { registry: this.getRegistry?.() } }));
    this.updateSelectionInfo();
  }

  onFileLoaded() {
    this.fileName = this.getCurrentFileName();
    this.getScreenSelectionBridge();
    this.getEntityRenderBridge();
    this.loadEdits(this.fileName);
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.applyEditsToScene();
      this.refreshLayerOptions();
    }, 220);
  }

  shouldTouchSceneObjectForEdits(obj) {
    if (!obj || !obj.userData) return false;
    if (obj.userData.__essamManagedEntityRender || obj.userData.__essamManagedEntityRoot || obj.userData.__essamCoreSelectionOverlay || obj.userData.__entityEditorIgnore) return false;
    if (!(obj.isLine || obj.isLineSegments || obj.isLineLoop || obj.isMesh)) return false;
    if (!obj.geometry?.attributes?.position && !obj.userData.__entityEditorOriginalGeometry) return false;
    return this.hasSourceLayer(obj) || obj.userData.__entityHidden || obj.userData.__entityDeleted || obj.userData.__entityEditorOriginalGeometry;
  }

  applyEditsToScene(options = {}) {
    const scene = this.getScene();
    if (!scene) return;
    const hiddenSet = new Set(this.edits.hiddenIds || []);
    const deletedSet = new Set(this.edits.deletedIds || []);
    scene.updateMatrixWorld?.(true);
    scene.traverse?.((obj) => {
      if (!this.shouldTouchSceneObjectForEdits(obj)) return;
      const id = this.getStableObjectId(obj);
      const originalLayer = obj.userData?.__sourceOriginalLayer || this.resolveLayerName(obj);
      if (!id || !originalLayer) return;
      if (this.edits.layerById[id]) this.applyLayer(obj, this.edits.layerById[id]);
      else this.applyLayer(obj, originalLayer);

      if (deletedSet.has(id)) {
        obj.visible = false;
        obj.userData.__entityDeleted = true;
        delete obj.userData.__entityHidden;
        return;
      }
      if (hiddenSet.has(id)) {
        obj.visible = false;
        obj.userData.__entityHidden = true;
        delete obj.userData.__entityDeleted;
        return;
      }

      delete obj.userData.__entityHidden;
      delete obj.userData.__entityDeleted;
      if (this.getEntityRenderBridge()?.enabled === true && obj.userData.__essamManagedOriginalVisible !== undefined) {
        obj.visible = false;
        return;
      }
      if (this.isSegmentedObject(obj)) this.rebuildObjectDisplay(obj);
      else obj.visible = true;
    });
    this.afterSceneMutation();
  }
}

const editor = new CADEntityLayerEditor();
window.cadEntityLayerEditor = editor;

export { CADEntityLayerEditor };
