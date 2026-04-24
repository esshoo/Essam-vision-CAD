import { t, setLanguage, getCurrentLanguage } from '../core/i18n.js';

function style(node, styles) {
  Object.assign(node.style, styles || {});
  return node;
}

function makeButton(label, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  style(btn, {
    border: '1px solid rgba(255,255,255,0.16)',
    background: 'rgba(255,255,255,0.08)',
    color: '#fff',
    borderRadius: '8px',
    padding: '6px 10px',
    cursor: 'pointer',
    fontWeight: '700',
    fontSize: '12px'
  });
  btn.addEventListener('click', onClick);
  return btn;
}

class CADSettingsPanelAugmenter {
  constructor() {
    this.boundClicks = false;
    window.addEventListener('cad:language-changed', () => this.refreshTexts());
    this.bindOpenHooks();
    setTimeout(() => this.ensureInjected(), 0);
    setTimeout(() => this.ensureInjected(), 250);
  }

  bindOpenHooks() {
    if (this.boundClicks) return;
    this.boundClicks = true;
    document.addEventListener('click', () => {
      setTimeout(() => this.ensureInjected(), 0);
      setTimeout(() => this.ensureInjected(), 120);
    }, true);
  }

  getPanelBody() {
    return document.querySelector('.settings-2d .panel-body');
  }

  buildSection() {
    const wrap = document.createElement('div');
    wrap.id = 'essam-settings-extra';
    style(wrap, {
      marginTop: '12px',
      paddingTop: '12px',
      borderTop: '1px solid rgba(255,255,255,0.12)',
      display: 'grid',
      gap: '10px',
      color: '#fff'
    });

    const title = document.createElement('div');
    title.id = 'essam-settings-title';
    style(title, { fontSize: '12px', fontWeight: '800' });

    const langLabel = document.createElement('label');
    langLabel.id = 'essam-settings-language-label';
    style(langLabel, { display: 'grid', gap: '6px', fontSize: '11px' });
    const langText = document.createElement('span');
    langText.id = 'essam-settings-language-text';

    const select = document.createElement('select');
    select.id = 'essam-settings-language-select';
    style(select, {
      width: '100%',
      padding: '6px',
      borderRadius: '8px',
      border: '1px solid rgba(255,255,255,0.18)',
      background: 'rgba(17,17,17,0.92)',
      color: '#fff',
      outline: 'none'
    });
    const ar = document.createElement('option'); ar.value = 'ar'; ar.textContent = 'العربية';
    const en = document.createElement('option'); en.value = 'en'; en.textContent = 'English';
    select.append(ar, en);
    select.addEventListener('change', async (e) => {
      try {
        await setLanguage(e.target.value);
      } catch (err) {
        console.error('[SettingsPanel] Language switch failed:', err);
      }
      this.refreshTexts();
    });
    langLabel.append(langText, select);

    const actions = document.createElement('div');
    actions.id = 'essam-settings-actions';
    style(actions, { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' });

    actions.append(
      makeButton(t('settings.openFile', 'فتح ملف'), () => window.cadApp?.openFileUpload?.()),
      makeButton(t('settings.refreshPage', 'تحديث الصفحة'), () => window.location.reload()),
      makeButton(t('settings.openJson2d', 'فتح JSON 2D'), () => window.cadDrawingOverlay?.importAnnotationsJson?.()),
      makeButton(t('settings.openJson3d', 'فتح JSON 3D'), () => window.cad3dOpen?.())
    );

    const note = document.createElement('div');
    note.id = 'essam-settings-note';
    style(note, { fontSize: '11px', opacity: '0.75', lineHeight: '1.5' });

    wrap.append(title, langLabel, actions, note);
    return wrap;
  }

  ensureInjected() {
    const body = this.getPanelBody();
    if (!body) return false;
    let section = body.querySelector('#essam-settings-extra');
    if (!section) {
      section = this.buildSection();
      body.appendChild(section);
    }
    this.refreshTexts();
    return true;
  }

  refreshTexts() {
    const section = document.querySelector('#essam-settings-extra');
    if (!section) return;
    const select = section.querySelector('#essam-settings-language-select');
    if (select) select.value = getCurrentLanguage();

    const title = section.querySelector('#essam-settings-title');
    if (title) title.textContent = t('settings.title', 'الإعدادات');

    const langText = section.querySelector('#essam-settings-language-text');
    if (langText) langText.textContent = t('settings.language', 'اللغة');

    const buttons = section.querySelectorAll('button');
    if (buttons[0]) buttons[0].textContent = t('settings.openFile', 'فتح ملف');
    if (buttons[1]) buttons[1].textContent = t('settings.refreshPage', 'تحديث الصفحة');
    if (buttons[2]) buttons[2].textContent = t('settings.openJson2d', 'فتح JSON 2D');
    if (buttons[3]) buttons[3].textContent = t('settings.openJson3d', 'فتح JSON 3D');

    const note = section.querySelector('#essam-settings-note');
    if (note) note.textContent = t('settings.note', 'JSON 2D يفتح التعليقات وطبقاتها، وJSON 3D يفتح المجسم المحفوظ من صفحة 3D.');
  }
}

const panel = new CADSettingsPanelAugmenter();
window.cadSettingsUI = panel;
export { CADSettingsPanelAugmenter as CADSettingsPanel };
