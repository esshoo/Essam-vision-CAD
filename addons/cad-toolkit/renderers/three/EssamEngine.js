// EssamEngine.js
import { THREE, THREEAddons } from '@x-viewer/core';
import { t } from '../../core/i18n.js';
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
            shadowLevel: 1.0,
            bloom: true,
            bloomLevel: 1.0,
            sunIntensity: 1.0,
            realLights: true,
            realLightsLevel: 1.0,
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
        this.xrPerformanceActive = false;
        this.isMobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
        this.performancePanel = null;
        this.performanceContent = null;
        this.performanceVisible = true;
        this.qualityConfig = null;
        this.sunControlRefs = {};
        this.performanceCollapsed = false;
        this.perfFrames = 0;
        this.perfFps = 0;
        this.perfLastTick = performance.now();
        this.perfLastRefresh = 0;
        this.perfRefreshMs = 600;
        this.lastVRLightsRefresh = 0;
        this.vrLightRefreshMs = 350;
        this.lastVRLightAnchor = new THREE.Vector3();
        this.currentGeneratedLightSignature = '';

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
            minWidth: '240px'
        });
        div.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:8px;">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
                    <label style="font-weight:bold;">☀ ${t('three.sunPower', 'قوة الشمس')}</label>
                    <span data-role="sun-value" style="color:#9ec8ff; font-weight:bold;">1.0x</span>
                </div>
                <input data-role="sun" type="range" min="0" max="2" step="0.05" value="1.0" style="cursor:pointer; width:100%;">

                <label style="font-weight:bold; margin-top:4px;">🎛 ${t('three.quality', 'الجودة')}</label>
                <select data-role="quality" style="width:100%; padding:4px; background:#111; color:#fff; border:1px solid #444; border-radius:4px;">
                    <option value="low">${t('quality.low','منخفض')}</option>
                    <option value="medium" selected>${t('quality.medium','متوسط')}</option>
                    <option value="high">${t('quality.high','عال')}</option>
                    <option value="vr">VR</option>
                </select>

                <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-top:4px;">
                    <label style="font-weight:bold;">🌑 ${t('three.shadows', 'الظلال')}</label>
                    <span data-role="shadows-value" style="color:#9ec8ff; font-weight:bold;">100%</span>
                </div>
                <input data-role="shadows" type="range" min="0" max="100" step="1" value="100" style="cursor:pointer; width:100%;">

                <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-top:4px;">
                    <label style="font-weight:bold;">✨ ${t('three.bloom', 'الوهج')}</label>
                    <span data-role="bloom-value" style="color:#9ec8ff; font-weight:bold;">100%</span>
                </div>
                <input data-role="bloom" type="range" min="0" max="200" step="1" value="100" style="cursor:pointer; width:100%;">

                <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-top:4px;">
                    <label style="font-weight:bold;">💡 ${t('three.realLights', 'الإضاءة الفعلية')}</label>
                    <span data-role="real-lights-value" style="color:#9ec8ff; font-weight:bold;">100%</span>
                </div>
                <input data-role="real-lights" type="range" min="0" max="150" step="1" value="100" style="cursor:pointer; width:100%;">

                <button data-role="perf-toggle" type="button" style="margin-top:6px; width:100%; padding:6px 8px; background:#1f2f46; color:#fff; border:1px solid #3f5b82; border-radius:4px; cursor:pointer;">📊 ${t('three.monitor', 'المراقبة')}</button>
            </div>
        `;

        this.sunControlRefs = {
            sun: div.querySelector('[data-role="sun"]'),
            sunValue: div.querySelector('[data-role="sun-value"]'),
            quality: div.querySelector('[data-role="quality"]'),
            shadows: div.querySelector('[data-role="shadows"]'),
            shadowsValue: div.querySelector('[data-role="shadows-value"]'),
            bloom: div.querySelector('[data-role="bloom"]'),
            bloomValue: div.querySelector('[data-role="bloom-value"]'),
            realLights: div.querySelector('[data-role="real-lights"]'),
            realLightsValue: div.querySelector('[data-role="real-lights-value"]'),
        };

        this.sunControlRefs.sun.oninput = (e) => this.updateSun(parseFloat(e.target.value));
        this.sunControlRefs.quality.onchange = (e) => this.applyQualityPreset(e.target.value);
        this.sunControlRefs.shadows.oninput = (e) => this.setShadowLevel((parseFloat(e.target.value) || 0) / 100);
        this.sunControlRefs.bloom.oninput = (e) => this.setBloomLevel((parseFloat(e.target.value) || 0) / 100);
        this.sunControlRefs.realLights.oninput = (e) => this.setRealLightsLevel((parseFloat(e.target.value) || 0) / 100);
        div.querySelector('[data-role="perf-toggle"]').onclick = () => this.togglePerformanceMonitor();

        this.sunControlPanel = div;
        this.container.appendChild(div);
        this.syncSunControlUI();
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
            realLights: !!this.visualSettings?.realLights,
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
            `Real Lights: ${s.generatedLights}/${s.lightCandidates} (${Math.round((this.visualSettings.realLightsLevel ?? 1) * 100)}%)    Shadows: ${s.shadows ? 'ON' : 'OFF'} (${Math.round((this.visualSettings.shadowLevel ?? 1) * 100)}%)    Bloom: ${s.bloom ? 'ON' : 'OFF'} (${Math.round((this.visualSettings.bloomLevel ?? 1) * 100)}%)`,
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
            if (Number.isFinite(build.snapPoints) || Number.isFinite(build.lightCandidates)) {
                lines.push(`Snap Points: ${build.snapPoints ?? '—'}    Light Candidates: ${build.lightCandidates ?? '—'}`);
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
            lightCap: cfg.realLights ? Math.max(2, Math.min(isMobile ? 6 : 12, Math.ceil((cfg.lightCap || 0) * 0.55))) : 0,
            lightDensity: cfg.realLights ? Math.min(0.75, Math.max(isMobile ? 0.5 : 0.6, cfg.lightDensity || 1)) : 0,
            lightIntensityScale: cfg.realLights ? Math.min(0.95, Math.max(0.7, cfg.lightIntensityScale || 1)) : 0,
        };
    }

    handleXRSessionStart() {
        this.xrPerformanceActive = true;
        this.lastVRLightsRefresh = 0;
        this.currentGeneratedLightSignature = '';
        this.lastVRLightAnchor.set(999999, 999999, 999999);
        try { this.renderer.xr.setFoveation?.(1.0); } catch (_) {}
        this.applyQualityPreset(this.visualSettings.quality || 'medium');
        this.updateDynamicVRLights(true);
    }

    handleXRSessionEnd() {
        this.xrPerformanceActive = false;
        this.lastVRLightsRefresh = 0;
        this.currentGeneratedLightSignature = '';
        this.applyQualityPreset(this.visualSettings.quality || 'medium');
    }

    clampRange(value, min, max) {
        return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
    }

    syncSunControlUI() {
        if (!this.sunControlRefs) return;
        const refs = this.sunControlRefs;
        if (refs.sun) refs.sun.value = String(this.clampRange(this.visualSettings.sunIntensity ?? 1, 0, 2));
        if (refs.sunValue) refs.sunValue.textContent = `${(this.visualSettings.sunIntensity ?? 1).toFixed(2)}x`;
        if (refs.quality) refs.quality.value = this.visualSettings.quality || 'medium';

        const shadowPct = Math.round(this.clampRange(this.visualSettings.shadowLevel ?? 1, 0, 1) * 100);
        const bloomPct = Math.round(this.clampRange(this.visualSettings.bloomLevel ?? 1, 0, 2) * 100);
        const lightPct = Math.round(this.clampRange(this.visualSettings.realLightsLevel ?? 1, 0, 1.5) * 100);

        if (refs.shadows) refs.shadows.value = String(shadowPct);
        if (refs.shadowsValue) refs.shadowsValue.textContent = shadowPct <= 0 ? 'Off' : `${shadowPct}%`;

        if (refs.bloom) refs.bloom.value = String(bloomPct);
        if (refs.bloomValue) refs.bloomValue.textContent = bloomPct <= 0 ? 'Off' : `${bloomPct}%`;

        if (refs.realLights) refs.realLights.value = String(lightPct);
        if (refs.realLightsValue) refs.realLightsValue.textContent = lightPct <= 0 ? 'Off' : `${lightPct}%`;
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
        this.syncSunControlUI();
    }

    applyQualityPreset(preset) {
        this.visualSettings.quality = preset;
        const baseCfg = this.getQualityConfig(preset);
        const cfg = this.getRuntimeAdjustedConfig(baseCfg);
        this.qualityConfig = { ...cfg };

        this.renderer.setPixelRatio(Math.min(cfg.pixelRatio, window.devicePixelRatio || 1));
        this.renderer.toneMappingExposure = cfg.exposure;

        this.setShadowLevel(this.visualSettings.shadowLevel ?? (cfg.shadows ? 1 : 0));
        this.setBloomLevel(this.visualSettings.bloomLevel ?? (cfg.bloom ? 1 : 0));
        this.setRealLightsLevel(this.visualSettings.realLightsLevel ?? (cfg.realLights ? 1 : 0));
        this.syncSunControlUI();
        this.onResize();
    }


    setShadowLevel(level) {
        const normalized = this.clampRange(level, 0, 1);
        this.visualSettings.shadowLevel = normalized;
        const cfg = this.qualityConfig || this.getRuntimeAdjustedConfig(this.getQualityConfig(this.visualSettings.quality || 'medium'));
        const maxMapSize = Math.max(512, cfg.mapSize || 1024);
        const mapSize = normalized <= 0.001 ? 512 : Math.round(512 + (maxMapSize - 512) * normalized);
        this.setShadowMapSize(mapSize);
        this.setShadowsEnabled(normalized > 0.001);
        if (this.floorShadowCatcher?.material) {
            this.floorShadowCatcher.material.opacity = normalized <= 0.001 ? 0 : (0.06 + normalized * 0.18);
            this.floorShadowCatcher.material.needsUpdate = true;
        }
        this.syncSunControlUI();
    }

    setBloomLevel(level) {
        const normalized = this.clampRange(level, 0, 2);
        this.visualSettings.bloomLevel = normalized;
        this.setBloomEnabled(normalized > 0.001);
        if (this.bloomPass) {
            this.bloomPass.strength = 1.2 * normalized;
            this.bloomPass.radius = 0.18 + Math.min(0.55, normalized * 0.18);
            this.bloomPass.threshold = Math.max(0.6, 1.02 - (Math.min(2, normalized) * 0.18));
        }
        this.syncSunControlUI();
    }

    setRealLightsLevel(level) {
        const normalized = this.clampRange(level, 0, 1.5);
        this.visualSettings.realLightsLevel = normalized;
        const cfg = this.qualityConfig || this.getRuntimeAdjustedConfig(this.getQualityConfig(this.visualSettings.quality || 'medium'));
        if (normalized <= 0.001) {
            this.setRealLightBudget(0, 0, 0);
            this.setRealLightsEnabled(false);
            this.syncSunControlUI();
            return;
        }

        const baseCap = Math.max(1, cfg.lightCap || 8);
        const baseDensity = Math.max(0.05, cfg.lightDensity || 0.35);
        const baseIntensity = Math.max(0.2, cfg.lightIntensityScale || 0.85);
        const cap = Math.max(1, Math.round(baseCap * normalized));
        const density = baseDensity * normalized;
        const intensityScale = baseIntensity * (0.3 + normalized * 0.7);
        this.setRealLightBudget(cap, density, intensityScale);
        this.setRealLightsEnabled(true);
        this.syncSunControlUI();
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

    clearGeneratedLights() {
        if (!this.generatedLights?.length) return;
        for (const light of this.generatedLights) {
            if (!light) continue;
            this.scene.remove(light);
        }
        this.generatedLights = [];
    }

    buildLightSelectionSignature(selected) {
        if (!selected?.length) return '';
        return selected
            .map((candidate) => [candidate.layer || '', (candidate.x || 0).toFixed(2), (candidate.y || 0).toFixed(2), (candidate.z || 0).toFixed(2)].join(':'))
            .join('|');
    }

    updateDynamicVRLights(force = false) {
        if (!this.renderer?.xr?.isPresenting || !this.visualSettings?.realLights || !this.currentLightCandidates?.length) return;
        if (!this.dolly) return;

        const now = performance.now();
        const anchor = new THREE.Vector3();
        this.dolly.getWorldPosition(anchor);
        const moved = this.lastVRLightAnchor.distanceToSquared(anchor);
        const refreshDue = force || this.lastVRLightsRefresh <= 0 || (now - this.lastVRLightsRefresh) >= this.vrLightRefreshMs || moved >= (0.85 * 0.85);
        if (!refreshDue) return;

        const selected = this.selectLightCandidates(this.currentLightCandidates);
        const signature = this.buildLightSelectionSignature(selected);
        if (!force && signature === this.currentGeneratedLightSignature && moved < (1.6 * 1.6)) {
            this.lastVRLightsRefresh = now;
            this.lastVRLightAnchor.copy(anchor);
            return;
        }

        this.currentGeneratedLightSignature = signature;
        this.lastVRLightsRefresh = now;
        this.lastVRLightAnchor.copy(anchor);
        this.refreshGeneratedLights();
    }

    selectLightCandidates(candidates) {
        const density = this.visualSettings.realLightDensity ?? 1.0;
        const requested = Math.max(0, Math.ceil((candidates?.length || 0) * density));
        const cap = this.visualSettings.realLightCap ?? requested;
        const target = Math.max(0, Math.min(cap, requested || 0, candidates?.length || 0));
        if (!candidates?.length || !target) return [];
        if (target >= candidates.length) return candidates.slice();

        if (this.renderer?.xr?.isPresenting && this.dolly) {
            const anchorPos = new THREE.Vector3();
            this.dolly.getWorldPosition(anchorPos);
            return candidates
                .map((candidate) => ({ candidate, d2: (candidate.x - anchorPos.x) ** 2 + (candidate.z - anchorPos.z) ** 2 }))
                .sort((a, b) => a.d2 - b.d2)
                .slice(0, target)
                .map((entry) => entry.candidate);
        }

        const selected = [];
        const step = candidates.length / target;
        for (let i = 0; i < target; i++) {
            const idx = Math.min(candidates.length - 1, Math.floor(i * step));
            selected.push(candidates[idx]);
        }
        return selected;
    }

    refreshGeneratedLights() {
        this.clearGeneratedLights();
        if (!this.visualSettings.realLights) {
            this.currentGeneratedLightSignature = '';
            return;
        }
        const selected = this.selectLightCandidates(this.currentLightCandidates);
        this.currentGeneratedLightSignature = this.buildLightSelectionSignature(selected);
        const intensityScale = this.visualSettings.realLightIntensityScale ?? 1.0;
        for (const candidate of selected) {
            const distance = Math.max(2.8, Math.min(candidate.range || 4.2, Math.max(4.6, (candidate.y || 3) * 1.45)));
            const targetY = candidate.targetY ?? Math.max(0.1, (candidate.y || 2.8) - Math.max(1.8, (this.settings?.height || 3.0) * 0.85));
            const color = candidate.color || 0xffffdd;
            const baseIntensity = (candidate.intensity || 1.5) * intensityScale;

            if (candidate.source === 'strip') {
                const light = new THREE.SpotLight(color, baseIntensity * 1.35, distance, Math.PI / 4.2, 0.65, 2.2);
                light.position.set(candidate.x || 0, candidate.y || 0, candidate.z || 0);
                light.castShadow = false;
                light.userData.generatedRealLight = true;
                light.userData.layer = candidate.layer || 'lights';
                const target = new THREE.Object3D();
                target.position.set(candidate.x || 0, targetY, candidate.z || 0);
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
                this.scene.add(light);
                this.generatedLights.push(light);
            }
        }
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
            this.updateDynamicVRLights();
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
