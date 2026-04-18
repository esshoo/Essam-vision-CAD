// StorageManager.js
import { THREE } from '@x-viewer/core';

export class StorageManager {
    constructor(interactionManager) {
        this.interactionManager = interactionManager; // نحتاج الوصول لمدير التفاعل لإعادة رسم الخطوط
    }

    saveToLocalStorage(measurements) {
        const data = measurements.map(m => ({
            start: m.start,
            end: m.end,
            distance: m.distance
        }));
        localStorage.setItem('dxf_measurements', JSON.stringify(data));
    }

    loadFromLocalStorage() {
        const stored = localStorage.getItem('dxf_measurements');
        if (stored) {
            try {
                const data = JSON.parse(stored);
                // نمسح القديم أولاً إذا أردت، أو نضيف عليه. هنا سنضيف فقط
                data.forEach(m => {
                    this.interactionManager.createPermanentMeasurement(
                        new THREE.Vector3(m.start.x, m.start.y, m.start.z),
                        new THREE.Vector3(m.end.x, m.end.y, m.end.z)
                    );
                });
            } catch (e) {
                console.warn("Error loading measurements:", e);
            }
        }
    }

    exportMeasurementsJSON(measurements) {
        const data = measurements.map(m => ({
            start: m.start,
            end: m.end,
            distance: m.distance
        }));
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = "measurements.json";
        a.click();
        URL.revokeObjectURL(url);
    }

    importMeasurementsJSON(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                // نقوم بمسح القياسات الحالية (اختياري، حسب رغبتك)
                while(this.interactionManager.savedMeasurements.length > 0) {
                    this.interactionManager.undoLastMeasurement();
                }
                
                data.forEach(m => {
                    this.interactionManager.createPermanentMeasurement(
                        new THREE.Vector3(m.start.x, m.start.y, m.start.z),
                        new THREE.Vector3(m.end.x, m.end.y, m.end.z)
                    );
                });
                // حفظ التحديث الجديد
                this.saveToLocalStorage(this.interactionManager.savedMeasurements);
            } catch(err) {
                alert("ملف خاطئ أو تالف");
                console.error(err);
            }
        };
        reader.readAsText(file);
    }
}