"use client";

// Botão fixo do escritório que abre o painel da prospecção de sites (Neo + Morfeus).
// O painel em si é servido pela Central de Agentes em http://localhost:7770/prospeccao.
import { useEffect, useState } from "react";

const PAINEL_URL = "http://localhost:7770/prospeccao";

export function ProspeccaoPainel() {
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    const fechar = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberto(false);
    };
    window.addEventListener("keydown", fechar);
    return () => window.removeEventListener("keydown", fechar);
  }, [aberto]);

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        title="Prospecção de sites: Neo + Morfeus"
        style={{
          position: "fixed", left: 16, top: "50%", transform: "translateY(-50%)", zIndex: 60,
          display: "flex", alignItems: "center", gap: 8,
          padding: "10px 16px", borderRadius: 999,
          background: "#7bd65a", color: "#08130a", border: "none",
          font: "600 14px 'Segoe UI', system-ui, sans-serif",
          boxShadow: "0 6px 24px rgba(0,0,0,.45)", cursor: "pointer",
        }}
      >
        <span aria-hidden="true">🎯</span> Prospecção
      </button>

      {aberto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Prospecção de sites"
          onClick={() => setAberto(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 70,
            background: "rgba(0,0,0,.6)", display: "flex",
            alignItems: "center", justifyContent: "center", padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "relative", width: "min(920px, 100%)", height: "min(92vh, 980px)",
              borderRadius: 16, overflow: "hidden", border: "1px solid #24382b",
              background: "#0b120e", boxShadow: "0 20px 60px rgba(0,0,0,.6)",
            }}
          >
            <button
              type="button"
              onClick={() => setAberto(false)}
              aria-label="Fechar o painel de prospecção"
              style={{
                position: "absolute", top: 10, right: 12, zIndex: 1,
                width: 34, height: 34, borderRadius: 999, border: "1px solid #24382b",
                background: "#121d16", color: "#e6f2e4", fontSize: 18, cursor: "pointer",
              }}
            >
              ×
            </button>
            <iframe
              src={PAINEL_URL}
              title="Painel de prospecção de sites"
              style={{ width: "100%", height: "100%", border: 0, display: "block" }}
            />
          </div>
        </div>
      )}
    </>
  );
}
