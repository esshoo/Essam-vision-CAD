
// اسم الملف: EssamBabylonBuilderjson.js (V6 - Performance Edition)
// - Batching walls/lines using Thin Instances (huge perf gain for big JSON)
// - Keeps diagonal wall rotation fix (no scene mirroring)
// - Real lights with spacing + max cap (prevents page kill)
// - Optional glow layer (low intensity) without changing geometry size
// - Exposes updateSunIntensity() for Day/Night slider

class EssamBabylonBuilder {
  constructor(scene) {
    this.scene = scene;
    this.mats = {};
    this._tempMatsByLayer = {};
    this.sunLight = null;
    this.hemiLight = null;

    this._boundsMin = { x: +Infinity, y: +Infinity, z: +Infinity };
    this._boundsMax = { x: -Infinity, y: -Infinity, z: -Infinity };
    this.totalThinInstances = 0;
    this.glowLayer = null;

    // Thin instance groups: key -> { proto: Mesh, matrices: number[] }
    this._groups = new Map();

    // Generated lights to dispose
    this._generatedLightNames = new Set();

    // Snap points (for measure tool or external usage)
    this.snapPoints = [];
    this.totalThinInstances = 0;
  }

  // --- Math helpers ---
  _pXZ(p, s) { return { x: p.x * s, z: p.y * s }; }
  _lenXZ(a, b) { return Math.hypot(b.x - a.x, b.z - a.z); }
  _midXZ(a, b) { return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }; }
  _angleXZ(a, b) { return Math.atan2(b.z - a.z, b.x - a.x); }

  _boundsReset() {
    this._boundsMin = { x: +Infinity, y: +Infinity, z: +Infinity };
    this._boundsMax = { x: -Infinity, y: -Infinity, z: -Infinity };
  }
  _boundsExpand(x, y, z) {
    const bMin = this._boundsMin, bMax = this._boundsMax;
    if (x < bMin.x) bMin.x = x;
    if (y < bMin.y) bMin.y = y;
    if (z < bMin.z) bMin.z = z;
    if (x > bMax.x) bMax.x = x;
    if (y > bMax.y) bMax.y = y;
    if (z > bMax.z) bMax.z = z;
  }
  _boundsExpandSegment(a, b, thickness, height, y0) {
    // rough bounds (good enough for camera fit and marker sizing)
    const pad = Math.max(0.001, thickness) * 0.6;
    const minX = Math.min(a.x, b.x) - pad;
    const maxX = Math.max(a.x, b.x) + pad;
    const minZ = Math.min(a.z, b.z) - pad;
    const maxZ = Math.max(a.z, b.z) + pad;
    const minY = y0;
    const maxY = y0 + height;
    this._boundsExpand(minX, minY, minZ);
    this._boundsExpand(maxX, maxY, maxZ);
  }


  // --- Materials ---
  _makeMaterial(name, spec) {
    const mat = new BABYLON.PBRMaterial(name, this.scene);
    mat.albedoColor = BABYLON.Color3.FromHexString(spec.color || "#ffffff");
    mat.roughness = spec.roughness ?? 0.85;
    mat.metallic = spec.metallic ?? 0.0;

    mat.alpha = spec.alpha ?? 1.0;
    if (mat.alpha < 1.0 || name.toLowerCase().includes("glass")) {
      mat.transparencyMode = BABYLON.PBRMaterial.PBRMATERIAL_ALPHABLEND;
      mat.backFaceCulling = false;
      mat.metallic = 0.1;
    }

    // Emissive (glow only, not real lighting)
    const emI = (spec.emissiveIntensity ?? spec.emissive ?? 0);
    if (emI > 0) {
      mat.emissiveColor = mat.albedoColor;
      mat.emissiveIntensity = emI;
    }
    return mat;
  }

  _getOrCreateMaterial(matName, layer, fallbackSpec) {
    if (this.mats[matName]) return this.mats[matName];

    // If matName isn't defined in json.materials, reuse one temp material per layer (NOT per segment)
    const key = `layer::${layer}::${matName}`;
    if (this._tempMatsByLayer[key]) return this._tempMatsByLayer[key];

    const tmp = this._makeMaterial(`temp_${layer}_${matName}`, fallbackSpec || {});
    this._tempMatsByLayer[key] = tmp;
    return tmp;
  }

  // --- Rules merger ---
  _mergeRule(json, entity) {
    const layerRule = json.rulesByLayer?.[entity.layer] || null;

    // default type
    let type = "lines";
    if (layerRule?.type) type = layerRule.type;
    else if (entity.kind === "POLYLINE") type = "walls";

    // Force light-shapes to be treated as lights even if their layer isn't mapped
    if (entity && (entity.isLightShape === true || entity.kind === "LIGHT_SHAPE")) {
      type = "lights";
    }

    const layerOv = layerRule?.overrides ? { ...layerRule.overrides } : {};
    // keep both fields for compatibility
    return { ...layerOv, type, _type: type };
  }

  // --- Cleanup ---
  _disposeGenerated() {
    // dispose generated meshes (thin prototypes + any generated meshes)
    for (let i = this.scene.meshes.length - 1; i >= 0; i--) {
      const m = this.scene.meshes[i];
      if (m?.metadata?.role === "generated") m.dispose();
    }

    // dispose generated lights only
    for (let i = this.scene.lights.length - 1; i >= 0; i--) {
      const l = this.scene.lights[i];
      if (l?.metadata?.role === "generated") l.dispose();
    }

    this._groups.clear();
    this._generatedLightNames.clear();
    this.snapPoints = [];
    if (!this.scene.metadata) this.scene.metadata = {};
    this.scene.metadata.snapPoints = this.snapPoints;
  }

  // --- Global lights ---
  _setupGlobalLights(intensity) {
    // remove our old global lights only
    for (let i = this.scene.lights.length - 1; i >= 0; i--) {
      const l = this.scene.lights[i];
      if (l && (l.name === "sun" || l.name === "hemi")) l.dispose();
    }

    // Hemisphere
    this.hemiLight = new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0, 1, 0), this.scene);
    this.hemiLight.intensity = intensity * 0.45;
    this.hemiLight.groundColor = new BABYLON.Color3(0.18, 0.18, 0.18);

    // Directional sun
    this.sunLight = new BABYLON.DirectionalLight("sun", new BABYLON.Vector3(-1, -2, -1), this.scene);
    this.sunLight.position = new BABYLON.Vector3(20, 40, 20);
    this.sunLight.intensity = intensity;
  }

  updateSunIntensity(val) {
    const v = Number(val);
    if (this.hemiLight) this.hemiLight.intensity = v * 0.45;
    if (this.sunLight) this.sunLight.intensity = v;

    // background a bit brighter with sun
    const bg = Math.max(0.03, Math.min(0.18, v * 0.08));
    this.scene.clearColor = new BABYLON.Color3(bg, bg, bg);
  }

  _ensureGlowLayer(enabled, intensity = 0.18) {
    if (!enabled) {
      if (this.glowLayer) { this.glowLayer.dispose(); this.glowLayer = null; }
      return;
    }
    if (!this.glowLayer) {
      this.glowLayer = new BABYLON.GlowLayer("glow", this.scene);
      this.glowLayer.blurKernelSize = 16; // small blur => doesn't look "thick"
    }
    this.glowLayer.intensity = intensity;
  }

  // --- Thin instance batching ---
  _ensureGroup(key, material) {
    let g = this._groups.get(key);
    if (g) return g;

    // One unit cube prototype per group
    const proto = BABYLON.MeshBuilder.CreateBox(`proto_${key}`, { size: 1 }, this.scene);
    proto.material = material;

    // Keep prototype at identity transform.
    // NOTE: Thin instance matrices are multiplied by the mesh world matrix,
    // so moving the prototype would offset ALL instances.

    // IMPORTANT: make thin instances pickable (for measuring / snapping on walls).
    // Controlled by json.settings.enablePicking (default true).
    proto.isPickable = !!this._enablePicking;
    // BabylonJS supports thinInstanceEnablePicking for thin-instance ray tests.
    // (If not present in the runtime version, this assignment is harmless.)
    proto.thinInstanceEnablePicking = !!this._enablePicking;
    proto.alwaysSelectAsActiveMesh = true;
    proto.metadata = { role: "generated", groupKey: key };

    g = { proto, matrices: [] };
    this._groups.set(key, g);
    return g;
  }

  _pushSegmentInstance(g, a, b, thickness, height, y0) {
    const L = this._lenXZ(a, b);
    if (L < 0.001) return { ok: false, L: 0, mid: null, yaw: 0 };

    const mid = this._midXZ(a, b);

    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const ang = this._angleXZ(a, b);

    // ✅ diagonal-only rotation fix (no mirroring)
    const yaw = (Math.abs(dx) > 1e-6 && Math.abs(dz) > 1e-6) ? -ang : ang;

    const pos = new BABYLON.Vector3(mid.x, y0 + height / 2, mid.z);
    const scl = new BABYLON.Vector3(L, height, thickness);
    const rotQ = BABYLON.Quaternion.FromEulerAngles(0, yaw, 0);

    const m = BABYLON.Matrix.Compose(scl, rotQ, pos);
    const arr = m.toArray();
    for (let i = 0; i < 16; i++) g.matrices.push(arr[i]);

    return { ok: true, L, mid, yaw };
  }

  _finalizeGroups() {
  this.totalThinInstances = 0;
  for (const g of this._groups.values()) {
    const count = Math.floor(g.matrices.length / 16);
    this.totalThinInstances += count;

    if (count === 0) continue;

    const buf = new Float32Array(g.matrices);
    g.proto.thinInstanceSetBuffer("matrix", buf, 16, false);

    // Ensure world matrix + bounds are updated (helps avoid "nothing visible" issues)
    g.proto.computeWorldMatrix(true);
    g.proto.thinInstanceRefreshBoundingInfo(true);
  }
}

  // --- Light creation (spaced + capped) ---
  _createPointLight(name, pos, color3, intensity, range) {
    const pl = new BABYLON.PointLight(name, pos, this.scene);
    pl.diffuse = color3;
    pl.intensity = intensity;
    pl.range = range;
    pl.falloffType = BABYLON.Light.FALLOFF_PHYSICAL;
    pl.metadata = { role: "generated" };
    return pl;
  }

  // --- Main build (sync, but fast due to batching) ---
  build(json) {
    this._disposeGenerated();
    this._boundsReset();

    // Picking for measurement (Thin Instances):
    // - enablePicking=true (default) makes walls/geometry pickable so the measure tool can snap on them
    // - set to false in JSON settings if you need maximum performance on very large scenes
    this._enablePicking = (json.settings?.enablePicking ?? true);

    const baseXY = (json.settings?.overrideMetersPerCadUnit ?? json.units?.metersPerCadUnit ?? 1.0);
    const globalScale = (json.settings?.globalScale ?? 1.0);
    const sXY = baseXY * globalScale;
    const sZ  = (json.units?.scaleZWithCadUnit ? baseXY : 1.0) * globalScale;
    const s = sXY; // point scaling (XZ)

    // Materials
    this.mats = {};
    this._tempMatsByLayer = {};
    if (json.materials) {
      for (const [k, v] of Object.entries(json.materials)) {
        this.mats[k] = this._makeMaterial(k, v);
      }
    }

    // Global lights + glow
    const sunIntensity = json.settings?.sunIntensity ?? 1.0;
    this._setupGlobalLights(sunIntensity);
    this.updateSunIntensity(sunIntensity);

    const glowEnabled = json.settings?.glowEnabled ?? true;
    const glowIntensity = json.settings?.glowIntensity ?? 0.18;
    this._ensureGlowLayer(glowEnabled, glowIntensity);

    // Settings for perf
    const maxRealLights = json.settings?.maxRealLights ?? 200; // hard cap
    const lightSpacing = (json.settings?.lightSpacingMeters ?? 2.5); // meters
    const createLights = (json.settings?.createRealLights ?? true);

    let createdLights = 0;

    // Accumulate light candidates with spacing
    const lightCandidates = []; // {pos:Vector3, color:Color3, intensity:number, range:number}

    if (!Array.isArray(json.entities)) return;

    // Build
    for (let ei = 0; ei < json.entities.length; ei++) {
      const e = json.entities[ei];
      const r = this._mergeRule(json, e);
      if (r.type === "hide") continue;

      // Determine material name
      let matName = "wall";
      if (r.type === "floor") matName = "floor";
      else if (r.type === "ceiling") matName = "ceiling";
      else if (r.type === "glass") matName = "glass";
      else if (r.type === "lights") matName = "light";
      else if (r.type === "beams") matName = "beam";

      // Force light for shapes
      if (e.isLightShape === true) { r.type = "lights"; matName = "light"; }

      const material = this._getOrCreateMaterial(matName, e.layer || "layer", r);

      // POLYLINE -> thin instances
      if (e.kind === "POLYLINE" && Array.isArray(e.points) && e.points.length >= 2) {
        const pts = e.points.map(p => this._pXZ(p, s));

        // Heights/thickness
        // IMPORTANT: lights often have no height -> default small like your original code
        let H = (r.height ?? (r.type === "lights" ? 0.05 : 3.0)) * sZ;
        let T = (r.thickness ?? (r.type === "lights" ? 0.1 : 0.2)) * sZ;
        let Y0 = (r.elevation ?? 0) * sZ;
        if (r.type === "lights") {
          // Always keep light geometry as a thin strip (do not become wall-height)
          const stripH = (json.settings?.lightGeometryHeight ?? 0.05) * sZ;
          H = stripH;
        }

        const groupKey = `${matName}`;
        const g = this._ensureGroup(groupKey, material);

        // snap points (lightweight): store polyline points only (not every vertex)
        // This keeps measure tool usable without exploding memory.
        for (let pi = 0; pi < pts.length; pi++) {
          this.snapPoints.push(new BABYLON.Vector3(pts[pi].x, Y0, pts[pi].z));
          this.snapPoints.push(new BABYLON.Vector3(pts[pi].x, Y0 + H, pts[pi].z));
        }

        // create instances per segment
        let distAcc = 0;
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i], b = pts[i + 1];
          const res = this._pushSegmentInstance(g, a, b, T, H, Y0);
          if (!res.ok) continue;
          this._boundsExpandSegment(a, b, T, H, Y0);

          // Real lights (spaced + capped) only for lights layer
          if (createLights && r.type === "lights" && createdLights < maxRealLights) {
            distAcc += res.L;
            if (distAcc >= lightSpacing) {
              distAcc = 0;

              const pos = new BABYLON.Vector3(res.mid.x, (Y0 - 0.5), res.mid.z);
              const intensity = (r.intensity ?? 2.0);
              const range = (r.range ?? Math.max(6.0, res.L * 2.0));
              lightCandidates.push({ pos, color: material.albedoColor, intensity, range });
              createdLights++;
            }
          }
        }
      }

      // POINT -> keep as small sphere + real point light (but capped)
      else if (e.kind === "POINT" && e.point) {
        const posXZ = this._pXZ(e.point, s);
        const y = ((r.elevation ?? 2.8)) * sZ;

        // sphere marker (very small)
        const sphere = BABYLON.MeshBuilder.CreateSphere(`${e.id || "P"}_bulb`, { diameter: 0.12 }, this.scene);
        sphere.position.set(posXZ.x, y, posXZ.z);
        sphere.material = material;
        sphere.isPickable = false;
        sphere.metadata = { role: "generated", layer: e.layer };

        if (createLights && createdLights < maxRealLights) {
          const name = `${e.id || "P"}_pl`;
          this._createPointLight(name, new BABYLON.Vector3(posXZ.x, y, posXZ.z), material.albedoColor, (r.intensity ?? 1.2), (r.range ?? 8.0));
          createdLights++;
        }

        this.snapPoints.push(new BABYLON.Vector3(posXZ.x, y, posXZ.z));
      }
    }

    // finalize thin instances
    this._finalizeGroups();
    // Save bounds for camera fit and measurement scaling
    const bMin = this._boundsMin, bMax = this._boundsMax;
    const dxB = (bMax.x - bMin.x), dyB = (bMax.y - bMin.y), dzB = (bMax.z - bMin.z);
    const diag = Math.hypot(dxB, dyB, dzB) || 1;
    this.scene.metadata = this.scene.metadata || {};
    this.scene.metadata.generatedBounds = { bMin, bMax, diag };


    // create the spaced lights (after groups)
    if (createLights) {
      for (let i = 0; i < lightCandidates.length; i++) {
        const c = lightCandidates[i];
        this._createPointLight(`strip_pl_${i}`, c.pos, c.color, c.intensity, c.range);
      }
    }


    // Compute simple bounds from snap points (helps auto-fit camera)
    this.bounds = null;
    if (this.snapPoints && this.snapPoints.length) {
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (let i = 0; i < this.snapPoints.length; i++) {
        const p = this.snapPoints[i];
        if (!p) continue;
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.z < minZ) minZ = p.z;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
        if (p.z > maxZ) maxZ = p.z;
      }
      if (isFinite(minX) && isFinite(maxX)) {
        const center = new BABYLON.Vector3((minX+maxX)/2, (minY+maxY)/2, (minZ+maxZ)/2);
        const size   = new BABYLON.Vector3(maxX-minX, maxY-minY, maxZ-minZ);
        this.bounds = { min: new BABYLON.Vector3(minX,minY,minZ), max: new BABYLON.Vector3(maxX,maxY,maxZ), center, size };
      }
    }
    // Expose bounds for camera fitting (works with thin instances)
    if (!this.scene.metadata) this.scene.metadata = {};
    if (this.bounds && this.bounds.center) {
      this.scene.metadata.generatedBounds = {
        min: this.bounds.min,
        max: this.bounds.max,
        center: this.bounds.center,
        size: this.bounds.size
      };
    }

    // Store snap points in scene metadata for measure tool
    if (!this.scene.metadata) this.scene.metadata = {};
    this.scene.metadata.snapPoints = this.snapPoints;

    // Scene perf hints (static scene)
    this.scene.skipPointerMovePicking = true;

    // Optional: freeze for extra FPS (uncomment if you don't animate meshes)
    // this.scene.freezeActiveMeshes();
  }
}


// --- Debug export ---
try { window.__ESSAM_BUILDER_VERSION = 'perf-v4-final'; } catch(e) {}
