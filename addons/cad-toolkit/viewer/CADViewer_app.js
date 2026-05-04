import { THREE, Viewer2d } from "@x-viewer/core";
import { t, getCurrentLanguage } from "../core/i18n.js";
import { ContentRecognition } from "../core/ContentRecognition.js";
import {
  LocalDxfUploader,
  PdfLoaderPlugin,
  AxisGizmoPlugin,
  BottomBarPlugin,
  MeasurementPlugin,
  Viewer2dToolbarPlugin,
  MarkupPlugin,
  Settings2dPlugin,
  StatsPlugin,
  LayerManagerPlugin,
  ScreenshotPlugin,
  ToolbarMenuId,
} from "@x-viewer/plugins";

export class CADViewerApp {
  constructor(containerId = "myCanvas", options = {}) {
    this.containerId = containerId;
    this.options = options || {};

    this.viewer = null;
    this.toolbarPlugin = null;
    this.language = options.language || getCurrentLanguage();
    this.uploader = null;
    this.layerManager = null;
    this.contentRecognition = null;

    // Current loaded model state.
    // These values let the CAD core read x-viewer model data before falling back to scene traversal.
    this.currentModel = null;
    this.currentModels = [];
    this.currentFile = null;
    this.currentFileName = null;

    // PDF state
    this._pdfPlugin = null;
    this._pdfPagerEl = null;
    this._pdfPagerSelect = null;
    this._pdfPagerLabel = null;
    this._pdfPageCount = 0;
    this._pdfCurrentPage = 1;

    // Fixers
    this._pdfFitTimer = null;
    this._fixInterval = null;
    
    this._isAppleMobile = this._detectAppleMobile();
    this._isAndroidTouch = this._detectAndroidTouch();

    // ✅ مفتاح التحكم في الجودة (يدوي)
    // على iPad/iPhone نبدأ بوضع الأمان تلقائيًا لتقليل مشاكل الذاكرة وإعادة التحميل.
    this._useProgressiveMode = this._isAppleMobile;
  }

  async init() {
    const viewerCfg = {
      containerId: this.containerId,
      language: "en",
      enableSpinner: true,
      enableProgressBar: true,
      enableLayoutBar: true,
      enableLocalCache: false,
    };

    this.viewer = new Viewer2d(viewerCfg);
    this.contentRecognition = new ContentRecognition(this);

    // Fonts
    try {
      await this.viewer.setFont([
        "./libs/fonts/hztxt.shx",
        "./libs/fonts/simplex.shx",
        "./libs/fonts/arial.ttf",
        "./libs/fonts/helvetiker_regular.typeface.json",
        "./libs/fonts/Microsoft_YaHei.ttf",
        "./libs/fonts/Microsoft_YaHei_Regular.typeface.json",
      ]);
    } catch (e) {
      console.warn("Font loading warning:", e);
    }

    this._initPluginsFull();
    this._initUploader();

    console.log(t("viewer.ready", "Ready. Use the toolbar normally."));
    window.dispatchEvent(new CustomEvent("cad:app-ready"));
  }

  _initPluginsFull() {
    new AxisGizmoPlugin(this.viewer, { ignoreZAxis: true });
    new BottomBarPlugin(this.viewer);
    new MeasurementPlugin(this.viewer, { language: "en" });
    new MarkupPlugin(this.viewer);
    new Settings2dPlugin(this.viewer, { language: "en", visible: false });
    if (!this._isAppleMobile) new StatsPlugin(this.viewer);
    new ScreenshotPlugin(this.viewer, { setBackgroundTransparent: false });

    const menuConfig = {
      [ToolbarMenuId.Layers]: {
        onClick: (_viewer, toolbar) => {
          window.layerRulesUI?.toggle?.();
          try { toolbar?.setActive?.(ToolbarMenuId.Layers, window.layerRulesUI?.isVisible?.() ?? false); } catch (_) {}
        },
        onActive: () => window.layerRulesUI?.show?.(),
        onDeactive: () => window.layerRulesUI?.hide?.(),
      },
      [ToolbarMenuId.Markup]: {
        onClick: (_viewer, toolbar) => {
          try { toolbar?.setActive?.(ToolbarMenuId.MarkupVisibility, false); } catch (_) {}
          window.cadDrawingOverlay?.toggle?.();
        },
      },
      [ToolbarMenuId.MarkupVisibility]: {
        visible: false,
      },
    };

    this.toolbarPlugin = new Viewer2dToolbarPlugin(this.viewer, { menuConfig, language: "en" });
  }

  _initUploader() {
    this.uploader = new LocalDxfUploader(this.viewer, { enableDragDropFile: true });
    this.uploader.setPdfWorker("./libs/pdf/pdf.worker.min.js");

    this.uploader.onSuccess = (event = {}) => {
      console.log(t("viewer.fileUploaded", "File uploaded."), event.fileName || "");
      if (event.file) this.uploader.file = event.file;
      window.dispatchEvent(new CustomEvent("cad:file-loaded", { detail: event }));
    };

    this.uploader.onError = (event = {}) => {
      console.error("File load error:", event);
      const msg = event?.fileName
        ? t("viewer.fileLoadErrorNamed", "Failed to open file: {name}").replace("{name}", event.fileName)
        : t("viewer.fileLoadError", "Failed to open file.");
      alert(msg);
    };

    this._patchUploaderPdfBehavior();
    this._patchUploaderDxfBehavior();
  }

  // ✅ زر بسيط لتبديل الوضع يدوياً
  _initQualityToggle() {
    const toggleBtn = document.createElement("button");
    const syncToggleLabel = () => {
      if (this._useProgressiveMode) {
        toggleBtn.innerText = this._isAppleMobile ? "🛡️ iPad Safe Mode" : "🛡️ Safety Mode (Multi-Page)";
        toggleBtn.style.background = "rgba(255, 140, 0, 0.8)";
      } else {
        toggleBtn.innerText = "⚡ Quality: HIGH";
        toggleBtn.style.background = "rgba(0, 200, 0, 0.8)";
      }
    };

    Object.assign(toggleBtn.style, {
      position: "fixed",
      bottom: "10px",
      left: "10px",
      zIndex: "999999",
      padding: "8px 12px",
      color: "white",
      border: "none",
      borderRadius: "5px",
      cursor: "pointer",
      fontWeight: "bold",
      fontSize: "12px",
      boxShadow: "0 2px 5px rgba(0,0,0,0.3)",
      touchAction: "manipulation"
    });

    syncToggleLabel();

    toggleBtn.onclick = () => {
      this._useProgressiveMode = !this._useProgressiveMode;
      syncToggleLabel();
      console.log("Mode switched to:", this._useProgressiveMode ? "Progressive (Safety)" : "Direct (High Quality)");
      alert(`تم التبديل إلى: ${this._useProgressiveMode ? "وضع الأمان" : "وضع الجودة العالية"}.
يرجى إعادة تحميل الملف الآن.`);
    };

    document.body.appendChild(toggleBtn);
  }

  _patchUploaderPdfBehavior() {
    const app = this;

    this.uploader.uploadSinglePdf = async function (file) {
      this.file = file;
      app.uploader.file = file;
      const fileUrl = URL.createObjectURL(file);
      
      // على أجهزة Apple اللمسية نفضل وضع الأمان افتراضياً لتقليل إعادة التحميل ومشاكل الذاكرة.
      const useProgressive = app._useProgressiveMode || app._isAppleMobile;
      console.log(`[Uploader] Starting PDF load. Mode: ${useProgressive ? 'Progressive' : 'High Quality'}`);

      let didFinalFit = false;
      const onProgress = (evt) => {
        try {
          if (!evt?.total) return;
          const p = Math.floor((evt.loaded * 100) / evt.total);
          console.log(`[Loading] ${p}%`);
          if (!didFinalFit && p >= 100) {
            didFinalFit = true;
            app._schedulePdfFit(150);
          }
        } catch (_) {}
      };

      try {
        app._stopContinuousFixer();

        app._pdfPlugin = new PdfLoaderPlugin(app.viewer, {
            font: app.viewer.getFontManager?.() || app.viewer.fontManager,
            pdfWorker: this.pdfWorker,
            // تطبيق الوضع المختار يدوياً مع تخفيف الجودة على iPad/iPhone لتفادي إعادة التحميل.
            enableProgressiveLoad: useProgressive, 
            scale: app._getPdfRenderScale(useProgressive), 
        });

        const model = await app._pdfPlugin.loadAsync(
          { merge: true, src: fileUrl, modelId: file.name },
          onProgress
        );

        app.viewer.addModel(model);
        app._syncCurrentModel(file, file.name);

        app._pdfPageCount = app._pdfPlugin.getPageCount?.() || 0;
        app._pdfCurrentPage = 1;
        app._ensurePdfPager(app._pdfPageCount);

        app._schedulePdfFit(300);
        app._tryFlattenCamera();

        // تطبيق الإصلاح المناسب للوضع المختار
        if (useProgressive) {
            app._startContinuousFixer();
        } else {
            app._forceNoCulling(); 
        }

        this.onSuccess && this.onSuccess({ file, fileName: file.name });
      } catch (e) {
        console.info(e);
      }
    };
  }

  _patchUploaderDxfBehavior() {
    const app = this;
    this.uploader.uploadSingleDxf = async function (file) {
      const onProgress = () => {};
      try {
        app._stopContinuousFixer();
        this.file = file;
        app.uploader.file = file;
        const modelConfig = Object.assign({}, this.defaultModelConfig || { merge: true, src: "" }, {
            merge: true, src: URL.createObjectURL(file), modelId: file.name
        });
        await this.viewer.loadModel(modelConfig, onProgress);
        app._syncCurrentModel(file, file.name);
        this.onSuccess && this.onSuccess({ file, fileName: file.name });
      } catch (e) {
        console.error(e);
        alert("فشل فتح ملف CAD.");
      }
    };
    try { app.viewer?.enableRender?.(); } catch (_) {}
  }

  _ensurePdfPager(pageCount) {
    if (!pageCount || pageCount <= 1) {
      if (this._pdfPagerEl) this._pdfPagerEl.style.display = "none";
      return;
    }

    if (!this._pdfPagerEl) {
      const wrap = document.createElement("div");
      wrap.id = "pdf-pager";
      Object.assign(wrap.style, {
        position: "fixed",
        top: "80px", 
        right: "20px",
        zIndex: "999999",
        background: "rgba(0,0,0,0.55)",
        color: "#fff",
        padding: "8px 10px",
        borderRadius: "10px",
        display: "flex",
        gap: "8px",
        alignItems: "center",
        fontFamily: "Arial, sans-serif",
        fontSize: "12px",
        userSelect: "none",
      });

      const label = document.createElement("span"); label.textContent = `${t("viewer.pdfPage", "Page")}:`; wrap.appendChild(label);

      const btnPrev = document.createElement("button");
      btnPrev.textContent = "◀";
      Object.assign(btnPrev.style, this._pagerBtnStyle());
      btnPrev.onclick = async () => {
        const next = Math.max(1, (this._pdfCurrentPage || 1) - 1);
        await this._loadPdfPage(next);
      };
      wrap.appendChild(btnPrev);

      const sel = document.createElement("select");
      Object.assign(sel.style, { padding: "4px", borderRadius: "4px", background: "rgba(255,255,255,0.1)", color: "#fff", border:"1px solid #555" });
      sel.onchange = async () => { await this._loadPdfPage(parseInt(sel.value)); };
      wrap.appendChild(sel);

      const btnNext = document.createElement("button");
      btnNext.textContent = "▶";
      Object.assign(btnNext.style, this._pagerBtnStyle());
      btnNext.onclick = async () => {
        const next = Math.min(this._pdfPageCount || 1, (this._pdfCurrentPage || 1) + 1);
        await this._loadPdfPage(next);
      };
      wrap.appendChild(btnNext);

      const info = document.createElement("span");
      wrap.appendChild(info);
      document.body.appendChild(wrap);
      this._pdfPagerEl = wrap;
      this._pdfPagerSelect = sel;
      this._pdfPagerLabel = info;
    }

    this._pdfPagerEl.style.display = "flex";
    this._pdfPagerSelect.innerHTML = "";
    for (let i = 1; i <= pageCount; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = String(i);
      if (i === (this._pdfCurrentPage || 1)) opt.selected = true;
      this._pdfPagerSelect.appendChild(opt);
    }
    this._pdfPagerLabel.textContent = `/ ${pageCount}`;
  }

  _pagerBtnStyle() {
    return { width: "28px", height: "24px", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.25)", background: "rgba(255,255,255,0.12)", color: "#fff", cursor: "pointer", lineHeight: "22px" };
  }

  async _loadPdfPage(pageNo) {
    if (!this._pdfPlugin) return;
    pageNo = Math.max(1, Math.min(this._pdfPageCount || 1, pageNo));

    let didFinalFit = false;
    const onProgress = (evt) => { /* ... */ };

    await this._pdfPlugin.loadPage(pageNo, onProgress);
    
    this._pdfCurrentPage = pageNo;
    if (this._pdfPagerSelect) this._pdfPagerSelect.value = String(pageNo);
    this.viewer.enableRender?.();

    this._syncCurrentModel(this.currentFile, this.currentFileName);
    window.dispatchEvent(new CustomEvent("cad:pdf-page-changed", { detail: { page: pageNo, model: this.currentModel, models: this.currentModels } }));

    this._schedulePdfFit(260);
    this._tryFlattenCamera();
    
    // إذا كان الوضع "الأمان" مفعلاً، شغل المراقب. وإلا، إصلاح فوري فقط.
    if (this._useProgressiveMode) this._startContinuousFixer();
    else this._forceNoCulling();
  }

  _tryFlattenCamera() {
    try {
      const cam = this.viewer?.camera;
      if (cam) { cam.rotation.set(0, 0, 0); cam.up.set(0, 1, 0); }
      const controls = this.viewer?.controls;
      if (controls) { controls.enableRotate = false; controls.update(); }
    } catch (_) {}
  }

  _schedulePdfFit(delayMs = 200) {
    if (this._pdfFitTimer) clearTimeout(this._pdfFitTimer);
    this._pdfFitTimer = setTimeout(() => { this._fitPdfViewport(); }, delayMs);
  }

  _startContinuousFixer() {
    this._stopContinuousFixer();
    this._fixInterval = setInterval(() => { this._forceNoCulling(); }, this._isAppleMobile ? 900 : 500);
    this._forceNoCulling();
  }

  _stopContinuousFixer() {
    if (this._fixInterval) { clearInterval(this._fixInterval); this._fixInterval = null; }
  }

  _forceNoCulling() {
    try {
      const scene = this.viewer.scene || (this.viewer.getScene && this.viewer.getScene());
      if (!scene) return;

      let touched = 0;
      scene.traverse((obj) => {
        if (obj.isMesh || obj.isLine) {
          obj.frustumCulled = false;
          if (obj.material) {
             obj.material.transparent = true;
             obj.material.depthWrite = false; 
             obj.material.depthTest = true;
             
             if (obj.material.polygonOffset !== true) {
                 obj.material.polygonOffset = true;
                 obj.material.polygonOffsetFactor = -1.0;
                 obj.material.polygonOffsetUnits = -4.0;
                 obj.material.needsUpdate = true;
             }
             touched++;
          }
        }
      });
      if (touched && this.viewer.enableRender) this.viewer.enableRender();
    } catch (_) {}
  }

  _fitPdfViewport() {
    try {
      this._forceNoCulling();
      if (!this._pdfPlugin) return;
      const box = this._pdfPlugin.getPdfViewport?.();
      if (!box) return;

      const center = new THREE.Vector3();
      const size = new THREE.Vector3();
      box.getCenter(center); box.getSize(size);

      const cam = this.viewer?.camera;
      if (!cam) return;
      cam.up.set(0, 1, 0);
      cam.near = 0.01; cam.far = 1e9;
      
      const el = document.getElementById(this.containerId);
      const w = el?.clientWidth || 1; const h = el?.clientHeight || 1;

      if (cam.isPerspectiveCamera) {
        const maxDim = Math.max(size.x, size.y);
        const fov = (cam.fov * Math.PI) / 180;
        const dist = (maxDim / 2) / Math.tan(fov / 2);
        cam.position.set(center.x, center.y, dist * 1.2);
        cam.lookAt(center);
      } else if (cam.isOrthographicCamera) {
        cam.position.set(center.x, center.y, cam.position.z || 1000);
        cam.lookAt(center);
        const zx = w / (size.x || 1); const zy = h / (size.y || 1);
        cam.zoom = Math.min(zx, zy) * 0.9;
      }
      cam.updateProjectionMatrix?.();
      
      const controls = this.viewer?.controls;
      if (controls) { controls.enableRotate = false; controls.update(); }
      this.viewer.enableRender?.();
    } catch (_) {}
  }


  _syncCurrentModel(file = null, fileName = null) {
    try {
      this.currentFile = file || this.currentFile || this.uploader?.file || null;
      this.currentFileName = fileName || this.currentFile?.name || this.uploader?.file?.name || null;
      this.currentModels = Array.isArray(this.viewer?.loadedModels) ? this.viewer.loadedModels.slice() : [];
      this.currentModel = this.currentModels[this.currentModels.length - 1] || null;

      window.dispatchEvent(new CustomEvent("cad:model-ready", {
        detail: {
          app: this,
          viewer: this.viewer,
          file: this.currentFile,
          fileName: this.currentFileName,
          model: this.currentModel,
          models: this.currentModels,
        }
      }));

      // Secondary PDF content recognition:
      // If x-viewer exposes only one model layer, this extracts embedded text/images as semantic layers.
      if (/\.pdf$/i.test(String(this.currentFileName || ""))) {
        this.contentRecognition?.recognizeCurrentFile?.({
          file: this.currentFile,
          fileName: this.currentFileName,
          page: this._pdfCurrentPage || 1,
        });
      }
    } catch (err) {
      console.warn("[CADViewerApp] Failed to sync current model:", err);
    }
  }

  _detectAppleMobile() {
    const ua = navigator.userAgent || "";
    const platform = navigator.platform || "";
    return /iPad|iPhone|iPod/i.test(ua) || (platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  _detectAndroidTouch() {
    const ua = navigator.userAgent || "";
    return /Android/i.test(ua) && (navigator.maxTouchPoints || 0) > 0;
  }

  _getPdfRenderScale(useProgressive) {
    if (this._isAppleMobile) return useProgressive ? 1.35 : 1.75;
    if (this._isAndroidTouch) return useProgressive ? 1.75 : 2.4;
    return useProgressive ? 2.0 : 3.0;
  }

  openFileUpload() {
    if (this.uploader) this.uploader.openFileBrowserToUpload();
  }
}
