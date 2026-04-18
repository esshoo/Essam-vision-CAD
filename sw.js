const CACHE_NAME = 'essam-cad-pwa-v1';
const APP_SHELL = [
  "./CNAME",
  "./PWA_NOTES.txt",
  "./addons/cad-toolkit/CADLayerKit.js",
  "./addons/cad-toolkit/CADSceneExporter.js",
  "./addons/cad-toolkit/renderers/babylon/EssamBabylonBuilderjson.js",
  "./addons/cad-toolkit/renderers/babylon/EssambabylonMeasureTool.js",
  "./addons/cad-toolkit/renderers/babylon/index.html",
  "./addons/cad-toolkit/renderers/three/CAD3DBridge.js",
  "./addons/cad-toolkit/renderers/three/EssamEngine.js",
  "./addons/cad-toolkit/renderers/three/ExportManager.js",
  "./addons/cad-toolkit/renderers/three/InteractionManager.js",
  "./addons/cad-toolkit/renderers/three/SceneBuilder.js",
  "./addons/cad-toolkit/renderers/three/StorageManager.js",
  "./addons/cad-toolkit/ui/DrawingOverlay.js",
  "./addons/cad-toolkit/ui/FloatingFabMenu.js",
  "./addons/cad-toolkit/ui/LayerRulesPanel.js",
  "./addons/cad-toolkit/viewer/CADViewer_app.js",
  "./apple-touch-icon.png",
  "./compare/dxfComparePanel.css",
  "./compare/dxfComparePanel.js",
  "./favicon.ico",
  "./global.css",
  "./icon-192.png",
  "./icon-512.png",
  "./iconfont/iconfont.css",
  "./iconfont/iconfont.ttf",
  "./iconfont/iconfont2.css",
  "./iconfont/iconfont2.ttf",
  "./index.html",
  "./libs/jsoneditor/img/jsoneditor-icons.svg",
  "./libs/jsoneditor/jsoneditor.min.css",
  "./libs/jsoneditor/jsoneditor.min.js",
  "./libs/pdf/pdf.min.js",
  "./libs/pdf/pdf.worker.min.js",
  "./libs/x-viewer/core/dist/chunks/libredwg-web-DR0Rasye.js",
  "./libs/x-viewer/core/dist/index.esm.js",
  "./libs/x-viewer/plugins/dist/index.esm.js",
  "./libs/x-viewer/ui/dist/index.esm.js",
  "./llms.txt",
  "./manifest.json",
  "./robots.txt",
  "./settings/SettingsPanel.css",
  "./settings/Viewer2dSettingsPanel.js",
  "./sitemap.xml"
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cached = await caches.match(request, { ignoreSearch: true });
      if (cached) return cached;
      try {
        const network = await fetch(request);
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, network.clone());
        return network;
      } catch (err) {
        return (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const network = await fetch(request);
      if (network && network.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, network.clone());
      }
      return network;
    } catch (err) {
      return cached || Response.error();
    }
  })());
});
