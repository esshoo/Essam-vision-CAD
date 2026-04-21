// EssamEngine.js
import { THREE, THREEAddons } from '@x-viewer/core';
const { OrbitControls, VRButton, EffectComposer, RenderPass, UnrealBloomPass, OutputPass } = THREEAddons;

import { SceneBuilder } from './SceneBuilder.js';
import { InteractionManager } from './InteractionManager.js';
import { StorageManager } from './StorageManager.js';
import { ExportManager } from './ExportManager.js';

export class EssamEngine {
    constructor(containerSelector) {
        this.container = typeof containerSelector === 'string' ? document.querySelector(containerSelector) : document.body;
        if (!this.container) return;

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.composer = null;
        this.bloomPass = null;
        this.dolly = new THREE.Group();

        this.settings = { height: 3.0, thickness: 0.20 };
        this.visualSettings = {
            quality: 'medium',
            shadows: true,
            bloom: true,
            sunIntensity: 1.0,
            realLights: true,
            roomAwareLights: true,
            vrCurrentRoomLights: false,
            realLightCap: 32,
            realLightDensity: 1.0,
            realLightIntensityScale: 1.0,
        };

        this.sceneBuilder = null;
        this.interactionManager = null;
        this.storageManager = null;

        this.cachedDXF = null;
        this.cachedConfig = null;
        this.currentRoomGroup = null;
        this.floorShadowCatcher = null;
        this.skyPanel = null;
        this.sunControlPanel = null;
        this.generatedLights = [];
        this.currentLightCandidates = [];
        this.currentRoomZones = [];
        this.xrPerformanceActive = false;
        this.isMobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
        this.performancePanel = null;
        this.performanceContent = null;
        this.performanceVisible = true;
        this.performanceCollapsed = false;
        this.perfFrames = 0;
        this.perfFps = 0;
        this.perfLastTick = performance.now();
        this.perfLastRefresh = 0;
        this.perfRefreshMs = 600;
        this.currentVrRoomZoneId = null;
        this.lastVrRoomLightUpdate = 0;
        this.vrRoomLightRefreshMs = 180;
        this._tmpWorldPos = new THREE.Vector3();

        try {
            const savedVisible = localStorage.getItem('essam-3d-perf-visible');
            const savedCollapsed = localStorage.getItem('essam-3d-perf-collapsed');
            if (savedVisible !== null) this.performanceVisible = savedVisible === '1';
            if (savedCollapsed !== null) this.performanceCollapsed = savedCollapsed === '1';
        } catch (_) {}

        this.init();
    }

    init() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x111111);

        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 50000);
        this.camera.position.set(0, 50, 50);
        this.dolly.add(this.camera);
        this.scene.add(this.dolly);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.toneMapping = THREE.ReinhardToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        this.renderer.xr.enabled = true;
        this.renderer.xr.setReferenceSpaceType('local-floor');
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.shadowMap.autoUpdate = false;

        while (this.container.firstChild) this.container.removeChild(this.container.firstChild);
        this.container.appendChild(this.renderer.domElement);
        this.container.appendChild(VRButton.createButton(this.renderer));

        this.ambientLight = new THREE.HemisphereLight(0xffffff, 0x222222, 0.5);
        this.scene.add(this.ambientLight);

        this.sunLight = new THREE.DirectionalLight(0xffffff, 1.0);
        this.sunLight.position.set(-10, 50, 50);
        this.sunLight.castShadow = true;
        this.sunLight.shadow.bias = -0.00015;
        this.sunLight.shadow.normalBias = 0.35;
        this.scene.add(this.sunLight);
        this.scene.add(this.sunLight.target);

        this.createShadowCatcher();

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };

        this.setupPostProcessing();
        this.createSunControl();
        this.createPerformanceMonitor();

        this.sceneBuilder = new SceneBuilder(this.scene);
        this.interactionManager = new InteractionManager(
            this.scene,
            this.camera,
            this.renderer,
            this.container,
            this.controls,
            this.dolly
        );
        this.storageManager = new StorageManager(this.interactionManager);
        this.exportManager = new ExportManager();
        this.createExportButtons();

        window.addEventListener('resize', () => this.onResize());
        this.renderer.xr.addEventListener('sessionstart', () => this.handleXRSessionStart());
        this.renderer.xr.addEventListener('sessionend', () => this.handleXRSessionEnd());

        this.renderer.setAnimationLoop(() => this.render());
        this.applyQualityPreset(this.visualSettings.quality);
        this.onResize();
    }

    createShadowCatcher() {
        const floorGeo = new THREE.PlaneGeometry(10, 10);
        const floorMat = new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.18 });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = 0.001;
        floor.receiveShadow = true;
        floor.name = 'floorShadowCatcher';
        floor.visible = true;
        this.floorShadowCatcher = floor;
        this.scene.add(floor);
    }

    createSunControl() {
        const div = document.createElement('div');
        Object.assign(div.style, {
            position: 'absolute', top: '20px', right: '20px', zIndex: '10000',
            background: 'rgba(0,0,0,0.6)', padding: '10px', borderRadius: '8px',
            color: 'white', fontFamily: 'sans-serif', fontSize: '12px',
            border: '1px solid rgba(255,255,255,0.2)', backdropFilter: 'blur(4px)',
            minWidth: '220px'
        });
        div.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:8px;">
                <label style="font-weight:bold;">☀ Sun Power</label>
                <input data-role="sun" type="range" min="0" max="2" step="0.1" value="1.0" style="cursor:pointer; width:100%;">
                <label style="font-weight:bold; margin-top:4px;">🎛 Quality</label>
                <select data-role="quality" style="width:100%; padding:4px; background:#111; color:#fff; border:1px solid #444; border-radius:4px;">
                    <option value="low">Low</option>
                    <option value="medium" selected>Medium</option>
                    <option value="high">High</option>
                    <option value="vr">VR</option>
                </select>
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                    <input data-role="shadows" type="checkbox" checked>
                    <span>Enable Shadows</span>
                </label>
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                    <input data-role="bloom" type="checkbox" checked>
                    <span>Enable Bloom</span>
                </label>
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                    <input data-role="real-lights" type="checkbox" checked>
                    <span>Real Light Emitters</span>
                </label>
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                    <input data-role="room-aware-lights" type="checkbox" checked>
                    <span>Room-aware Lights</span>
                </label>
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                    <input data-role="vr-current-room-lights" type="checkbox">
                    <span>VR Current Room Lights</span>
                </label>
                <button data-role="perf-toggle" type="button" style="margin-top:6px; width:100%; padding:6px 8px; background:#1f2f46; color:#fff; border:1px solid #3f5b82; border-radius:4px; cursor:pointer;">📊 Monitor</button>
            </div>
        `;

        div.querySelector('[data-role="sun"]').oninput = (e) => this.updateSun(parseFloat(e.target.value));
        div.querySelector('[data-role="quality"]').onchange = (e) => this.applyQualityPreset(e.target.value);
        div.querySelector('[data-role="shadows"]').onchange = (e) => this.setShadowsEnabled(!!e.target.checked);
        div.querySelector('[data-role="bloom"]').onchange = (e) => this.setBloomEnabled(!!e.target.checked);
        div.querySelector('[data-role="real-lights"]').onchange = (e) => this.setRealLightsEnabled(!!e.target.checked);
        div.querySelector('[data-role="room-aware-lights"]').onchange = (e) => this.setRoomAwareLightsEnabled(!!e.target.checked);
        div.querySelector('[data-role="vr-current-room-lights"]').onchange = (e) => this.setVRCurrentRoomLightsEnabled(!!e.target.checked);
        div.querySelector('[data-role="perf-toggle"]').onclick = () => this.togglePerformanceMonitor();

        this.sunControlPanel = div;
        this.container.appendChild(div);
    }

    createPerformanceMonitor() {
        const panel = document.createElement('div');
        Object.assign(panel.style, {
            position: 'absolute',
            left: '20px',
            bottom: '20px',
            zIndex: '10000',
            width: '280px',
            maxWidth: 'calc(100vw - 40px)',
            background: 'rgba(0,0,0,0.72)',
            color: '#eaf3ff',
            border: '1px solid rgba(120,170,255,0.25)',
            borderRadius: '10px',
            backdropFilter: 'blur(6px)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            fontSize: '12px',
            overflow: 'hidden',
            display: this.performanceVisible ? 'block' : 'none',
            pointerEvents: 'auto',
        });

        const header = document.createElement('div');
        Object.assign(header.style, {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            padding: '8px 10px',
            background: 'rgba(255,255,255,0.06)',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            fontFamily: 'sans-serif',
        });

        const title = document.createElement('strong');
        title.textContent = '📊 Performance Monitor';
        title.style.fontSize = '12px';

        const actions = document.createElement('div');
        Object.assign(actions.style, { display: 'flex', gap: '6px', alignItems: 'center' });

        const collapseBtn = document.createElement('button');
        collapseBtn.type = 'button';
        collapseBtn.textContent = this.performanceCollapsed ? '▢' : '—';
        collapseBtn.title = this.performanceCollapsed ? 'Expand' : 'Collapse';
        collapseBtn.style.cssText = 'background:#1a2533;color:#fff;border:1px solid rgba(255,255,255,0.16);border-radius:4px;padding:2px 8px;cursor:pointer;';

        const hideBtn = document.createElement('button');
        hideBtn.type = 'button';
        hideBtn.textContent = '✕';
        hideBtn.title = 'Hide';
        hideBtn.style.cssText = 'background:#3a1f24;color:#fff;border:1px solid rgba(255,255,255,0.16);border-radius:4px;padding:2px 8px;cursor:pointer;';

        actions.appendChild(collapseBtn);
        actions.appendChild(hideBtn);
        header.appendChild(title);
        header.appendChild(actions);

        const content = document.createElement('div');
        Object.assign(content.style, {
            padding: '10px',
            lineHeight: '1.5',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            display: this.performanceCollapsed ? 'none' : 'block',
        });

        collapseBtn.onclick = () => {
            this.performanceCollapsed = !this.performanceCollapsed;
            collapseBtn.textContent = this.performanceCollapsed ? '▢' : '—';
            collapseBtn.title = this.performanceCollapsed ? 'Expand' : 'Collapse';
            content.style.display = this.performanceCollapsed ? 'none' : 'block';
            try { localStorage.setItem('essam-3d-perf-collapsed', this.performanceCollapsed ? '1' : '0'); } catch (_) {}
        };

        hideBtn.onclick = () => this.togglePerformanceMonitor(false);

        panel.appendChild(header);
        panel.appendChild(content);

        this.performancePanel = panel;
        this.performanceContent = content;
        this.container.appendChild(panel);
        this.updatePerformanceMonitor(true);
    }

    togglePerformanceMonitor(forceValue) {
        const next = typeof forceValue === 'boolean' ? forceValue : !this.performanceVisible;
        this.performanceVisible = next;
        if (this.performancePanel) {
            this.performancePanel.style.display = next ? 'block' : 'none';
        }
        try { localStorage.setItem('essam-3d-perf-visible', next ? '1' : '0'); } catch (_) {}
        this.updatePerformanceMonitor(true);
    }

    formatPerfNumber(value, digits = 0) {
        return Number.isFinite(value) ? Number(value).toFixed(digits) : '—';
    }

    collectPerformanceStats() {
        const renderInfo = this.renderer?.info?.render || {};
        const memoryInfo = this.renderer?.info?.memory || {};
        const sceneStats = {
            objects: 0,
            meshes: 0,
            visibleMeshes: 0,
            lines: 0,
            lights: 0,
        };

        if (this.currentRoomGroup) {
            this.currentRoomGroup.traverse((obj) => {
                sceneStats.objects++;
                if (obj.isMesh) {
                    sceneStats.meshes++;
                    if (obj.visible) sceneStats.visibleMeshes++;
                } else if (obj.isLine || obj.isLineSegments) {
                    sceneStats.lines++;
                }
            });
        }

        for (const obj of this.generatedLights || []) {
            if (obj?.isLight) sceneStats.lights++;
        }

        const buildStats = this.currentRoomGroup?.userData?.buildStats || {};
        const perfMemory = performance?.memory;
        return {
            fps: this.perfFps,
            quality: this.visualSettings?.quality || 'medium',
            xr: !!this.renderer?.xr?.isPresenting,
            pixelRatio: this.renderer?.getPixelRatio?.() || 1,
            calls: renderInfo.calls || 0,
            triangles: renderInfo.triangles || 0,
            linesRendered: renderInfo.lines || 0,
            pointsRendered: renderInfo.points || 0,
            geometries: memoryInfo.geometries || 0,
            textures: memoryInfo.textures || 0,
            scene: sceneStats,
            generatedLights: sceneStats.lights,
            lightCandidates: this.currentLightCandidates?.length || 0,
            roomZones: this.currentRoomZones?.length || 0,
            realLights: !!this.visualSettings?.realLights,
            roomAwareLights: !!this.visualSettings?.roomAwareLights,
            vrCurrentRoomLights: !!this.visualSettings?.vrCurrentRoomLights,
            activeVrRoomZoneId: this.currentVrRoomZoneId === '__fallback__' ? 'Outside/None' : (this.currentVrRoomZoneId || null),
            shadows: !!this.visualSettings?.shadows,
            bloom: !!this.visualSettings?.bloom,
            buildStats,
            jsHeapMb: perfMemory?.usedJSHeapSize ? perfMemory.usedJSHeapSize / (1024 * 1024) : null,
            jsHeapLimitMb: perfMemory?.jsHeapSizeLimit ? perfMemory.jsHeapSizeLimit / (1024 * 1024) : null,
        };
    }

    updatePerformanceMonitor(force = false) {
        if (!this.performancePanel || !this.performanceContent) return;
        if (!this.performanceVisible) return;
        const now = performance.now();
        if (!force && (now - this.perfLastRefresh) < this.perfRefreshMs) return;
        this.perfLastRefresh = now;

        const s = this.collectPerformanceStats();
        const build = s.buildStats || {};
        const lines = [
            `FPS: ${this.formatPerfNumber(s.fps, 1)}    XR: ${s.xr ? 'ON' : 'OFF'}    Quality: ${s.quality.toUpperCase()}`,
            `Draw Calls: ${s.calls}    Triangles: ${s.triangles.toLocaleString?.() || s.triangles}`,
            `Scene Meshes: ${s.scene.visibleMeshes}/${s.scene.meshes}    Lines: ${s.scene.lines}`,
            `Real Lights: ${s.generatedLights}/${s.lightCandidates}    Room-aware: ${s.roomAwareLights ? 'ON' : 'OFF'}    Zones: ${s.roomZones}`,
            `VR Current Room: ${s.vrCurrentRoomLights ? 'ON' : 'OFF'}    Active Zone: ${s.activeVrRoomZoneId || '—'}`,
            `Shadows: ${s.shadows ? 'ON' : 'OFF'}    Bloom: ${s.bloom ? 'ON' : 'OFF'}`,
            `GPU Geo/Tex: ${s.geometries}/${s.textures}    DPR: ${this.formatPerfNumber(s.pixelRatio, 2)}`,
        ];

        if (Number.isFinite(s.jsHeapMb)) {
            const heap = `${this.formatPerfNumber(s.jsHeapMb, 1)} MB`;
            const limit = Number.isFinite(s.jsHeapLimitMb) ? ` / ${this.formatPerfNumber(s.jsHeapLimitMb, 0)} MB` : '';
            lines.push(`JS Heap: ${heap}${limit}`);
        }

        if (Object.keys(build).length) {
            lines.push('— Build —');
            if (Number.isFinite(build.entitiesIn) || Number.isFinite(build.entitiesOut)) {
                lines.push(`Entities: ${build.entitiesOut ?? '—'} / ${build.entitiesIn ?? '—'}    Vertices: ${build.verticesOut ?? '—'} / ${build.verticesIn ?? '—'}`);
            }
            if (Number.isFinite(build.removedVertices)) {
                lines.push(`Removed Vertices: ${build.removedVertices}`);
            }
            if (Number.isFinite(build.meshBatchCount) || Number.isFinite(build.lineBatchCount)) {
                lines.push(`Batches M/L: ${build.meshBatchCount ?? '—'} / ${build.lineBatchCount ?? '—'}`);
            }
            if (Number.isFinite(build.snapPoints) || Number.isFinite(build.lightCandidates) || Number.isFinite(build.roomZones)) {
                lines.push(`Snap Points: ${build.snapPoints ?? '—'}    Light Candidates: ${build.lightCandidates ?? '—'}    Zones: ${build.roomZones ?? '—'}`);
            }
        }

        this.performanceContent.textContent = lines.join('\n');
    }


    getQualityConfig(preset) {
        const isMobile = this.isMobileDevice;
        const configs = {
            low:    { pixelRatio: isMobile ? 1 : 1.1, mapSize: 512, bloom: false, shadows: false, exposure: 0.98, realLights: false, lightCap: 0,  lightDensity: 0.0, lightIntensityScale: 0.0 },
            medium: { pixelRatio: isMobile ? 1 : 1.4, mapSize: 1024, bloom: true,  shadows: true,  exposure: 1.0,  realLights: true,  lightCap: isMobile ? 12 : 28, lightDensity: 1.0, lightIntensityScale: 1.0 },
            high:   { pixelRatio: isMobile ? 1.1 : 1.8, mapSize: 2048, bloom: true,  shadows: true,  exposure: 1.04, realLights: true,  lightCap: isMobile ? 20 : 48, lightDensity: 1.25, lightIntensityScale: 1.2 },
            vr:     { pixelRatio: 1,               mapSize: 512,  bloom: false, shadows: true,  exposure: 0.98, realLights: true,  lightCap: isMobile ? 4 : 8,  lightDensity: 0.35, lightIntensityScale: 0.85 },
        };
        return { ...(configs[preset] || configs.medium) };
    }

    getRuntimeAdjustedConfig(cfg) {
        if (!this.renderer?.xr?.isPresenting) return { ...cfg };
        const isMobile = this.isMobileDevice;
        return {
            ...cfg,
            pixelRatio: 1,
            mapSize: cfg.shadows ? Math.min(cfg.mapSize || 512, isMobile ? 512 : 1024) : 512,
            bloom: false,
            shadows: !!cfg.shadows,
            realLights: !!cfg.realLights,
            lightCap: cfg.realLights ? Math.max(1, Math.min(isMobile ? 4 : 8, Math.ceil((cfg.lightCap || 0) * 0.3))) : 0,
            lightDensity: cfg.realLights ? Math.min(0.45, cfg.lightDensity || 1) : 0,
            lightIntensityScale: cfg.realLights ? Math.min(0.9, cfg.lightIntensityScale || 1) : 0,
        };
    }

    handleXRSessionStart() {
        this.xrPerformanceActive = true;
        try { this.renderer.xr.setFoveation?.(1.0); } catch (_) {}
        this.applyQualityPreset(this.visualSettings.quality || 'medium');
        this.applyVRCurrentRoomLightBinding(true);
    }

    handleXRSessionEnd() {
        this.xrPerformanceActive = false;
        this.applyQualityPreset(this.visualSettings.quality || 'medium');
        this.applyVRCurrentRoomLightBinding(true);
    }

    invalidateShadows() {
        if (!this.renderer?.shadowMap?.enabled) return;
        this.renderer.shadowMap.needsUpdate = true;
    }

    updateSun(intensity) {
        this.visualSettings.sunIntensity = intensity;
        if (this.sunLight) this.sunLight.intensity = intensity;
        if (this.ambientLight) this.ambientLight.intensity = Math.max(0.15, intensity * 0.45);

        const val = Math.min(0.14, Math.max(0.03, intensity * 0.09));
        this.scene.background.setRGB(val, val, val);
    }

    applyQualityPreset(preset) {
        this.visualSettings.quality = preset;
        const baseCfg = this.getQualityConfig(preset);
        const cfg = this.getRuntimeAdjustedConfig(baseCfg);

        this.renderer.setPixelRatio(Math.min(cfg.pixelRatio, window.devicePixelRatio || 1));
        this.renderer.toneMappingExposure = cfg.exposure;
        this.setShadowMapSize(cfg.mapSize);
        this.setShadowsEnabled(cfg.shadows);
        this.setBloomEnabled(cfg.bloom);
        this.setRealLightBudget(cfg.lightCap, cfg.lightDensity, cfg.lightIntensityScale);
        this.setRealLightsEnabled(cfg.realLights);

        if (this.sunControlPanel) {
            const q = this.sunControlPanel.querySelector('[data-role="quality"]');
            const s = this.sunControlPanel.querySelector('[data-role="shadows"]');
            const b = this.sunControlPanel.querySelector('[data-role="bloom"]');
            const rl = this.sunControlPanel.querySelector('[data-role="real-lights"]');
            if (q) q.value = preset;
            if (s) s.checked = !!this.visualSettings.shadows;
            if (b) b.checked = !!this.visualSettings.bloom;
            const ral = this.sunControlPanel.querySelector('[data-role="room-aware-lights"]');
            const vrr = this.sunControlPanel.querySelector('[data-role="vr-current-room-lights"]');
            if (rl) rl.checked = !!this.visualSettings.realLights;
            if (ral) ral.checked = !!this.visualSettings.roomAwareLights;
            if (vrr) vrr.checked = !!this.visualSettings.vrCurrentRoomLights;
        }

        this.onResize();
    }

    setShadowMapSize(size) {
        if (!this.sunLight) return;
        if (this.sunLight.shadow.mapSize.width === size && this.sunLight.shadow.mapSize.height === size) return;
        this.sunLight.shadow.mapSize.set(size, size);
        if (this.sunLight.shadow.map) {
            this.sunLight.shadow.map.dispose();
            this.sunLight.shadow.map = null;
        }
        this.invalidateShadows();
    }

    setShadowsEnabled(enabled) {
        this.visualSettings.shadows = !!enabled;
        this.renderer.shadowMap.enabled = !!enabled;
        if (this.sunLight) this.sunLight.castShadow = !!enabled;
        if (this.floorShadowCatcher) this.floorShadowCatcher.visible = !!enabled;
        if (this.currentRoomGroup) {
            this.currentRoomGroup.traverse((obj) => {
                if (!obj.isMesh) return;
                if (obj.userData?.shadowRole === 'glass') {
                    obj.castShadow = false;
                    obj.receiveShadow = !!enabled;
                    return;
                }
                const allowCast = obj.userData?.allowCastShadow !== false;
                const allowReceive = obj.userData?.allowReceiveShadow !== false;
                obj.castShadow = !!enabled && allowCast;
                obj.receiveShadow = !!enabled && allowReceive;
                if (obj.material && 'needsUpdate' in obj.material) obj.material.needsUpdate = true;
            });
        }
        this.invalidateShadows();
    }


    setRealLightBudget(cap, density = 1.0, intensityScale = 1.0) {
        this.visualSettings.realLightCap = Math.max(0, Math.floor(cap || 0));
        this.visualSettings.realLightDensity = Math.max(0, density || 0);
        this.visualSettings.realLightIntensityScale = Math.max(0, intensityScale || 0);
        this.refreshGeneratedLights();
    }

    setRealLightsEnabled(enabled) {
        this.visualSettings.realLights = !!enabled;
        this.refreshGeneratedLights();
    }

    setRoomAwareLightsEnabled(enabled) {
        this.visualSettings.roomAwareLights = !!enabled;
        this.refreshGeneratedLights();
    }

    setVRCurrentRoomLightsEnabled(enabled) {
        this.visualSettings.vrCurrentRoomLights = !!enabled;
        this.applyVRCurrentRoomLightBinding(true);
        this.updatePerformanceMonitor(true);
    }

    clearGeneratedLights() {
        if (!this.generatedLights?.length) return;
        for (const light of this.generatedLights) {
            if (!light) continue;
            this.scene.remove(light);
        }
        this.generatedLights = [];
        this.currentVrRoomZoneId = null;
    }

    selectLightCandidates(candidates) {
        const density = this.visualSettings.realLightDensity ?? 1.0;
        const requested = Math.max(0, Math.floor((candidates?.length || 0) * density));
        const cap = this.visualSettings.realLightCap ?? requested;
        const target = Math.max(0, Math.min(cap, requested || 0, candidates?.length || 0));
        if (!target || !Array.isArray(candidates) || !candidates.length) return [];

        const roomAware = this.visualSettings.roomAwareLights !== false;
        if (!roomAware) {
            if (target >= candidates.length) return [...candidates];
            const selected = [];
            const step = candidates.length / target;
            for (let i = 0; i < target; i++) {
                const idx = Math.min(candidates.length - 1, Math.floor(i * step));
                selected.push(candidates[idx]);
            }
            return selected;
        }

        const grouped = new Map();
        const fallback = [];
        for (const candidate of candidates) {
            const zoneId = candidate?.roomZoneId;
            if (zoneId) {
                if (!grouped.has(zoneId)) grouped.set(zoneId, []);
                grouped.get(zoneId).push(candidate);
            } else {
                fallback.push(candidate);
            }
        }

        const buckets = [...grouped.values()].filter((arr) => arr.length);
        const selected = [];
        let round = 0;
        while (selected.length < target && buckets.length) {
            let progressed = false;
            for (const bucket of buckets) {
                if (round < bucket.length) {
                    selected.push(bucket[round]);
                    progressed = true;
                    if (selected.length >= target) break;
                }
            }
            if (!progressed) break;
            round++;
        }

        if (selected.length < target && fallback.length) {
            const need = target - selected.length;
            const step = fallback.length / need;
            for (let i = 0; i < need; i++) {
                const idx = Math.min(fallback.length - 1, Math.floor(i * step));
                selected.push(fallback[idx]);
            }
        }

        if (selected.length < target) {
            const remaining = candidates.filter((c) => !selected.includes(c));
            const need = target - selected.length;
            const step = remaining.length / Math.max(need, 1);
            for (let i = 0; i < need && remaining.length; i++) {
                const idx = Math.min(remaining.length - 1, Math.floor(i * step));
                selected.push(remaining[idx]);
            }
        }

        return selected.slice(0, target);
    }

    refreshGeneratedLights() {
        this.clearGeneratedLights();
        if (!this.visualSettings.realLights) return;
        const selected = this.selectLightCandidates(this.currentLightCandidates);
        const intensityScale = this.visualSettings.realLightIntensityScale ?? 1.0;
        const roomAware = this.visualSettings.roomAwareLights !== false;

        for (const candidate of selected) {
            const zone = roomAware ? candidate?.roomZone : null;
            const color = candidate.color || 0xffffdd;
            const baseIntensity = (candidate.intensity || 1.5) * intensityScale;

            if (zone) {
                const zoneFloorY = zone.floorY ?? 0;
                const zoneCeilingY = zone.ceilingY ?? candidate.y ?? 3;
                const verticalSpan = Math.max(1.8, zoneCeilingY - zoneFloorY);
                const distance = Math.max(2.2, Math.min(candidate.range || zone.recommendedLightRange || 4.2, zone.recommendedLightRange || (verticalSpan * 1.5)));
                const targetY = candidate.targetY ?? Math.max(zoneFloorY + 0.04, Math.min(zoneFloorY + 0.12, (candidate.y || zoneCeilingY) - 0.45));
                const angle = Math.max(Math.PI / 10, Math.min(candidate.spotAngle || zone.recommendedSpotAngle || (Math.PI / 4.6), Math.PI / 3.8));
                const light = new THREE.SpotLight(color, baseIntensity * 1.18, distance, angle, candidate.spotPenumbra ?? 0.38, 2.1);
                light.position.set(candidate.x || 0, candidate.y || 0, candidate.z || 0);
                light.castShadow = false;
                light.userData.generatedRealLight = true;
                light.userData.layer = candidate.layer || 'lights';
                light.userData.roomZoneId = zone.id || null;
                const target = new THREE.Object3D();
                target.position.set(
                    (candidate.x || 0) + ((candidate.dirX || 0) * 0.08),
                    targetY,
                    (candidate.z || 0) + ((candidate.dirZ || 0) * 0.08)
                );
                target.userData.generatedRealLightTarget = true;
                target.userData.roomZoneId = zone.id || null;
                this.scene.add(target);
                light.target = target;
                this.scene.add(light);
                this.generatedLights.push(light, target);
                continue;
            }

            const distance = Math.max(2.8, Math.min(candidate.range || 4.2, Math.max(4.6, (candidate.y || 3) * 1.45)));
            const targetY = candidate.targetY ?? Math.max(0.1, (candidate.y || 2.8) - Math.max(1.8, (this.settings?.height || 3.0) * 0.85));
            if (candidate.source === 'strip') {
                const light = new THREE.SpotLight(color, baseIntensity * 1.35, distance, Math.PI / 4.2, 0.65, 2.2);
                light.position.set(candidate.x || 0, candidate.y || 0, candidate.z || 0);
                light.castShadow = false;
                light.userData.generatedRealLight = true;
                light.userData.layer = candidate.layer || 'lights';
                const target = new THREE.Object3D();
                target.position.set(candidate.x || 0, targetY, candidate.z || 0);
                target.userData.generatedRealLightTarget = true;
                target.userData.roomZoneId = candidate?.roomZoneId || null;
                this.scene.add(target);
                light.target = target;
                this.scene.add(light);
                this.generatedLights.push(light, target);
            } else {
                const light = new THREE.PointLight(color, baseIntensity, Math.max(3.0, Math.min(distance, 5.5)), 2.4);
                light.position.set(candidate.x || 0, candidate.y || 0, candidate.z || 0);
                light.castShadow = false;
                light.userData.generatedRealLight = true;
                light.userData.layer = candidate.layer || 'lights';
                light.userData.roomZoneId = candidate?.roomZoneId || null;
                this.scene.add(light);
                this.generatedLights.push(light);
            }
        }
        this.applyVRCurrentRoomLightBinding(true);
    }


    findRoomZoneAt(x, z) {
        if (!Array.isArray(this.currentRoomZones) || !this.currentRoomZones.length) return null;
        let bestInside = null;
        let bestInsideArea = Infinity;
        let bestNear = null;
        let bestNearDist = Infinity;
        for (const zone of this.currentRoomZones) {
            if (!zone?.bounds) continue;
            if (this.isPointInsideZone(x, z, zone)) {
                if ((zone.area || Infinity) < bestInsideArea) {
                    bestInsideArea = zone.area || Infinity;
                    bestInside = zone;
                }
                continue;
            }
            const dx = x - (zone.centroid?.x || 0);
            const dz = z - (zone.centroid?.z || 0);
            const distSq = (dx * dx) + (dz * dz);
            if (distSq <= (zone.searchRadiusSq || Infinity) && distSq < bestNearDist) {
                bestNearDist = distSq;
                bestNear = zone;
            }
        }
        return bestInside || bestNear || null;
    }

    isPointInsideZone(x, z, zone) {
        if (!zone?.points?.length || !zone.bounds) return false;
        if (x < zone.bounds.minX || x > zone.bounds.maxX || z < zone.bounds.minZ || z > zone.bounds.maxZ) return false;
        let inside = false;
        const pts = zone.points;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            const xi = pts[i].x, zi = pts[i].z;
            const xj = pts[j].x, zj = pts[j].z;
            const intersect = ((zi > z) !== (zj > z)) && (x < ((xj - xi) * (z - zi)) / ((zj - zi) || 1e-8) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    applyVRCurrentRoomLightBinding(force = false) {
        const lights = this.generatedLights?.filter((obj) => obj?.isLight) || [];
        if (!lights.length) {
            this.currentVrRoomZoneId = null;
            return;
        }

        const active = !!(this.renderer?.xr?.isPresenting && this.visualSettings?.vrCurrentRoomLights);
        if (!active) {
            const changed = force || this.currentVrRoomZoneId !== null || lights.some((light) => light.visible === false);
            if (!changed) return;
            this.currentVrRoomZoneId = null;
            for (const light of lights) light.visible = true;
            this.updatePerformanceMonitor(true);
            return;
        }

        const now = performance.now();
        if (!force && (now - this.lastVrRoomLightUpdate) < this.vrRoomLightRefreshMs) return;
        this.lastVrRoomLightUpdate = now;

        const worldPos = this.camera.getWorldPosition(this._tmpWorldPos);
        const zone = this.findRoomZoneAt(worldPos.x, worldPos.z);
        const zoneId = zone?.id || '__fallback__';
        if (!force && zoneId === this.currentVrRoomZoneId) return;
        this.currentVrRoomZoneId = zoneId;

        for (const light of lights) {
            const lightZoneId = light.userData?.roomZoneId || null;
            light.visible = !lightZoneId || lightZoneId === zone?.id;
        }
        this.updatePerformanceMonitor(true);
    }

    setBloomEnabled(enabled) {
        this.visualSettings.bloom = !!enabled;
        if (this.bloomPass) {
            this.bloomPass.enabled = !!enabled;
            this.bloomPass.strength = enabled ? 1.2 : 0.0;
        }
    }

    updateShadowCatcher(bounds, targetHeight = 0) {
        if (!this.floorShadowCatcher || !bounds) return;
        const spanX = Math.max(10, bounds.maxX - bounds.minX);
        const spanY = Math.max(10, bounds.maxY - bounds.minY);
        const sizeX = spanX * 1.15;
        const sizeY = spanY * 1.15;
        this.floorShadowCatcher.geometry.dispose();
        this.floorShadowCatcher.geometry = new THREE.PlaneGeometry(sizeX, sizeY);
        this.floorShadowCatcher.position.set(0, 0.001, 0);

        const maxSpan = Math.max(sizeX, sizeY);
        const half = maxSpan * 0.75;
        this.sunLight.shadow.camera.left = -half;
        this.sunLight.shadow.camera.right = half;
        this.sunLight.shadow.camera.top = half;
        this.sunLight.shadow.camera.bottom = -half;
        this.sunLight.shadow.camera.near = 1;
        this.sunLight.shadow.camera.far = Math.max(200, targetHeight + maxSpan * 2);
        this.sunLight.shadow.camera.updateProjectionMatrix();
        this.invalidateShadows();
    }

    createExportButtons() {
        const div = document.createElement('div');
        Object.assign(div.style, {
            position: 'absolute', bottom: '20px', right: '20px', zIndex: '10000',
            display: 'flex', gap: '10px'
        });

        const btnGLB = document.createElement('button');
        btnGLB.textContent = '📥 Export GLB';
        Object.assign(btnGLB.style, {
            padding: '8px 12px', background: '#28a745', color: 'white', border: 'none',
            borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold', fontFamily: 'sans-serif'
        });
        btnGLB.onclick = () => {
            if (this.currentRoomGroup) {
                this.exportManager.exportGLB(this.currentRoomGroup);
            } else {
                alert('لا يوجد مجسم لتصديره حالياً.');
            }
        };

        const btnJSON = document.createElement('button');
        btnJSON.textContent = '📄 Export JSON';
        Object.assign(btnJSON.style, {
            padding: '8px 12px', background: '#17a2b8', color: 'white', border: 'none',
            borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold', fontFamily: 'sans-serif'
        });
        btnJSON.onclick = () => {
            if (this.cachedDXF) {
                this.exportManager.exportConfigJSON(this.cachedDXF, this.cachedConfig, this.settings);
            } else {
                alert('لم يتم تحميل ملف لتصدير بياناته.');
            }
        };

        div.appendChild(btnGLB);
        div.appendChild(btnJSON);
        this.container.appendChild(div);
    }

    buildSceneFromConfig(dxf, layerConfig, globalSettings, forcedScale = 1.0) {
        this.cachedDXF = dxf;
        this.cachedConfig = layerConfig;
        this.settings = { ...globalSettings };

        const result = this.sceneBuilder.build(dxf, layerConfig, globalSettings, forcedScale);
        this.currentRoomGroup = result.roomGroup;
        this.currentLightCandidates = Array.isArray(result.lightCandidates) ? result.lightCandidates : [];
        this.currentRoomZones = Array.isArray(result.roomZones) ? result.roomZones : [];
        this.settings.height = result.finalHeight;
        this.interactionManager.updateTargets(result.roomGroup, result.snapPoints);

        this.updateShadowCatcher(result.bounds, result.finalHeight);
        this.setShadowsEnabled(this.visualSettings.shadows);
        this.refreshGeneratedLights();
        this.invalidateShadows();

        if (!this.renderer.xr.isPresenting) {
            this.sceneBuilder.fitCamera(this.camera, this.controls);
        }
        this.storageManager.loadFromLocalStorage();

        const sunIntensity = globalSettings.sunIntensity !== undefined ? globalSettings.sunIntensity : this.visualSettings.sunIntensity;
        this.updateSun(sunIntensity);
        if (this.sunControlPanel) {
            const slider = this.sunControlPanel.querySelector('[data-role="sun"]');
            if (slider) slider.value = String(sunIntensity);
        }
        this.updatePerformanceMonitor(true);
    }

    setupPostProcessing() {
        const renderScene = new RenderPass(this.scene, this.camera);
        this.bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
        this.bloomPass.threshold = 0.95;
        this.bloomPass.strength = 1.2;
        this.bloomPass.radius = 0.3;
        const outputPass = new OutputPass();

        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(renderScene);
        this.composer.addPass(this.bloomPass);
        this.composer.addPass(outputPass);
    }

    onResize() {
        if (!this.container) return;
        this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        if (this.composer) this.composer.setSize(this.container.clientWidth, this.container.clientHeight);
    }

    render() {
        const now = performance.now();
        const delta = Math.max(0.0001, now - this.perfLastTick);
        this.perfLastTick = now;
        this.perfFrames += 1;
        if (!this.perfSampleStart) this.perfSampleStart = now;
        const sampleElapsed = now - this.perfSampleStart;
        if (sampleElapsed >= 500) {
            this.perfFps = (this.perfFrames * 1000) / sampleElapsed;
            this.perfFrames = 0;
            this.perfSampleStart = now;
        }

        if (this.renderer.xr.isPresenting) {
            this.interactionManager.updateVR();
            this.applyVRCurrentRoomLightBinding();
            this.renderer.render(this.scene, this.camera);
        } else {
            this.controls.update();
            if (this.composer) {
                this.composer.render();
            } else {
                this.renderer.render(this.scene, this.camera);
            }
        }

        this.updatePerformanceMonitor();
    }
}
