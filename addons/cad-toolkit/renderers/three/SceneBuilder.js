// SceneBuilder.js (Performance Optimized + Lighting Ready)
import { THREE, THREEAddons } from '@x-viewer/core';
import { GeometryPreprocessor } from './GeometryPreprocessor.js';

const { BufferGeometryUtils } = THREEAddons;

export class SceneBuilder {
    constructor(scene) {
        this.scene = scene;
        this.snapPoints = [];
        this.roomGroup = new THREE.Group();
        this.preprocessor = new GeometryPreprocessor();
        this.snapPointKeys = new Set();
        this.lightCandidates = [];
    }

    build(data, layerConfig, globalSettings, forcedScale = 1.0) {
        if (this.roomGroup) this.scene.remove(this.roomGroup);
        this.roomGroup = new THREE.Group();
        this.roomGroup.name = 'cad-room-group';
        this.snapPoints = [];
        this.snapPointKeys = new Set();
        this.lightCandidates = [];

        const rawEntities = data.entities || [];
        const { entities, stats } = this.preprocessor.preprocessEntities(rawEntities);

        let currentHeight = globalSettings.height || 3.0;
        for (const layerName in layerConfig) {
            const conf = this.resolveConfig(layerConfig[layerName]);
            if (conf.type === 'wall' || conf.type === 'walls') {
                if (conf.height > currentHeight) currentHeight = conf.height;
            }
        }

        const bounds = this.computeBounds(entities, forcedScale);
        const cx = (bounds.minX + bounds.maxX) / 2;
        const cy = (bounds.minY + bounds.maxY) / 2;

        this.buildCeilingGrid(currentHeight, bounds);

        const materialsCache = new Map();
        const meshBatches = new Map();
        const lineBatches = new Map();

        entities.forEach((entity) => {
            const config = this.resolveConfig(layerConfig[entity.layer]);
            if (config.type === 'hide') return;

            const material = this.getOrCreateMaterial(materialsCache, entity.layer, config);
            const ctx = {
                cx,
                cy,
                config: { ...config, layerName: entity.layer },
                material,
                scale: forcedScale,
                height: currentHeight,
                thickness: (globalSettings.thickness || 0.2),
                meshBatches,
                lineBatches,
            };

            const verts = entity.points || entity.vertices;
            if (!verts || verts.length < 2) return;

            if (config.type === 'lights' || config.isLight) {
                this.processLightEntity(verts, ctx, entity);
                return;
            }

            if ((config.type === 'floor' || config.type === 'ceiling') && (entity.closed || entity.shape) && verts.length >= 3) {
                this.processSurfaceEntity(verts, ctx, entity);
            }

            for (let i = 0; i < verts.length - 1; i++) {
                this.processEntity(verts[i], verts[i + 1], ctx);
            }
            if (entity.closed || entity.shape) {
                this.processEntity(verts[verts.length - 1], verts[0], ctx);
            }
        });

        this.flushMeshBatches(meshBatches);
        this.flushLineBatches(lineBatches);

        this.roomGroup.userData.buildStats = {
            ...stats,
            meshBatchCount: meshBatches.size,
            lineBatchCount: lineBatches.size,
            snapPoints: this.snapPoints.length,
            lightCandidates: this.lightCandidates.length,
        };
        this.roomGroup.userData.bounds = bounds;

        this.scene.add(this.roomGroup);

        console.info('[SceneBuilder] Optimized build stats:', this.roomGroup.userData.buildStats);

        return {
            roomGroup: this.roomGroup,
            snapPoints: this.snapPoints,
            finalHeight: currentHeight,
            buildStats: this.roomGroup.userData.buildStats,
            bounds,
            lightCandidates: [...this.lightCandidates],
        };
    }

    getOrCreateMaterial(cache, layerName, config) {
        const matKey = `${layerName}-${config.type || 'default'}-${config.color || '#cccccc'}-${config.opacity ?? ''}-${config.emissive ?? ''}`;
        if (!cache.has(matKey)) {
            cache.set(matKey, this.createMaterial(config));
        }
        return cache.get(matKey);
    }

    resolveConfig(config = {}) {
        return config?.overrides ? { ...config, ...config.overrides } : { ...config };
    }

    computeBounds(entities, scale) {
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;

        entities.forEach((entity) => {
            const verts = entity.points || entity.vertices;
            if (!verts || verts.length === 0) return;
            verts.forEach((v) => {
                const x = v.x * scale;
                const y = v.y * scale;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            });
        });

        if (minX === Infinity) {
            minX = 0;
            maxX = 0;
            minY = 0;
            maxY = 0;
        }

        return { minX, maxX, minY, maxY };
    }


    processLightEntity(verts, ctx, entity = {}) {
        const closed = !!(entity.closed || entity.shape);
        for (let i = 0; i < verts.length - 1; i++) {
            this.processEntity(verts[i], verts[i + 1], ctx);
        }
        if (closed) {
            this.processEntity(verts[verts.length - 1], verts[0], ctx);
        }

        const spacingBase = Math.max(0.9, ctx.config.lightSpacing ?? ctx.config.spacing ?? 2.4);
        const drop = ctx.config.lightDrop ?? Math.max(0.18, (ctx.config.thickness || 0.1) * 0.8);
        let carry = spacingBase * 0.5;
        let added = 0;

        const collect = (a, b) => {
            const x1 = (a.x * ctx.scale) - ctx.cx;
            const z1 = -((a.y * ctx.scale) - ctx.cy);
            const x2 = (b.x * ctx.scale) - ctx.cx;
            const z2 = -((b.y * ctx.scale) - ctx.cy);
            const dx = x2 - x1;
            const dz = z2 - z1;
            const dist = Math.hypot(dx, dz);
            if (dist <= 0.01) return;

            const dirX = dx / dist;
            const dirZ = dz / dist;
            const elevation = (ctx.config.elevation ?? ctx.height) - drop;
            const intensity = ctx.config.intensity ?? 2.0;
            const roomHeight = ctx.height || 3.0;
            const range = ctx.config.range ?? Math.max(3.2, Math.min(roomHeight * 1.35, 5.4));
            const color = ctx.config.color || '#ffffdd';
            const targetY = Math.max(0.1, elevation - Math.max(1.8, roomHeight * 0.85));

            let cursor = carry;
            while (cursor <= dist) {
                this.lightCandidates.push({
                    type: 'point',
                    x: x1 + dirX * cursor,
                    y: elevation,
                    z: z1 + dirZ * cursor,
                    intensity,
                    range,
                    color,
                    targetY,
                    dirX,
                    dirZ,
                    layer: ctx.config.layerName || entity.layer || 'lights',
                    source: 'strip',
                });
                added++;
                cursor += spacingBase;
            }
            carry = cursor - dist;
        };

        for (let i = 0; i < verts.length - 1; i++) collect(verts[i], verts[i + 1]);
        if (closed) collect(verts[verts.length - 1], verts[0]);

        if (!added && verts[0]) {
            const p = verts[0];
            this.lightCandidates.push({
                type: 'point',
                x: (p.x * ctx.scale) - ctx.cx,
                y: (ctx.config.elevation ?? ctx.height) - drop,
                z: -((p.y * ctx.scale) - ctx.cy),
                intensity: ctx.config.intensity ?? 2.0,
                range: ctx.config.range ?? Math.max(3.0, Math.min((ctx.height || 3.0) * 1.3, 5.0)),
                color: ctx.config.color || '#ffffdd',
                targetY: 0.1,
                layer: ctx.config.layerName || entity.layer || 'lights',
                source: 'pointFallback',
            });
            added++;
        }
    }

    processSurfaceEntity(verts, ctx) {
        const { cx, cy, config, material, scale, height, meshBatches } = ctx;
        const y = config.elevation ?? (config.type === 'ceiling' ? height : 0.02);
        const points2D = [];

        verts.forEach((p) => {
            const x = (p.x * scale) - cx;
            const z = -((p.y * scale) - cy);
            points2D.push(new THREE.Vector2(x, -z));
        });
        if (points2D.length < 3) return;

        const filtered = this.removeDuplicateShapePoints(points2D);
        if (filtered.length < 3) return;

        const shape = new THREE.Shape(filtered);
        const geometry = new THREE.ShapeGeometry(shape);
        geometry.rotateX(-Math.PI / 2);
        geometry.translate(0, y, 0);
        this.addMeshGeometry(meshBatches, material, geometry, `surface-${config.type}-${material.uuid}`);
    }

    removeDuplicateShapePoints(points) {
        const out = [];
        let prev = null;
        for (const p of points) {
            if (!prev || prev.distanceToSquared(p) > 1e-8) {
                out.push(p);
                prev = p;
            }
        }
        if (out.length > 2 && out[0].distanceToSquared(out[out.length - 1]) < 1e-8) out.pop();
        return out;
    }

    processEntity(p1, p2, ctx) {
        const { cx, cy, config, material, scale, height, thickness, meshBatches, lineBatches } = ctx;
        const x1 = (p1.x * scale) - cx;
        const z1 = -((p1.y * scale) - cy);
        const x2 = (p2.x * scale) - cx;
        const z2 = -((p2.y * scale) - cy);

        const dx = x2 - x1;
        const dz = z2 - z1;
        const dist = Math.hypot(dx, dz);
        if (dist <= 0.01) return;

        if (config.type === 'lights' || config.isLight) {
            const elev = config.elevation ?? height;
            const geo = new THREE.BoxGeometry(0.1, 0.05, dist);
            this.transformSegmentGeometry(geo, x1, z1, x2, z2, elev);
            this.addMeshGeometry(meshBatches, material, geo, `light-${material.uuid}`);
            return;
        }

        if (config.type === 'wall' || config.type === 'walls' || config.type === 'glass' || config.type === 'beams') {
            const h = config.height || height;
            const el = config.elevation || 0;
            const th = config.thickness || thickness;
            const geo = new THREE.BoxGeometry(th, h, dist);
            this.transformSegmentGeometry(geo, x1, z1, x2, z2, el + (h / 2));
            this.addMeshGeometry(meshBatches, material, geo, `${config.type}-${material.uuid}`);

            if (config.type !== 'glass') {
                this.addSnapPoint(x1, el, z1);
                this.addSnapPoint(x1, el + h, z1);
                this.addSnapPoint(x2, el, z2);
                this.addSnapPoint(x2, el + h, z2);
            }
            return;
        }

        if (config.type === 'floor' || config.type === 'ceiling') {
            const y = config.elevation ?? (config.type === 'ceiling' ? height : 0.05);
            this.addLineSegment(lineBatches, material, x1, y, z1, x2, y, z2);
        }
    }

    transformSegmentGeometry(geometry, x1, z1, x2, z2, y) {
        const midX = (x1 + x2) / 2;
        const midZ = (z1 + z2) / 2;
        const angle = Math.atan2(x2 - x1, z2 - z1);

        const matrix = new THREE.Matrix4();
        const position = new THREE.Vector3(midX, y, midZ);
        const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
        matrix.compose(position, quaternion, new THREE.Vector3(1, 1, 1));
        geometry.applyMatrix4(matrix);
    }

    addMeshGeometry(batches, material, geometry, batchKey) {
        geometry.computeVertexNormals();
        if (!batches.has(batchKey)) {
            batches.set(batchKey, { material, geometries: [] });
        }
        batches.get(batchKey).geometries.push(geometry);
    }

    addLineSegment(batches, material, x1, y1, z1, x2, y2, z2) {
        const batchKey = `line-${material.uuid}`;
        if (!batches.has(batchKey)) {
            batches.set(batchKey, { material, positions: [] });
        }
        const positions = batches.get(batchKey).positions;
        positions.push(x1, y1, z1, x2, y2, z2);
    }

    markMeshShadows(mesh, material) {
        const role = material.userData?.shadowRole || 'solid';
        mesh.userData.shadowRole = role;
        if (role === 'glass') {
            mesh.userData.allowCastShadow = false;
            mesh.userData.allowReceiveShadow = true;
            mesh.castShadow = false;
            mesh.receiveShadow = true;
            return;
        }
        if (role === 'surface') {
            mesh.userData.allowCastShadow = false;
            mesh.userData.allowReceiveShadow = true;
            mesh.castShadow = false;
            mesh.receiveShadow = true;
            return;
        }
        if (role === 'light') {
            mesh.userData.allowCastShadow = false;
            mesh.userData.allowReceiveShadow = false;
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            return;
        }
        mesh.userData.allowCastShadow = true;
        mesh.userData.allowReceiveShadow = true;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
    }

    flushMeshBatches(meshBatches) {
        meshBatches.forEach((batch) => {
            if (!batch.geometries.length) return;
            const merged = batch.geometries.length === 1
                ? batch.geometries[0]
                : BufferGeometryUtils.mergeGeometries(batch.geometries, false);
            const mesh = new THREE.Mesh(merged, batch.material);
            this.markMeshShadows(mesh, batch.material);
            this.roomGroup.add(mesh);
        });
    }

    flushLineBatches(lineBatches) {
        lineBatches.forEach((batch) => {
            if (!batch.positions.length) return;
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(batch.positions, 3));
            const line = new THREE.LineSegments(geometry, batch.material);
            line.userData.allowCastShadow = false;
            line.userData.allowReceiveShadow = false;
            this.roomGroup.add(line);
        });
    }

    addSnapPoint(x, y, z) {
        const key = `${x.toFixed(4)}|${y.toFixed(4)}|${z.toFixed(4)}`;
        if (this.snapPointKeys.has(key)) return;
        this.snapPointKeys.add(key);
        this.snapPoints.push(new THREE.Vector3(x, y, z));
    }

    buildCeilingGrid(height, bounds) {
        const oldGrid = this.scene.getObjectByName('ceilGrid');
        if (oldGrid) this.scene.remove(oldGrid);

        const spanX = Math.max(10, bounds.maxX - bounds.minX);
        const spanY = Math.max(10, bounds.maxY - bounds.minY);
        const size = Math.max(50, Math.ceil(Math.max(spanX, spanY) * 1.25));
        const divisions = Math.max(10, Math.min(300, Math.round(size / 2)));

        const ceilGrid = new THREE.GridHelper(size, divisions, 0x444444, 0x222222);
        ceilGrid.position.y = height;
        ceilGrid.name = 'ceilGrid';
        this.scene.add(ceilGrid);
    }

    createMaterial(config) {
        const color = config.color || '#cccccc';
        if (config.type === 'lights' || config.isLight) {
            const mat = new THREE.MeshStandardMaterial({
                color,
                emissive: color,
                emissiveIntensity: (config.intensity || 1) * 2,
                toneMapped: false,
            });
            mat.userData.shadowRole = 'light';
            return mat;
        }

        if (config.type === 'glass') {
            const mat = new THREE.MeshStandardMaterial({
                color,
                transparent: true,
                opacity: config.opacity ?? 0.28,
                roughness: 0.08,
                metalness: 0.02,
                side: THREE.DoubleSide,
            });
            mat.userData.shadowRole = 'glass';
            return mat;
        }

        if (config.type === 'floor' || config.type === 'ceiling') {
            const mat = new THREE.MeshStandardMaterial({
                color,
                roughness: config.type === 'floor' ? 0.92 : 0.85,
                metalness: 0.02,
                transparent: true,
                opacity: config.opacity ?? 0.8,
                side: THREE.DoubleSide,
            });
            mat.userData.shadowRole = 'surface';
            return mat;
        }

        const mat = new THREE.MeshStandardMaterial({
            color,
            roughness: 0.8,
            metalness: 0.03,
            side: THREE.DoubleSide,
        });
        mat.userData.shadowRole = 'solid';
        return mat;
    }

    fitCamera(camera, controls) {
        const box = new THREE.Box3().setFromObject(this.roomGroup);
        if (box.isEmpty()) return;
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);

        camera.position.set(center.x, maxDim, center.z + maxDim);
        camera.lookAt(center);
        if (controls) {
            controls.target.copy(center);
            controls.update();
        }
    }
}
