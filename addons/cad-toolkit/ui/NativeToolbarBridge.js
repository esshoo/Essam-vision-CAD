import { ToolbarMenuId, ToolbarMenuType } from '@x-viewer/plugins';
import { initI18n, t, getCurrentLanguage } from '../core/i18n.js';
import { openSourceFile, refreshPage, openAnnotationsJson, openSaved3DView } from './shared/fileActions.js';

const CUSTOM_IDS = {
  OPEN: 'EssamOpenActions',
  OPEN_FILE: 'EssamOpenFile',
  REFRESH: 'EssamRefreshPage',
  OPEN_JSON_2D: 'EssamOpenJson2D',
  OPEN_JSON_3D: 'EssamOpenJson3D',
  ENTITIES: 'EssamEntityManager',
  VIEW3D: 'Essam3D'
};

const BUILTIN_LABELS = {
  [ToolbarMenuId.HomeView]: 'builtin.home',
  [ToolbarMenuId.Fullscreen]: 'builtin.fullscreen',
  [ToolbarMenuId.ZoomToRectangle]: 'builtin.zoom',
  [ToolbarMenuId.ZoomToExtent]: 'builtin.zoomExtent',
  [ToolbarMenuId.Screenshot]: 'builtin.screenshot',
  [ToolbarMenuId.Measure]: 'builtin.measure',
  [ToolbarMenuId.Markup]: 'builtin.markup',
  [ToolbarMenuId.MarkupVisibility]: 'builtin.markupVisibility',
  [ToolbarMenuId.Layers]: 'builtin.layers',
  [ToolbarMenuId.Settings]: 'builtin.settings'
};

function makeToolbarElement(menuId, iconText, labelKey, parent = false) {
  return () => {
    const node = document.createElement('div');
    node.id = menuId;
    node.className = 'toolbar-menu';
    if (parent) node.classList.add('toolbar-parent-menu');
    const icon = document.createElement('div');
    icon.className = 'icon';
    icon.textContent = iconText;
    Object.assign(icon.style, {
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px'
    });
    const span = document.createElement('span');
    span.textContent = t(labelKey);
    node.title = t(labelKey);
    node.append(icon, span);
    return node;
  };
}

function addCustomMenus(toolbar) {
  if (!toolbar || toolbar.menuList?.has(CUSTOM_IDS.OPEN)) return;

  const addToEndGroup = (menuId, config, first = false) => {
    if (first || !Array.isArray(toolbar.groupCfg) || !toolbar.groupCfg.length) {
      toolbar.addMenu(menuId, config);
      return;
    }
    const groupIndex = toolbar.groupCfg.length - 1;
    const insertIndex = Array.isArray(toolbar.groupCfg[groupIndex]) ? toolbar.groupCfg[groupIndex].length : 0;
    toolbar.addMenu(menuId, config, [groupIndex, insertIndex]);
  };

  addToEndGroup(CUSTOM_IDS.OPEN, {
    customElement: makeToolbarElement(CUSTOM_IDS.OPEN, '📂', 'toolbar.openActions', true),
    menuName: 'toolbar.openActions',
    type: ToolbarMenuType.DropdownMenu,
    children: {
      [CUSTOM_IDS.OPEN_FILE]: {
        customElement: makeToolbarElement(CUSTOM_IDS.OPEN_FILE, '📁', 'toolbar.openFile'),
        menuName: 'toolbar.openFile',
        type: ToolbarMenuType.Button,
        onClick: openSourceFile
      },
      [CUSTOM_IDS.REFRESH]: {
        customElement: makeToolbarElement(CUSTOM_IDS.REFRESH, '🔄', 'toolbar.refreshPage'),
        menuName: 'toolbar.refreshPage',
        type: ToolbarMenuType.Button,
        onClick: refreshPage
      },
      [CUSTOM_IDS.OPEN_JSON_2D]: {
        customElement: makeToolbarElement(CUSTOM_IDS.OPEN_JSON_2D, '📝', 'toolbar.openJson2d'),
        menuName: 'toolbar.openJson2d',
        type: ToolbarMenuType.Button,
        onClick: openAnnotationsJson
      },
      [CUSTOM_IDS.OPEN_JSON_3D]: {
        customElement: makeToolbarElement(CUSTOM_IDS.OPEN_JSON_3D, '🧊', 'toolbar.openJson3d'),
        menuName: 'toolbar.openJson3d',
        type: ToolbarMenuType.Button,
        onClick: openSaved3DView
      },
    }
  }, true);

  addToEndGroup(CUSTOM_IDS.ENTITIES, {
    customElement: makeToolbarElement(CUSTOM_IDS.ENTITIES, '🧱', 'toolbar.entityManager'),
    menuName: 'toolbar.entityManager',
    type: ToolbarMenuType.Button,
    onClick: () => window.cadEntityLayerEditor?.toggle?.()
  });

  addToEndGroup(CUSTOM_IDS.VIEW3D, {
    customElement: makeToolbarElement(CUSTOM_IDS.VIEW3D, '🧊', 'toolbar.view3d'),
    menuName: 'toolbar.view3d',
    type: ToolbarMenuType.Button,
    onClick: () => {
      if (window.layerRulesUI?.preview3D) window.layerRulesUI.preview3D();
      else if (window.cad3dOpen) window.cad3dOpen();
    }
  });
}

function relabelMenuElement(menu, key) {
  if (!menu?.element || !key) return;
  const text = t(key);
  const span = menu.element.querySelector('span');
  if (span && span.textContent !== text) span.textContent = text;
  menu.element.title = text;
}

function relabelToolbar(toolbar) {
  if (!toolbar?.menuList) return;
  toolbar.menuList.forEach((menu, id) => {
    if (BUILTIN_LABELS[id]) relabelMenuElement(menu, BUILTIN_LABELS[id]);
  });
}

async function setupToolbarBridge() {
  await initI18n();
  const plugin = window.cadApp?.toolbarPlugin;
  if (!plugin) return false;
  const toolbar = plugin.getToolbar?.();
  if (!toolbar) return false;

  addCustomMenus(toolbar);
  relabelToolbar(toolbar);

  const refreshLabels = () => {
    try { toolbar.refresh?.(); } catch (_) {}
    setTimeout(() => {
      relabelToolbar(toolbar);
      window.cadSettingsUI?.ensureInjected?.();
    }, 0);
    setTimeout(() => {
      relabelToolbar(toolbar);
      window.cadSettingsUI?.ensureInjected?.();
    }, 120);
  };

  window.addEventListener('cad:language-changed', refreshLabels);
  document.body.setAttribute('data-lang', getCurrentLanguage());

  document.addEventListener('click', () => {
    setTimeout(() => {
      relabelToolbar(toolbar);
      window.cadSettingsUI?.ensureInjected?.();
    }, 0);
  }, true);

  return true;
}

window.addEventListener('cad:app-ready', () => {
  setupToolbarBridge().catch((error) => console.error('[ToolbarBridge] Failed:', error));
});

setupToolbarBridge().catch(() => {});
