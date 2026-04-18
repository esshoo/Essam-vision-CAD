/**
 * CADSceneExporter.js (v26 - Lighting & Settings)
 * - Saves Global Sun Intensity to JSON.
 * - Saves Light Layer Intensity.
 * - Maintains Safe Merging logic.
 */
console.log("✅ CADSceneExporter V26 (Lighting Settings) LOADED");

export const CADSceneExporter = {
  export(rawEntities, layerRules, metaData = {}) {
    console.log("🚀 Starting Export V26...");
    const scale = metaData.scale || 0.001; 
    const rnd = (n) => Math.round(n * 100000) / 100000;

    const { processedEntities, centerOffset } = this.processAndMerge(rawEntities, layerRules, scale, rnd);

    const sceneJson = {
      schema: "cad3d-scene@1",
      meta: { name: metaData.fileName || "Project" },
      // تخزين إعدادات المشهد العامة هنا
      settings: {
          sunIntensity: metaData.sunIntensity !== undefined ? metaData.sunIntensity : 1.0,
          scale: scale
      },
      units: { metersPerCadUnit: scale, originShift: centerOffset },
      materials: this.getDefaultMaterials(),
      rulesByLayer: {},
      entities: []
    };

    for (const [k, v] of Object.entries(layerRules)) {
      sceneJson.rulesByLayer[k] = { type: v.type, overrides: { ...v } };
    }

    let idCounter = 1;
    processedEntities.forEach(item => {
      const rule = layerRules[item.layer];
      if (!rule || rule.type === 'hide') return;

      const common = { 
        id: `E_${idCounter++}`, 
        layer: item.layer, 
        points: item.points, 
        closed: item.closed 
      };

      if (rule.type === 'lights') {
           // نمرر الشدة (intensity) مع الكيان إذا أردنا (أو نعتمد على القاعدة)
           sceneJson.entities.push({ ...common, kind: "POLYLINE", isLightShape: true });
      }
      else if (rule.type === 'door') {
          if(item.points.length >= 2) {
              const pFirst = item.points[0];
              const pLast = item.points[item.points.length-1];
              sceneJson.entities.push({
                  id: `OP_${idCounter++}`, layer: item.layer, kind: "OPENING",
                  openingKind: 'door',
                  p0: pFirst, p1: pLast,
                  sill: rule.elevation || 0, height: rule.height || 2.1
              });
          }
      }
      else {
          sceneJson.entities.push({ ...common, kind: "POLYLINE" });
          if (rule.type === 'walls' && item.closed && item.points.length > 2 && rule.hasCeiling) {
               sceneJson.entities.push({
                  id: `AC_${idCounter++}`, layer: "AUTO_CEIL", kind: "DERIVED_FROM",
                  sourceEntityId: common.id, derivedKind: "ceilingFromLoop",
                  overrides: { elevation: rule.height, thickness: 0.1, material: "ceiling" }
              });
          }
      }
    });

    console.log(`✅ Exported ${sceneJson.entities.length} entities with Sun: ${sceneJson.settings.sunIntensity}`);
    return sceneJson;
  },

  processAndMerge(rawEntities, layerRules, scale, rnd) {
    let allPoints = [];
    const layerGroups = {};

    rawEntities.forEach(e => {
        if (!e.points || e.points.length < 2) return;
        const pts = e.points.map(p => ({ x: p.x * scale, y: p.y * scale }));
        if (!layerGroups[e.layer]) layerGroups[e.layer] = [];
        layerGroups[e.layer].push(pts);
        allPoints.push(...pts);
    });

    if (allPoints.length === 0) return { processedEntities: [], centerOffset: {x:0,y:0} };

    let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
    allPoints.forEach(p => { 
        if(p.x<minX) minX=p.x; if(p.x>maxX) maxX=p.x; 
        if(p.y<minY) minY=p.y; if(p.y>maxY) maxY=p.y; 
    });
    const cx = (minX+maxX)/2; 
    const cy = (minY+maxY)/2;

    const finalEntities = [];

    for (const [layer, segments] of Object.entries(layerGroups)) {
        const rule = layerRules[layer];
        const shiftedSegments = segments.map(seg => seg.map(p => ({ x: rnd(p.x - cx), y: rnd(p.y - cy) })));
        
        const shouldSmartMerge = rule && (
            rule.type === 'walls' || rule.type === 'floor' || 
            rule.type === 'ceiling' || rule.type === 'glass' || rule.type === 'beams'
        );

        if (shouldSmartMerge) {
            const merged = this.mergeSegmentsStrict(shiftedSegments, 0.001);
            merged.forEach(m => finalEntities.push({ layer, points: m.points, closed: m.closed }));
        } else {
            shiftedSegments.forEach(s => finalEntities.push({ layer, points: s, closed: false }));
        }
    }

    return { processedEntities: finalEntities, centerOffset: {x:cx, y:cy} };
  },

  mergeSegmentsStrict(segments, tolerance) {
    if (segments.length === 0) return [];
    let pool = segments.map(pts => ({ pts: [...pts], used: false }));
    const results = [];
    for (let i = 0; i < pool.length; i++) {
        if (pool[i].used) continue;
        pool[i].used = true;
        let polyline = [...pool[i].pts];
        let modified = true;
        while (modified) {
            modified = false;
            const head = polyline[0];
            const tail = polyline[polyline.length - 1];
            for (let j = 0; j < pool.length; j++) {
                if (pool[j].used) continue;
                const s = pool[j];
                const sHead = s.pts[0];
                const sTail = s.pts[s.pts.length - 1];
                if (this.dist(tail, sHead) < tolerance) {
                    polyline.push(...s.pts.slice(1)); s.used = true; modified = true; break;
                } else if (this.dist(tail, sTail) < tolerance) {
                    polyline.push(...s.pts.reverse().slice(1)); s.used = true; modified = true; break;
                } else if (this.dist(head, sTail) < tolerance) {
                    polyline.unshift(...s.pts.slice(0, -1)); s.used = true; modified = true; break;
                } else if (this.dist(head, sHead) < tolerance) {
                    polyline.unshift(...s.pts.reverse().slice(0, -1)); s.used = true; modified = true; break;
                }
            }
        }
        let closed = (this.dist(polyline[0], polyline[polyline.length-1]) < tolerance);
        if (closed) polyline[polyline.length-1] = { ...polyline[0] };
        results.push({ points: polyline, closed });
    }
    return results;
  },

  dist(p1, p2) { return Math.hypot(p1.x - p2.x, p1.y - p2.y); },

  getDefaultMaterials() {
    return {
      "wall": { color: "#eeeeee", roughness: 0.8 },
      "floor": { color: "#cccccc", roughness: 0.9 },
      "ceiling": { color: "#ffffff", roughness: 0.9 },
      "beam": { color: "#aaaaaa", roughness: 0.7 },
      "glass": { color: "#88ccff", alpha: 0.35, roughness: 0.1 },
      "light": { color: "#ffffdd", emissive: 1.5 },
      "lines": { color: "#333333" }
    };
  },
  
  groupByLayer(arr) {
      const g = {};
      arr.forEach(i => { if(!g[i.layer]) g[i.layer]=[]; g[i.layer].push(i); });
      return g;
  }
};