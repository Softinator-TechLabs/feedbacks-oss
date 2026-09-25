import React from "react";

const paths = {
  attachment:
    "m21.4 11.6-9.2 9.2a6 6 0 0 1-8.5-8.5l10-10a4 4 0 0 1 5.6 5.6l-10 10a2 2 0 0 1-2.8-2.8l9.2-9.2",
  link: "M10 13a5 5 0 0 0 7 .5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",
  history: "M3 11a9 9 0 1 1 2.6 7.4M3 4v7h7M12 7v5l3 2",
  external:
    "M15 3h6v6M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5",
  check: "M20 6 9 17l-5-5",
  note: "M5 4h14v16H5zM8 9h8M8 13h8M8 17h5",
  review: "M4 5h16v14H4zM8 11l2 2 5-5",
  share:
    "M18 8a3 3 0 1 0-2.8-4M6 15a3 3 0 1 0 0-6M18 22a3 3 0 1 0-2.8-4M8.5 11l6-3M8.5 13l6 5",
  issue: "M12 3 2 21h20L12 3zM12 9v5m0 4h.01",
  more: "M4 12h.01M12 12h.01M20 12h.01",
  moon: "M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z",
  sun: "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
} as const;
export function Icon({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
