/**
 * FloatingFabMenu.js (Final Fix)
 * ------------------
 * Fixes the crash by calling the Generator (preview3D) instead of the empty Opener.
 */
function css(n, obj) { Object.assign(n.style, obj); }

function ensureFab() {
  if (document.getElementById("cad-fab")) return;

  const fab = document.createElement("button");
  fab.id = "cad-fab";
  fab.type = "button";
  fab.textContent = "☰";
  css(fab, {
    position: "absolute", left: "18px", bottom: "92px", zIndex: 6000,
    width: "52px", height: "52px", borderRadius: "18px",
    border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.10)",
    color: "#fff", fontSize: "22px", fontWeight: "900", cursor: "pointer",
    backdropFilter: "blur(6px)", boxShadow: "0 10px 24px rgba(0,0,0,0.30)",
  });

  const menu = document.createElement("div");
  menu.id = "cad-fab-menu";
  css(menu, {
    position: "absolute", left: "18px", bottom: "152px", zIndex: 6000,
    display: "none", flexDirection: "column", gap: "10px", padding: "12px",
    borderRadius: "16px", border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)",
    boxShadow: "0 12px 28px rgba(0,0,0,0.35)", minWidth: "190px",
  });

  const item = (label, onClick) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = label;
    css(b, {
      border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.10)",
      color: "#fff", borderRadius: "14px", padding: "12px 12px",
      fontWeight: "900", cursor: "pointer", textAlign: "left",
    });
    b.onclick = () => { onClick(); hideMenu(); };
    return b;
  };

  function toggleMenu() { menu.style.display = (menu.style.display === "none") ? "flex" : "none"; }
  function hideMenu() { menu.style.display = "none"; }

  fab.onclick = toggleMenu;
  window.addEventListener("pointerdown", (e) => {
    if (menu.style.display === "none") return;
    if (e.target === fab || menu.contains(e.target)) return;
    hideMenu();
  });

  // القائمة
  menu.appendChild(item("📂 فتح ملف", () => window.cadApp?.openFileUpload()));
  menu.appendChild(item("🧩 إعدادات الطبقات", () => window.layerRulesUI?.toggle?.()));
  menu.appendChild(item("✏️ الرسم بالقلم", () => window.cadDrawingOverlay?.toggle?.()));
  
  // --- التصحيح هنا ---
  menu.appendChild(item("🧱 عرض 3D", () => {
      // 1. حاول تشغيل المعاينة من لوحة القواعد (توليد مباشر)
      if (window.layerRulesUI && window.layerRulesUI.preview3D) {
          window.layerRulesUI.preview3D();
      } 
      // 2. لو مش موجودة، افتح نافذة اختيار ملف
      else if (window.cad3dOpen) {
          window.cad3dOpen(); 
      }
  }));

  document.body.appendChild(menu);
  document.body.appendChild(fab);
}

ensureFab();