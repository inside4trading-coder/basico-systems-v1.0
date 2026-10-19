import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

// La app abre sin conexión (apagones): el service worker guarda HTML y assets.
// Solo en producción: en desarrollo serviría código viejo.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("Service worker no registrado", err));
  });
}
