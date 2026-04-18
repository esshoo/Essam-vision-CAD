// اسم الملف: EssambabylonMeasureTool.js
// V8 - Final Combined Fix (Zero Lag + Mobile Touch + VR Support)

class EssambabylonMeasureTool {
    constructor(scene, camera, guiTexture) {
        this.scene = scene;
        this.camera = camera;
        this.adt = guiTexture;

        // الحالة العامة
        this.isActive = false;
        this.measureState = "IDLE";
        this.snapPoints = [];
        this.startPoint = null;
        this.tempLine = null;

        // متغيرات الموبايل واللمس
        this.pointerDownPos = null;
        this.touchTimer = null;
        this.isTouchMeasuring = false;
        this._touchPointers = new Set();
        this._activeTouchId = null;
        this._longPressMs = 350;
        this.mobileOffset = 80;

        // متغيرات النظارة VR
        this.xrHelper = null;

        // مقياس الرسم (لحل مشكلة الكرة العالقة في الكمبيوتر)
        this._sceneScaleHint = 1.0;

        // عنصر المؤشر (Crosshair)
        this.crosshair = document.getElementById("crosshair");
        if (this.crosshair) this.crosshair.style.display = "none";

        // إعداد الأدوات
        this._initMarker();
        this._initGroundHelper();
        this._setupInput();
        this._setupRenderLoop();
    }

    // --- إعدادات خارجية ---
    setSceneScaleHint(val) {
        const n = Number(val);
        if (isFinite(n) && n > 0) this._sceneScaleHint = n;
        this._updateMarkerSize();
    }

    setXRHelper(xr) {
        this.xrHelper = xr;
    }

    // --- التفعيل والتعطيل ---
    enable() {
        this.isActive = true;
        this.refreshSnapPoints();
        this._updateMarkerSize();
    }

    disable() {
        this.isActive = false;
        this._cancelTouchMeasure(true);
        this.snapMarker.isVisible = false;
        if (this.tempLine) {
            this.tempLine.dispose();
            this.tempLine = null;
        }
        this.measureState = "IDLE";
        if (this.crosshair) this.crosshair.style.display = "none";
    }

    refreshSnapPoints() {
        if (this.scene.metadata && this.scene.metadata.snapPoints) {
            this.snapPoints = this.scene.metadata.snapPoints;
        } else {
            this.snapPoints = [];
        }
    }

    // --- أدوات مساعدة ---
    _initMarker() {
        this.snapMarker = BABYLON.MeshBuilder.CreateSphere("marker", { diameter: 0.3 }, this.scene);
        const mMat = new BABYLON.StandardMaterial("m", this.scene);
        mMat.emissiveColor = BABYLON.Color3.Red();
        mMat.disableLighting = true;
        this.snapMarker.material = mMat;
        this.snapMarker.isVisible = false;
        this.snapMarker.isPickable = false;
    }

    _updateMarkerSize() {
        if (!this.snapMarker) return;
        const s = Math.max(0.05, 0.30 * this._sceneScaleHint);
        this.snapMarker.scaling.set(s, s, s);
    }

    _initGroundHelper() {
        this.groundHelper = BABYLON.MeshBuilder.CreateGround("groundHelper", { width: 10000, height: 10000 }, this.scene);
        this.groundHelper.position.y = -0.05;
        this.groundHelper.isVisible = false;
        this.groundHelper.isPickable = true;
    }

    _inXR() {
        return this.xrHelper && 
               this.xrHelper.baseExperience && 
               this.xrHelper.baseExperience.state === BABYLON.WebXRState.IN_XR;
    }

    // --- منطق الجذب (Snapping) ---
    _getSnapped(p) {
        let best = p.clone();
        
        // الحل لمشكلة التعليق في الكمبيوتر: تصغير المغناطيس حسب المقياس
        let minD = 0.4 * (this._sceneScaleHint || 1.0);
        
        let snapped = false;
        for (let sp of this.snapPoints) {
            const d = BABYLON.Vector3.Distance(p, sp);
            if (d < minD) {
                minD = d;
                best = sp.clone();
                snapped = true;
            }
        }
        return { p: best, snapped };
    }

    // --- تحديث مكان الكرة ---
    updateCursor(pickInfo) {
        let p = null;
        if (pickInfo && pickInfo.hit && pickInfo.pickedPoint) {
            p = pickInfo.pickedPoint;
        } else if (!this._inXR() && this.isActive) {
            // Fallback للماوس فقط (Intersection Plane)
            // لا نستخدم هذا في VR لتجنب المشاكل
            const ray = this.scene.createPickingRay(this.scene.pointerX, this.scene.pointerY, BABYLON.Matrix.Identity(), this.camera);
            const plane = BABYLON.Plane.FromPositionAndNormal(new BABYLON.Vector3(0, 0, 0), new BABYLON.Vector3(0, 1, 0));
            const dist = ray.intersectsPlane(plane);
            if (dist) p = ray.origin.add(ray.direction.scale(dist));
        }

        if (!p) {
            this.snapMarker.isVisible = false;
            return null;
        }

        const res = this._getSnapped(p);
        this.snapMarker.position.copyFrom(res.p);
        this.snapMarker.isVisible = true;
        this.snapMarker.material.emissiveColor = res.snapped ? BABYLON.Color3.Yellow() : BABYLON.Color3.Red();
        return res.p;
    }

    // --- تنفيذ القياس ---
    performAction() {
        if (!this.snapMarker.isVisible) return;
        const p = this.snapMarker.position.clone();

        if (this.measureState === "IDLE") {
            this.measureState = "MEASURING";
            this.startPoint = p;
            this.tempLine = BABYLON.MeshBuilder.CreateLines("temp", { points: [p, p], updatable: true }, this.scene);
            this.tempLine.color = BABYLON.Color3.Green();
        } else {
            this._createLabel(this.startPoint, p);
            this.measureState = "IDLE";
            if (this.tempLine) {
                this.tempLine.dispose();
                this.tempLine = null;
            }
        }
    }

    _createLabel(p1, p2) {
        const line = BABYLON.MeshBuilder.CreateLines("mLine", { points: [p1, p2] }, this.scene);
        line.color = new BABYLON.Color3(0, 1, 1);
        const dist = BABYLON.Vector3.Distance(p1, p2);

        const rect = new BABYLON.GUI.Rectangle();
        rect.width = "100px"; rect.height = "30px";
        rect.background = "rgba(0,0,0,0.7)"; rect.thickness = 0; rect.cornerRadius = 8;
        this.adt.addControl(rect);

        const label = new BABYLON.GUI.TextBlock();
        label.text = dist.toFixed(2) + "m";
        label.color = "white"; label.fontSize = 14; label.fontWeight = "bold";
        rect.addControl(label);
        rect.linkWithMesh(line); rect.linkOffsetY = -20;
    }

    // --- حلقة الرسم (تم تفريغها لحل اللاج) ---
    _setupRenderLoop() {
        this.scene.registerBeforeRender(() => {
            if (!this.isActive) return;

            // فقط رسم الخط الأخضر المتحرك (خفيف جداً)
            // تم إزالة حسابات Raycasting الثقيلة من هنا
            if (this.measureState === "MEASURING" && this.tempLine && this.snapMarker.isVisible) {
                this.tempLine = BABYLON.MeshBuilder.CreateLines(null, { points: [this.startPoint, this.snapMarker.position], instance: this.tempLine });
            }
        });
    }

    // --- معالجة المدخلات (القلب النابض) ---
_setupInput() {
        this.scene.onPointerObservable.add((pi) => {
            if (!this.isActive) return;

            const evt = pi.event;
            // بعض المتصفحات لا ترسل evt، نتأكد
            if (!evt && !pi.pickInfo) return; 

            const isTouch = (evt && evt.pointerType === "touch") || (pi.event && pi.event.pointerType === "touch");
            const pid = evt ? evt.pointerId : 0;

            // --- 1. عند الضغط (POINTERDOWN) ---
            if (pi.type === BABYLON.PointerEventTypes.POINTERDOWN) {
                if (isTouch && !this._inXR()) {
                    // >> موبايل <<
                    this._handleTouchDown(evt, pid);
                } else {
                    // >> كمبيوتر / نظارة <<
                    this.pointerDownPos = { x: this.scene.pointerX, y: this.scene.pointerY };
                    if (this._inXR()) {
                        this.performAction();
                    }
                }
            }

            // --- 2. عند التحرك (POINTERMOVE) ---
            else if (pi.type === BABYLON.PointerEventTypes.POINTERMOVE) {
                if (isTouch && !this._inXR()) {
                    // >> موبايل <<
                    this._handleTouchMove(evt, pid);
                } else {
                    // >> كمبيوتر (الحل هنا) <<
                    
                    // 1. هل البيانات جاهزة من Babylon؟ (النظارة توفرها دائماً)
                    let pick = pi.pickInfo;
                    
                    // 2. إذا لم تكن جاهزة (الكمبيوتر بسبب خاصية skipPointer)، نحسبها يدوياً
                    if ((!pick || !pick.hit) && !this._inXR()) {
                        pick = this.scene.pick(this.scene.pointerX, this.scene.pointerY);
                    }

                    // 3. تحديث الكرة
                    this.updateCursor(pick);
                }
            }

            // --- 3. عند الرفع (POINTERUP) ---
            else if (pi.type === BABYLON.PointerEventTypes.POINTERUP || pi.type === BABYLON.PointerEventTypes.POINTEROUT) {
                if (isTouch && !this._inXR()) {
                    // >> موبايل <<
                    this._handleTouchUp(pid);
                } else {
                    // >> كمبيوتر (كليك) <<
                    if (!this._inXR() && this.pointerDownPos) {
                        const dx = Math.abs(this.scene.pointerX - this.pointerDownPos.x);
                        const dy = Math.abs(this.scene.pointerY - this.pointerDownPos.y);
                        // إذا لم يتحرك الماوس كثيراً، نعتبرها نقرة
                        if (dx < 5 && dy < 5) this.performAction();
                        this.pointerDownPos = null;
                    }
                }
            }
        });
    }
    // --- دوال الموبايل المساعدة (داخل الكلاس) ---
    
    _handleTouchDown(evt, pid) {
        this._touchPointers.add(pid);
        if (this._touchPointers.size > 1) {
            this._cancelTouchMeasure(true);
            return;
        }

        this._activeTouchId = pid;
        this.pointerDownPos = { x: evt.clientX, y: evt.clientY };
        const startX = evt.clientX;
        const startY = evt.clientY;

        clearTimeout(this.touchTimer);
        this.touchTimer = setTimeout(() => {
            if (this._activeTouchId !== pid) return;
            if (this._touchPointers.size !== 1) return;

            this.isTouchMeasuring = true;
            this._showCrosshair(startX, startY);

            try { this.camera.detachControl(); } catch (e) {}

            const pick = this.scene.pick(startX, startY - this.mobileOffset);
            this.updateCursor(pick);
        }, this._longPressMs);
    }

    _handleTouchMove(evt, pid) {
        if (pid !== this._activeTouchId) return;
        if (this._touchPointers.size > 1) {
            this._cancelTouchMeasure(true);
            return;
        }

        if (this.isTouchMeasuring) {
            this._showCrosshair(evt.clientX, evt.clientY);
            const pick = this.scene.pick(evt.clientX, evt.clientY - this.mobileOffset);
            this.updateCursor(pick);
        } else if (this.pointerDownPos) {
            const dx = Math.abs(evt.clientX - this.pointerDownPos.x);
            const dy = Math.abs(evt.clientY - this.pointerDownPos.y);
            if (dx > 10 || dy > 10) {
                clearTimeout(this.touchTimer);
                this.touchTimer = null;
            }
        }
    }

    _handleTouchUp(pid) {
        this._touchPointers.delete(pid);
        if (pid !== this._activeTouchId) return;

        clearTimeout(this.touchTimer);
        this.touchTimer = null;

        if (this.isTouchMeasuring) {
            this.isTouchMeasuring = false;
            this._hideCrosshair();
            this.performAction();
            try { this.camera.attachControl(this.scene.getEngine().getRenderingCanvas(), true); } catch (e) {}
        }
        this.pointerDownPos = null;
        this._activeTouchId = null;
    }

    _cancelTouchMeasure(reattach) {
        clearTimeout(this.touchTimer);
        this.isTouchMeasuring = false;
        this._hideCrosshair();
        if (reattach) {
            try { this.camera.attachControl(this.scene.getEngine().getRenderingCanvas(), true); } catch (e) {}
        }
        this.pointerDownPos = null;
    }

    _showCrosshair(x, y) {
        if (this.crosshair) {
            this.crosshair.style.display = "block";
            this.crosshair.style.left = x + "px";
            this.crosshair.style.top = (y - this.mobileOffset) + "px";
        }
    }

    _hideCrosshair() {
        if (this.crosshair) this.crosshair.style.display = "none";
    }
}