// InteractionManager.js (v30 - Stable VR Navigation Fix)
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
        this.snapPoints = [];
        this.roomGroup = null;

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
        this.controllerState = { rightA: false, rightSnapTurn: 0, leftSnapTurn: 0 };
        this.walkSpeed = 2.0;
        this.turnStep = Math.PI / 10;
        this.thumbstickDeadzone = 0.18;
        this.lastVRFrameTime = performance.now();

        this.setupMeasurementVisuals();
        this.setupEventListeners();
        this.setupVRControllers();
    }

    updateTargets(roomGroup, snapPoints) {
        this.roomGroup = roomGroup;
        this.snapPoints = snapPoints;
    }

    setupMeasurementVisuals() {
        const snapGeo = new THREE.SphereGeometry(0.1, 16, 16);
        const snapMat = new THREE.MeshBasicMaterial({ color: 0xffff00, depthTest: false, transparent: true });
        this.snapSphere = new THREE.Mesh(snapGeo, snapMat);
        this.snapSphere.visible = false;
        this.snapSphere.renderOrder = 999;
        this.scene.add(this.snapSphere);

        const lineMat = new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 2, depthTest: false });
        const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
        this.activeLine = new THREE.Line(lineGeo, lineMat);
        this.activeLine.frustumCulled = false;
        this.activeLine.visible = false;
        this.activeLine.renderOrder = 998;
        this.scene.add(this.activeLine);

        this.activeLabel = this.createTextSprite('0.00m');
        this.activeLabel.visible = false;
        this.scene.add(this.activeLabel);
    }

    setupEventListeners() {
        const canvas = this.renderer.domElement;
        canvas.addEventListener('pointermove', (e) => {
            if (e.pointerType === 'mouse' && !this.renderer.xr.isPresenting) this.onPCMouseMove(e);
        });
        canvas.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'mouse' && !this.renderer.xr.isPresenting) this.onPCMouseDown(e);
        });
        canvas.addEventListener('pointerup', (e) => {
            if (e.pointerType === 'mouse' && !this.renderer.xr.isPresenting) this.onPCMouseUp(e);
        });

        canvas.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: false });
        canvas.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
        canvas.addEventListener('touchend', (e) => this.onTouchEnd(e));
    }

    onPCMouseMove(event) {
        this.updateRaycaster(event.clientX, event.clientY);
        this.handleHoverAndSnap();
        if (this.isMeasuring) this.updateActiveMeasurement(this.snapSphere.position);
    }
    onPCMouseDown(event) {
        if (event.button === 0) this.startMeasurement(this.snapSphere.position);
    }
    onPCMouseUp(event) {
        if (event.button === 0 && this.isMeasuring) this.endMeasurement(this.snapSphere.position);
    }

    onTouchStart(e) {
        if (e.touches.length > 1) {
            clearTimeout(this.touchTimer);
            this.isTouchDragging = false;
            this.controls.enabled = true;
            if (this.mobileCrosshair) this.mobileCrosshair.style.display = 'none';
            return;
        }
        this.touchTimer = setTimeout(() => {
            this.isTouchDragging = true;
            this.controls.enabled = false;
            if (this.mobileCrosshair) {
                this.mobileCrosshair.style.display = 'flex';
                this.mobileCrosshair.style.left = e.touches[0].clientX + 'px';
                this.mobileCrosshair.style.top = (e.touches[0].clientY - 70) + 'px';
            }
            this.updateRaycaster(e.touches[0].clientX, e.touches[0].clientY - 70);
            this.handleHoverAndSnap();
        }, 400);
    }
    onTouchMove(e) {
        if (this.isTouchDragging) {
            e.preventDefault();
            if (this.mobileCrosshair) {
                this.mobileCrosshair.style.left = e.touches[0].clientX + 'px';
                this.mobileCrosshair.style.top = (e.touches[0].clientY - 70) + 'px';
            }
            this.updateRaycaster(e.touches[0].clientX, e.touches[0].clientY - 70);
            this.handleHoverAndSnap();
            if (this.isMeasuring) this.updateActiveMeasurement(this.snapSphere.position);
        } else {
            clearTimeout(this.touchTimer);
        }
    }
    onTouchEnd() {
        clearTimeout(this.touchTimer);
        if (this.mobileCrosshair) this.mobileCrosshair.style.display = 'none';
        this.controls.enabled = true;
        if (this.isTouchDragging) {
            this.isTouchDragging = false;
            if (!this.isMeasuring) this.startMeasurement(this.snapSphere.position);
            else this.endMeasurement(this.snapSphere.position);
        }
    }

    updateRaycaster(x, y) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((x - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((y - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.camera);
    }

    handleHoverAndSnap() {
        if (!this.roomGroup) return;
        const intersects = this.raycaster.intersectObjects(this.roomGroup.children);
        let target = null;

        if (intersects.length > 0) {
            target = intersects[0].point;
        } else {
            const floor = this.scene.getObjectByName('floor') || this.scene.getObjectByName('floorShadowCatcher');
            if (floor) {
                const floorInt = this.raycaster.intersectObject(floor);
                if (floorInt.length > 0) target = floorInt[0].point;
            }
        }

        if (target) {
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
        for (const p of this.snapPoints) {
            const d = p.distanceTo(targetPoint);
            if (d < minDst) {
                minDst = d;
                closest = p.clone();
            }
        }
        return closest || targetPoint;
    }

    startMeasurement(point) {
        this.isMeasuring = true;
        this.measureStartPoint.copy(point);
        this.activeLine.geometry.setFromPoints([point, point]);
        this.activeLine.visible = true;
        this.activeLabel.visible = true;
        this.activeLabel.position.copy(point).add(new THREE.Vector3(0, 0.2, 0));
        this.updateLabelText(this.activeLabel, '0.00m');
    }

    updateActiveMeasurement(currentPoint) {
        this.activeLine.geometry.setFromPoints([this.measureStartPoint, currentPoint]);
        this.activeLine.geometry.attributes.position.needsUpdate = true;
        const dist = this.measureStartPoint.distanceTo(currentPoint);
        const mid = new THREE.Vector3().addVectors(this.measureStartPoint, currentPoint).multiplyScalar(0.5);
        this.activeLabel.position.copy(mid).add(new THREE.Vector3(0, 0.2, 0));
        this.updateLabelText(this.activeLabel, dist.toFixed(2) + 'm');
    }

    endMeasurement(endPoint) {
        if (!this.isMeasuring) return;
        this.createPermanentMeasurement(this.measureStartPoint, endPoint);
        this.isMeasuring = false;
        this.activeLine.visible = false;
        this.activeLabel.visible = false;
    }

    createPermanentMeasurement(p1, p2) {
        const lineMat = new THREE.LineBasicMaterial({ color: 0x00ffff, linewidth: 2, depthTest: false });
        const lineGeo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
        const line = new THREE.Line(lineGeo, lineMat);
        this.scene.add(line);

        const dist = p1.distanceTo(p2);
        const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
        const label = this.createTextSprite(dist.toFixed(2) + 'm', '#00ffff');
        label.position.copy(mid).add(new THREE.Vector3(0, 0.2, 0));
        this.scene.add(label);

        this.savedMeasurements.push({ start: p1.clone(), end: p2.clone(), distance: dist, line, label });
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

    createTextSprite(message, color = '#00ff00') {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 256;
        canvas.height = 128;
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(0, 0, 256, 128);
        ctx.strokeStyle = color;
        ctx.lineWidth = 4;
        ctx.strokeRect(0, 0, 256, 128);
        ctx.font = 'Bold 40px Arial';
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(message, 128, 64);
        const texture = new THREE.CanvasTexture(canvas);
        const spriteMat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
        const sprite = new THREE.Sprite(spriteMat);
        sprite.scale.set(1, 0.5, 1);
        sprite.renderOrder = 1000;
        return sprite;
    }

    updateLabelText(sprite, text, color = '#00ff00') {
        const canvas = sprite.material.map.image;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, 256, 128);
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(0, 0, 256, 128);
        ctx.strokeStyle = color;
        ctx.strokeRect(0, 0, 256, 128);
        ctx.font = 'Bold 40px Arial';
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 128, 64);
        sprite.material.map.needsUpdate = true;
    }

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
            ctlr.add(new THREE.Line(
                new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -5)]),
                new THREE.LineBasicMaterial({ color: 0xffffff })
            ));
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
        if (!this.isMeasuring) this.startMeasurement(this.snapSphere.position);
        else this.endMeasurement(this.snapSphere.position);
    }

    onVRGripStart(event) {
        this.isTeleporting = true;
        this.activeController = event.target;
        this.teleportMarker.visible = true;
    }

    onVRGripEnd() {
        if (this.isTeleporting && this.teleportMarker.visible) {
            const keepY = this.dolly.position.y;
            this.dolly.position.set(this.teleportMarker.position.x, keepY, this.teleportMarker.position.z);
        }
        this.isTeleporting = false;
        this.teleportMarker.visible = false;
    }

    getWalkableTargets() {
        const walkables = [];
        const floor = this.scene.getObjectByName('floor');
        const catcher = this.scene.getObjectByName('floorShadowCatcher');
        if (floor) walkables.push(floor);
        if (catcher) walkables.push(catcher);
        if (!walkables.length && this.roomGroup?.children?.length) {
            for (const child of this.roomGroup.children) {
                if (child?.isMesh) walkables.push(child);
            }
        }
        return walkables;
    }

    getPrimaryAxes(gamepad) {
        if (!gamepad?.axes?.length) return { x: 0, y: 0 };
        const axes = gamepad.axes;
        const pairs = [];
        if (axes.length >= 2) pairs.push([axes[0], axes[1]]);
        if (axes.length >= 4) pairs.push([axes[2], axes[3]]);
        let best = { x: 0, y: 0, mag: 0 };
        for (const [x, y] of pairs) {
            const mag = Math.hypot(x || 0, y || 0);
            if (mag > best.mag) best = { x: x || 0, y: y || 0, mag };
        }
        return { x: best.x, y: best.y };
    }

    applyDeadzone(v) {
        const dz = this.thumbstickDeadzone;
        if (Math.abs(v) <= dz) return 0;
        const sign = Math.sign(v);
        return sign * ((Math.abs(v) - dz) / (1 - dz));
    }

    applyVRLocomotion(deltaSec, inputSources) {
        if (!inputSources?.length || this.isTeleporting) return;
        let moveX = 0, moveY = 0, turnX = 0;
        for (const source of inputSources) {
            if (!source?.gamepad) continue;
            const axes = this.getPrimaryAxes(source.gamepad);
            if (source.handedness === 'left') {
                moveX = axes.x;
                moveY = axes.y;
            } else if (source.handedness === 'right') {
                turnX = axes.x;
            }
        }

        moveX = this.applyDeadzone(moveX);
        moveY = this.applyDeadzone(moveY);
        turnX = this.applyDeadzone(turnX);

        if (Math.abs(turnX) > 0.7) {
            const dir = turnX > 0 ? 1 : -1;
            const stateKey = dir > 0 ? 'rightSnapTurn' : 'leftSnapTurn';
            const otherKey = dir > 0 ? 'leftSnapTurn' : 'rightSnapTurn';
            if (!this.controllerState[stateKey]) {
                this.dolly.rotation.y -= dir * this.turnStep;
                this.controllerState[stateKey] = 1;
                this.controllerState[otherKey] = 0;
            }
        } else {
            this.controllerState.rightSnapTurn = 0;
            this.controllerState.leftSnapTurn = 0;
        }

        if (!moveX && !moveY) return;

        const step = this.walkSpeed * deltaSec;
        const forward = new THREE.Vector3();
        this.camera.getWorldDirection(forward);
        forward.y = 0;
        if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
        forward.normalize();
        const right = new THREE.Vector3(forward.z, 0, -forward.x).normalize();
        const delta = new THREE.Vector3();
        delta.addScaledVector(forward, -moveY * step);
        delta.addScaledVector(right, moveX * step);
        this.dolly.position.add(delta);
    }

    updateVR() {
        const now = performance.now();
        const deltaSec = Math.max(0.001, Math.min(0.05, (now - this.lastVRFrameTime) / 1000));
        this.lastVRFrameTime = now;

        const session = this.renderer.xr.getSession();
        const inputSources = session ? Array.from(session.inputSources || []) : [];
        this.applyVRLocomotion(deltaSec, inputSources);

        if (this.activeController) {
            const tempMatrix = new THREE.Matrix4();
            tempMatrix.identity().extractRotation(this.activeController.matrixWorld);
            this.raycaster.ray.origin.setFromMatrixPosition(this.activeController.matrixWorld);
            this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

            if (this.isTeleporting) {
                const targets = this.getWalkableTargets();
                if (targets.length) {
                    const floorInt = this.raycaster.intersectObjects(targets, false);
                    if (floorInt.length > 0) {
                        this.teleportMarker.position.copy(floorInt[0].point);
                        this.teleportMarker.visible = true;
                    } else {
                        this.teleportMarker.visible = false;
                    }
                } else {
                    this.teleportMarker.visible = false;
                }
            } else {
                this.handleHoverAndSnap();
                if (this.isMeasuring) this.updateActiveMeasurement(this.snapSphere.position);
            }
        }

        if (session) {
            for (const source of inputSources) {
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
