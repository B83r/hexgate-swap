import React from "react";
import ReactDOM from "react-dom/client";
import { MotionConfig } from "framer-motion";
import App from "./App";
import { I18nProvider } from "./lib/i18n";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user">
      <I18nProvider>
        <App />
      </I18nProvider>
    </MotionConfig>
  </React.StrictMode>,
);
