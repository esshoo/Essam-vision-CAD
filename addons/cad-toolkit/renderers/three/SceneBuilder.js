// SceneBuilder.js (Universal Version)
import { THREE } from '@x-viewer/core';

export class SceneBuilder {
    constructor(scene) {
        this.scene = scene;
        this.snapPoints = [];
        this.roomGroup = new THREE.Group();
    }

    build(data, layerConfig, globalSettings, forcedScale = 1.0) {
        // تنظيف القديم
        if (this.roomGroup) this.scene.remove(this.roomGroup);
        this.roomGroup = new THREE.Group();
        this.snapPoints = [];

        // 1. استخراج الكيانات (سواء كانت من DXF أو JSON)
        const entities = data.entities || [];

        // 2. حساب أقصى ارتفاع
        let currentHeight = globalSettings.height || 3.0;
        for (const layerName in layerConfig) {
            const conf = layerConfig[layerName];
            // في JSON القواعد تكون داخل overrides
            const val = conf.overrides ? conf.overrides.height : conf.value;
            const type = conf.type || (conf.overrides ? conf.overrides.type : null);
            
            if (type === 'wall' || type === 'walls') {
                if (val > currentHeight) currentHeight = val;
            }
        }
        
        // 3. حساب المركز (Bounding Box)
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        entities.forEach(e => {
            // دعم الصيغتين: points (JSON) و vertices (DXF)
            const verts = e.points || e.vertices;
            if(verts && verts.length > 0) {
                 verts.forEach(v => {
                     const x = v.x * forcedScale;
                     const y = v.y * forcedScale;
                     if(x < minX) minX = x; if(x > maxX) maxX = x;
                     if(y < minY) minY = y; if(y > maxY) maxY = y;
                 });
            }
        });

        if(minX === Infinity) { minX=0; maxX=0; minY=0; maxY=0; }
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;

        // 4. بناء السقف
        this.buildCeilingGrid(currentHeight);

        // 5. بناء العناصر
        const materialsCache = {};

        entities.forEach(e => {
            // قراءة الإعدادات (ندعم الهيكلين القديم والجديد)
            let config = layerConfig[e.layer] || {};
            // لو كان الملف JSON، الإعدادات الحقيقية داخل overrides
            if (config.overrides) config = { ...config, ...config.overrides };
            
            if(config.type === 'hide') return;

            // مفتاح الخامة
            const matKey = `${e.layer}-${config.color}`;
            if(!materialsCache[matKey]) {
                materialsCache[matKey] = this.createMaterial(config);
            }
            const material = materialsCache[matKey];

            const ctx = { cx, cy, config, material, scale: forcedScale, height: currentHeight, thickness: (globalSettings.thickness || 0.2) };

            // دعم النقاط (Vertices/Points)
            const verts = e.points || e.vertices;
            if (verts && verts.length >= 2) {
                // رسم الخطوط المتصلة
                for(let i=0; i<verts.length-1; i++) {
                    this.processEntity(verts[i], verts[i+1], ctx);
                }
                // إغلاق الشكل
                if(e.closed || e.shape) {
                    this.processEntity(verts[verts.length-1], verts[0], ctx);
                }
            }
        });

        this.scene.add(this.roomGroup);
        
        return {
            roomGroup: this.roomGroup,
            snapPoints: this.snapPoints,
            finalHeight: currentHeight
        };
    }

    processEntity(p1, p2, ctx) {
        const { cx, cy, config, material, scale, height, thickness } = ctx;
        // تصحيح الإحداثيات (Y-Up System)
        const x1 = (p1.x * scale) - cx; 
        const z1 = -((p1.y * scale) - cy); // قلب المحور Y ليصبح Z في الثري دي
        const x2 = (p2.x * scale) - cx; 
        const z2 = -((p2.y * scale) - cy);

        // --- إضاءة ---
        if (config.type === 'lights' || config.isLight) {
            const v1 = new THREE.Vector3(x1, 0, z1);
            const v2 = new THREE.Vector3(x2, 0, z2);
            const dist = v1.distanceTo(v2);
            if(dist > 0.01) {
                // الإضاءة تعلق في السقف أو الارتفاع المحدد
                let elev = config.elevation || (config.type === 'floor' ? 0.05 : height);
                const bar = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, dist), material);
                const midX = (x1 + x2) / 2; const midZ = (z1 + z2) / 2;
                bar.position.set(midX, elev, midZ);
                bar.lookAt(x2, elev, z2);
                this.roomGroup.add(bar);
            }
            return;
        }

        // --- حوائط وزجاج ---
        if (config.type === 'wall' || config.type === 'walls' || config.type === 'glass' || config.type === 'beams') {
            const h = config.height || height;
            const el = config.elevation || 0;
            const th = config.thickness || thickness;
            const dist = Math.hypot(x1-x2, z1-z2);
            
            if(dist > 0.01) {
                const geo = new THREE.BoxGeometry(th, h, dist);
                const mesh = new THREE.Mesh(geo, material);
                const midX = (x1 + x2) / 2; const midZ = (z1 + z2) / 2;
                
                // التموضع: نرفع الحائط بمقدار نصف ارتفاعه + منسوب الارتفاع
                mesh.position.set(midX, el + h/2, midZ);
                mesh.lookAt(x2, el + h/2, z2);
                this.roomGroup.add(mesh);
                
                // نقاط الجذب (للحوائط الصلبة فقط)
                if (config.type !== 'glass') {
                    this.snapPoints.push(new THREE.Vector3(x1, el, z1), new THREE.Vector3(x1, el+h, z1));
                    this.snapPoints.push(new THREE.Vector3(x2, el, z2), new THREE.Vector3(x2, el+h, z2));
                }
            }
        } 
        // --- أرضيات وأسقف ---
        else if (config.type === 'floor' || config.type === 'ceiling') {
            const y = config.elevation || (config.type === 'ceiling' ? height : 0.05);
            // رسم خط بسيط للأرضيات في وضع الخطوط، أو يمكن تطويره لبلاطات
            const points = [new THREE.Vector3(x1, y, z1), new THREE.Vector3(x2, y, z2)];
            const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material);
            this.roomGroup.add(line);
        }
    }

    buildCeilingGrid(height) {
        const oldGrid = this.scene.getObjectByName("ceilGrid");
        if(oldGrid) this.scene.remove(oldGrid);

        const ceilGrid = new THREE.GridHelper(5000, 500, 0x444444, 0x222222);
        ceilGrid.position.y = height;
        ceilGrid.name = "ceilGrid";
        this.scene.add(ceilGrid);
    }

    createMaterial(config) {
        const color = config.color || "#cccccc";
        if(config.type === 'lights' || config.isLight) {
            return new THREE.MeshStandardMaterial({
                color: color, emissive: color, emissiveIntensity: (config.intensity || 1) * 2, toneMapped: false
            });
        }
        else if(config.type === 'glass') {
            return new THREE.MeshStandardMaterial({ 
                color: config.color, transparent: true, opacity: 0.3, roughness: 0.1, side: THREE.DoubleSide
            });
        }
        else {
            return new THREE.MeshStandardMaterial({ 
                color: color, roughness: 0.8, side: THREE.DoubleSide
            });
        }
    }

    fitCamera(camera, controls) {
        const box = new THREE.Box3().setFromObject(this.roomGroup);
        if (box.isEmpty()) return;
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        
        camera.position.set(center.x, maxDim, center.z + maxDim);
        camera.lookAt(center);
        if(controls) {
            controls.target.copy(center); 
            controls.update();
        }
    }
}