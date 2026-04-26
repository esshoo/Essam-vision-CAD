const TOKENS = {
  panelBg: 'rgba(0,0,0,0.62)',
  panelBorder: '1px solid rgba(255,255,255,0.14)',
  panelShadow: '0 14px 36px rgba(0,0,0,0.38)',
  panelRadius: '16px',
  cardBg: 'rgba(255,255,255,0.08)',
  muted: 'rgba(255,255,255,0.72)',
  faint: 'rgba(255,255,255,0.62)',
  inputBg: 'rgba(17,17,17,0.92)',
  inputBorder: '1px solid rgba(255,255,255,0.18)',
  headerBg: 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))',
  ghostBtnBg: 'rgba(255,255,255,0.12)',
  ghostBtnBorder: '1px solid rgba(255,255,255,0.16)',
  primaryBtnBg: '#2f6fed',
  successBtnBg: '#0f9d58',
  warningBtnBg: '#f29900',
  dangerBtnBg: '#c62828',
  undoBtnBg: '#e6a23c',
};

export function panelStyle(overrides = {}) {
  return {
    position: 'fixed',
    zIndex: 4200,
    background: TOKENS.panelBg,
    border: TOKENS.panelBorder,
    borderRadius: TOKENS.panelRadius,
    boxShadow: TOKENS.panelShadow,
    backdropFilter: 'blur(12px)',
    color: '#fff',
    fontFamily: 'Arial, "Helvetica Neue", Helvetica, sans-serif',
    ...overrides,
  };
}

export function headerStyle(overrides = {}) {
  return {
    padding: '12px',
    background: TOKENS.headerBg,
    borderBottom: '1px solid rgba(255,255,255,0.12)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '10px',
    ...overrides,
  };
}

export function titleStyle(overrides = {}) {
  return { fontSize: '13px', fontWeight: '800', color: '#fff', ...overrides };
}

export function subtitleStyle(overrides = {}) {
  return { fontSize: '11px', color: TOKENS.muted, lineHeight: 1.4, ...overrides };
}

export function infoCardStyle(overrides = {}) {
  return {
    marginTop: '12px',
    padding: '10px',
    borderRadius: '12px',
    background: TOKENS.cardBg,
    color: '#fff',
    fontSize: '12px',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
    ...overrides,
  };
}

export function labelStyle(overrides = {}) {
  return { fontSize: '11px', color: TOKENS.muted, fontWeight: '700', ...overrides };
}

export function sectionStyle(overrides = {}) {
  return { display: 'grid', gap: '8px', marginTop: '12px', ...overrides };
}

export function inputStyle(overrides = {}) {
  return {
    width: '100%',
    padding: '8px',
    borderRadius: '10px',
    border: TOKENS.inputBorder,
    background: TOKENS.inputBg,
    color: '#fff',
    outline: 'none',
    boxSizing: 'border-box',
    ...overrides,
  };
}

export function buttonStyle(variant = 'ghost', overrides = {}) {
  const map = {
    ghost: { background: TOKENS.ghostBtnBg, border: TOKENS.ghostBtnBorder },
    primary: { background: TOKENS.primaryBtnBg, border: TOKENS.ghostBtnBorder },
    success: { background: TOKENS.successBtnBg, border: TOKENS.ghostBtnBorder },
    warning: { background: TOKENS.warningBtnBg, border: TOKENS.ghostBtnBorder },
    danger: { background: TOKENS.dangerBtnBg, border: TOKENS.ghostBtnBorder },
    undo: { background: TOKENS.undoBtnBg, border: TOKENS.ghostBtnBorder },
  };
  return {
    width: '100%',
    padding: '10px 12px',
    borderRadius: '10px',
    color: '#fff',
    cursor: 'pointer',
    fontWeight: '800',
    fontSize: '12px',
    ...map[variant],
    ...overrides,
  };
}

export function compactButtonStyle(variant = 'ghost', overrides = {}) {
  return buttonStyle(variant, { padding: '6px 10px', fontWeight: '700', ...overrides });
}

export const uiTheme = TOKENS;
