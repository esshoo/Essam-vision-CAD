// ExportManager.js
import { THREEAddons } from '@x-viewer/core';
const { GLTFExporter } = THREEAddons;

export class ExportManager {
    constructor() {
        this.exporter = new GLTFExporter();
    }

    // تصدير ملف GLB (المبنى فقط بدون الشبكة)
    exportGLB(objectToExport) {
        if (!objectToExport || objectToExport.children.length === 0) {
            alert("لا يوجد مجسم لتصديره!");
            return;
        }

        console.log("جارٍ تصدير ملف GLB...");
        
        const options = {
            binary: true,       // ملف واحد .glb
            onlyVisible: true,  // فقط العناصر الظاهرة
            truncateDrawRange: true
        };

        this.exporter.parse(
            objectToExport, // هنا سنمرر فقط مجموعة الغرفة
            (result) => {
                if (result instanceof ArrayBuffer) {
                    this.saveArrayBuffer(result, 'Project_Model.glb');
                } else {
                    const output = JSON.stringify(result, null, 2);
                    this.saveString(output, 'Project_Model.gltf');
                }
            },
            (error) => {
                console.error('حدث خطأ أثناء التصدير:', error);
                alert("فشل التصدير.");
            },
            options
        );
    }

    // تصدير ملف JSON (الإعدادات والطبقات للنقل لمشروع آخر)
    exportConfigJSON(dxfData, layerRules, globalSettings) {
        if (!dxfData || !layerRules) {
            alert("لا توجد بيانات كافية للتصدير.");
            return;
        }

        const finalJSON = {
            schema: "cad3d-scene@1",
            meta: { name: "Exported_Project", date: new Date().toISOString() },
            settings: globalSettings || {},
            rulesByLayer: layerRules,
            entities: dxfData.entities || []
        };

        const output = JSON.stringify(finalJSON, null, 2);
        this.saveString(output, 'Project_Data.json');
    }

    saveString(text, filename) {
        this.save(new Blob([text], { type: 'text/plain' }), filename);
    }

    saveArrayBuffer(buffer, filename) {
        this.save(new Blob([buffer], { type: 'application/octet-stream' }), filename);
    }

    save(blob, filename) {
        const link = document.createElement('a');
        link.style.display = 'none';
        document.body.appendChild(link);
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    }
}