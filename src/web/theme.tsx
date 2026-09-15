import React, { useState } from "react";
import { Icon } from "./icons.js";
type Theme = "light" | "dark";
function savedTheme(): Theme {
  try {
    return localStorage.getItem("feedbacks-theme") === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}
document.documentElement.dataset.theme = savedTheme();

export function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>(savedTheme);
  const next = theme === "light" ? "dark" : "light";
  return (
    <button
      type="button"
      className="icon-action theme-switch"
      title={`Switch to ${next} mode`}
      aria-label={`Switch to ${next} mode`}
      onClick={() => {
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem("feedbacks-theme", next);
        } catch {
          /* This visit still supports theme changes. */
        }
        setTheme(next);
      }}
    >
      <Icon name={theme === "light" ? "moon" : "sun"} />
    </button>
  );
}
