// InteractionManager.js
import { THREE, THREEAddons } from '@x-viewer/core';
const { XRControllerModelFactory } = THREEAddons;

export class InteractionManager {
    constructor(scene, camera, renderer, container, controls, dolly) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.container = container;
        this.controls = controls;
        this.dolly = dolly;

        // أدوات القياس
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.snapPoints = []; // سيتم تحديثها من SceneBuilder
        this.roomGroup = null; // سيتم تحديثه من SceneBuilder
        
        this.isMeasuring = false;
        this.measureStartPoint = new THREE.Vector3();
        this.savedMeasurements = [];
        this.activeLine = null;
        this.activeLabel = null;
        this.snapSphere = null;

        // أدوات الموبايل
        this.touchTimer = null;
        this.isTouchDragging = false;
        this.mobileCrosshair = document.getElementById('mobile-crosshair');

        // أدوات VR
        this.controller1 = null;
        this.controller2 = null;
        this.teleportMarker = null;
        this.activeController = null;
        this.isTeleporting = false;
        this.controllerState = { rightA: false };

        // تهيئة فورية
        this.setupMeasurementVisuals();
        this.setupEventListeners();
        this.setupVRControllers();
    }

    // --- تحديث البيانات القادمة من البناء ---
    updateTargets(roomGroup, snapPoints) {
        this.roomGroup = roomGroup;
        this.snapPoints = snapPoints;
    }

    // --- Setup Visuals ---
    setupMeasurementVisuals() {
        // Snap Sphere
        const snapGeo = new THREE.SphereGeometry(0.1, 16, 16);
        const snapMat = new THREE.MeshBasicMaterial({ color: 0xffff00, depthTest: false, transparent: true });
        this.snapSphere = new THREE.Mesh(snapGeo, snapMat);
        this.snapSphere.visible = false; 
        this.snapSphere.renderOrder = 999;
        this.scene.add(this.snapSphere);

        // Active Line (الخط المتحرك)
        const lineMat = new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 2, depthTest: false });
        const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
        this.activeLine = new THREE.Line(lineGeo, lineMat);
        this.activeLine.frustumCulled = false; 
        this.activeLine.visible = false; 
        this.activeLine.renderOrder = 998;
        this.scene.add(this.activeLine);

        // Active Label
        this.activeLabel = this.createTextSprite("0.00m");
        this.activeLabel.visible = false; 
        this.scene.add(this.activeLabel);
    }

    // --- PC & Mobile Events ---
    setupEventListeners() {
        const canvas = this.renderer.domElement;
        
        // PC Mouse
        canvas.addEventListener('pointermove', (e) => { 
            if(e.pointerType === 'mouse' && !this.renderer.xr.isPresenting) this.onPCMouseMove(e); 
        });
        canvas.addEventListener('pointerdown', (e) => { 
            if(e.pointerType === 'mouse' && !this.renderer.xr.isPresenting) this.onPCMouseDown(e); 
        });
        canvas.addEventListener('pointerup', (e) => { 
            if(e.pointerType === 'mouse' && !this.renderer.xr.isPresenting) this.onPCMouseUp(e); 
        });

        // Mobile Touch
        canvas.addEventListener('touchstart', (e) => this.onTouchStart(e), {passive: false});
        canvas.addEventListener('touchmove', (e) => this.onTouchMove(e), {passive: false});
        canvas.addEventListener('touchend', (e) => this.onTouchEnd(e));
    }

    // --- PC Logic ---
    onPCMouseMove(event) {
        this.updateRaycaster(event.clientX, event.clientY);
        this.handleHoverAndSnap();
        if(this.isMeasuring) this.updateActiveMeasurement(this.snapSphere.position);
    }
    onPCMouseDown(event) {
        if (event.button === 0) this.startMeasurement(this.snapSphere.position);
    }
    onPCMouseUp(event) {
        if (event.button === 0 && this.isMeasuring) this.endMeasurement(this.snapSphere.position);
    }

    // --- Mobile Logic ---
    onTouchStart(e) {
        if(e.touches.length > 1) { 
            clearTimeout(this.touchTimer); 
            this.isTouchDragging = false; 
            this.controls.enabled = true; 
            if(this.mobileCrosshair) this.mobileCrosshair.style.display = 'none'; 
            return; 
        }
        this.touchTimer = setTimeout(() => {
            this.isTouchDragging = true; 
            this.controls.enabled = false;
            if(this.mobileCrosshair) {
                this.mobileCrosshair.style.display = 'flex';
                this.mobileCrosshair.style.left = e.touches[0].clientX + 'px';
                this.mobileCrosshair.style.top = (e.touches[0].clientY - 70) + 'px';
            }
            this.updateRaycaster(e.touches[0].clientX, e.touches[0].clientY - 70); 
            this.handleHoverAndSnap();
        }, 400);
    }
    onTouchMove(e) {
        if(this.isTouchDragging) {
            e.preventDefault();
            if(this.mobileCrosshair) {
                this.mobileCrosshair.style.left = e.touches[0].clientX + 'px';
                this.mobileCrosshair.style.top = (e.touches[0].clientY - 70) + 'px';
            }
            this.updateRaycaster(e.touches[0].clientX, e.touches[0].clientY - 70); 
            this.handleHoverAndSnap();
            if(this.isMeasuring) this.updateActiveMeasurement(this.snapSphere.position);
        } else clearTimeout(this.touchTimer);
    }
    onTouchEnd(e) {
        clearTimeout(this.touchTimer); 
        if(this.mobileCrosshair) this.mobileCrosshair.style.display = 'none'; 
        this.controls.enabled = true;
        if(this.isTouchDragging) {
            this.isTouchDragging = false;
            if(!this.isMeasuring) this.startMeasurement(this.snapSphere.position);
            else this.endMeasurement(this.snapSphere.position);
        }
    }

    // --- Shared Helper Methods ---
    updateRaycaster(x, y) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((x - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((y - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.camera);
    }

    handleHoverAndSnap() {
        if(!this.roomGroup) return;
        const intersects = this.raycaster.intersectObjects(this.roomGroup.children); 
        let target = null; 
        
        if (intersects.length > 0) {
            target = intersects[0].point; 
        } else { 
            const floor = this.scene.getObjectByName('floor');
            if(floor) {
                const floorInt = this.raycaster.intersectObject(floor); 
                if(floorInt.length > 0) target = floorInt[0].point; 
            }
        } 
        
        if(target) { 
            const snapped = this.getClosestPoint(target, 0.4); 
            this.snapSphere.position.copy(snapped); 
            this.snapSphere.visible = true; 
            this.snapSphere.material.color.setHex(snapped === target ? 0xffff00 : 0xff0000); 
        } else {
            this.snapSphere.visible = false; 
        }
    }

    getClosestPoint(targetPoint, threshold = 0.5) { 
        let closest = null, minDst = threshold; 
        for(let p of this.snapPoints) { 
            const d = p.distanceTo(targetPoint); 
            if(d < minDst) { minDst = d; closest = p.clone(); } 
        } 
        return closest ? closest : targetPoint; 
    }

    // --- Measurement Logic ---
    startMeasurement(point) { 
        this.isMeasuring = true; 
        this.measureStartPoint.copy(point); 
        this.activeLine.geometry.setFromPoints([point, point]); 
        this.activeLine.visible = true; 
        this.activeLabel.visible = true; 
        this.activeLabel.position.copy(point).add(new THREE.Vector3(0, 0.2, 0)); 
        this.updateLabelText(this.activeLabel, "0.00m"); 
    }

    updateActiveMeasurement(currentPoint) { 
        this.activeLine.geometry.setFromPoints([this.measureStartPoint, currentPoint]); 
        this.activeLine.geometry.attributes.position.needsUpdate = true; 
        const dist = this.measureStartPoint.distanceTo(currentPoint); 
        const mid = new THREE.Vector3().addVectors(this.measureStartPoint, currentPoint).multiplyScalar(0.5); 
        this.activeLabel.position.copy(mid).add(new THREE.Vector3(0, 0.2, 0)); 
        this.updateLabelText(this.activeLabel, dist.toFixed(2) + "m"); 
    }

    endMeasurement(endPoint) { 
        if(!this.isMeasuring) return; 
        this.createPermanentMeasurement(this.measureStartPoint, endPoint); 
        this.isMeasuring = false; 
        this.activeLine.visible = false; 
        this.activeLabel.visible = false;
        // Trigger save callback if needed (usually handled by StorageManager calling save directly)
    }

    createPermanentMeasurement(p1, p2) { 
        const lineMat = new THREE.LineBasicMaterial({ color: 0x00ffff, linewidth: 2, depthTest: false }); 
        const lineGeo = new THREE.BufferGeometry().setFromPoints([p1, p2]); 
        const line = new THREE.Line(lineGeo, lineMat); 
        this.scene.add(line); 
        
        const dist = p1.distanceTo(p2); 
        const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5); 
        const label = this.createTextSprite(dist.toFixed(2) + "m", "#00ffff"); 
        label.position.copy(mid).add(new THREE.Vector3(0, 0.2, 0)); 
        this.scene.add(label); 
        
        this.savedMeasurements.push({ start: p1.clone(), end: p2.clone(), distance: dist, line: line, label: label }); 
    }

    undoLastMeasurement() { 
        if (this.savedMeasurements.length === 0) return; 
        const last = this.savedMeasurements.pop(); 
        this.scene.remove(last.line); 
        this.scene.remove(last.label); 
        last.line.geometry.dispose(); 
        last.line.material.dispose(); 
        last.label.material.map.dispose(); 
        last.label.material.dispose(); 
    }

    // --- Sprites & Text ---
    createTextSprite(message, color = "#00ff00") { 
        const canvas = document.createElement('canvas'); 
        const ctx = canvas.getContext('2d'); 
        canvas.width = 256; canvas.height = 128; 
        ctx.fillStyle = "rgba(0,0,0,0.7)"; 
        ctx.fillRect(0,0, 256, 128); 
        ctx.strokeStyle = color; 
        ctx.lineWidth = 4; 
        ctx.strokeRect(0,0, 256, 128); 
        ctx.font = "Bold 40px Arial"; 
        ctx.fillStyle = "white"; 
        ctx.textAlign = "center"; 
        ctx.textBaseline = "middle"; 
        ctx.fillText(message, 128, 64); 
        const texture = new THREE.CanvasTexture(canvas); 
        const spriteMat = new THREE.SpriteMaterial({ map: texture, depthTest: false }); 
        const sprite = new THREE.Sprite(spriteMat); 
        sprite.scale.set(1, 0.5, 1); 
        sprite.renderOrder = 1000; 
        return sprite; 
    }

    updateLabelText(sprite, text, color="#00ff00") { 
        const canvas = sprite.material.map.image; 
        const ctx = canvas.getContext('2d'); 
        ctx.clearRect(0,0,256,128); 
        ctx.fillStyle = "rgba(0,0,0,0.7)"; 
        ctx.fillRect(0,0, 256, 128); 
        ctx.strokeStyle = color; 
        ctx.strokeRect(0,0, 256, 128); 
        ctx.font = "Bold 40px Arial"; 
        ctx.fillStyle = "white"; 
        ctx.textAlign = "center"; 
        ctx.textBaseline = "middle"; 
        ctx.fillText(text, 128, 64); 
        sprite.material.map.needsUpdate = true; 
    }

    // --- VR Logic ---
    setupVRControllers() { 
        const markerGeo = new THREE.RingGeometry(0.1, 0.2, 32).rotateX(-Math.PI / 2); 
        const markerMat = new THREE.MeshBasicMaterial({ color: 0x00aaff }); 
        this.teleportMarker = new THREE.Mesh(markerGeo, markerMat); 
        this.teleportMarker.visible = false; 
        this.scene.add(this.teleportMarker); 
        
        this.controller1 = this.renderer.xr.getController(0); 
        this.controller2 = this.renderer.xr.getController(1); 
        
        const setupEvt = (ctlr) => { 
            ctlr.addEventListener('selectstart', (e) => this.onVRTriggerStart(e)); 
            ctlr.addEventListener('squeezestart', (e) => this.onVRGripStart(e)); 
            ctlr.addEventListener('squeezeend', (e) => this.onVRGripEnd(e)); 
            ctlr.add(new THREE.Line( new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,-5)]), new THREE.LineBasicMaterial({ color: 0xffffff }) )); 
            this.dolly.add(ctlr); 
        }; 
        setupEvt(this.controller1); 
        setupEvt(this.controller2); 
        
        const controllerModelFactory = new XRControllerModelFactory(); 
        const grip1 = this.renderer.xr.getControllerGrip(0); 
        grip1.add(controllerModelFactory.createControllerModel(grip1)); 
        const grip2 = this.renderer.xr.getControllerGrip(1); 
        grip2.add(controllerModelFactory.createControllerModel(grip2)); 
        this.dolly.add(grip1, grip2); 
    }

    onVRTriggerStart(event) { 
        this.activeController = event.target; 
        if(!this.isMeasuring) this.startMeasurement(this.snapSphere.position); 
        else this.endMeasurement(this.snapSphere.position); 
    }
    onVRGripStart(event) { 
        this.isTeleporting = true; 
        this.activeController = event.target; 
        this.teleportMarker.visible = true; 
    }
    onVRGripEnd(event) { 
        if(this.isTeleporting && this.teleportMarker.visible) this.dolly.position.copy(this.teleportMarker.position); 
        this.isTeleporting = false; 
        this.teleportMarker.visible = false; 
    }

    updateVR() { 
        if(!this.activeController) return; 
        
        const tempMatrix = new THREE.Matrix4(); 
        tempMatrix.identity().extractRotation(this.activeController.matrixWorld); 
        this.raycaster.ray.origin.setFromMatrixPosition(this.activeController.matrixWorld); 
        this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix); 
        
        if(this.isTeleporting) { 
            const floor = this.scene.getObjectByName('floor');
            if(floor) {
                const floorInt = this.raycaster.intersectObject(floor); 
                if(floorInt.length > 0) this.teleportMarker.position.copy(floorInt[0].point); 
                else this.teleportMarker.visible = false; 
            }
        } else { 
            this.handleHoverAndSnap(); 
            if(this.isMeasuring) this.updateActiveMeasurement(this.snapSphere.position); 
        } 
        
        const session = this.renderer.xr.getSession(); 
        if (session) { 
            for (const source of session.inputSources) { 
                if (source.handedness === 'right' && source.gamepad && source.gamepad.buttons.length > 4) { 
                    const aButton = source.gamepad.buttons[4]; 
                    if (aButton.pressed && !this.controllerState.rightA) { 
                        this.undoLastMeasurement(); 
                        this.controllerState.rightA = true; 
                    } else if (!aButton.pressed) { 
                        this.controllerState.rightA = false; 
                    } 
                } 
            } 
        } 
    }
}