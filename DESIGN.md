---
name: "Feedbacks"
description: "A creative public slate, with a focused review application."
colors:
  app-oxford: "#17324d"
  site-ink: "#202020"
  site-paper: "#fffdfa"
  site-coral: "#db4939"
  site-lilac: "#c9b6ef"
  site-moss: "#edf0e5"
typography:
  app-body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "15px"
    lineHeight: 1.55
  site-display:
    fontFamily: "Manrope, sans-serif"
    fontSize: "clamp(48px, 6.6vw, 92px)"
    fontWeight: 800
    lineHeight: 1.08
    letterSpacing: "-0.04em"
---

# Design direction

## Public website: a team's slate

Lead with a big, plain promise and an illustrated web review. Warm paper, heavy Manrope type, a coral pencil mark and three differently composed webpage scraps give the page its character. Keep prose short. Use the screenshot and tiny discussions to explain the workflow before adding another paragraph.

The source files are `site/index.html`, `site/site.css` and `site/site.js`. The Chrome Web Store download is the primary hero action, with a direct install link in the header. Source and self-hosting links remain easy to find; hosted access is secondary. Examples are explicitly fictional. Figma, GitHub Issues and Projects are possible manual follow-ups, not integrations. Reviewer expertise is advisory.

The center example has three native buttons: Mark it, Discuss it and Let your AI read it. Selected state uses `aria-pressed`; updates use polite live text. The pencil draws only after interaction, once, with no looping animation. Reduced-motion preferences disable that animation. Keep the composition stable between stages.

Desktop uses a wide gallery with tilted side examples. At 720px and below, the main review occupies a full row and the two secondary scraps sit beneath it. Later sections stack. The site deliberately uses its own display scale and font; it does not set application typography.

Assets and complete font licensing are documented in [website asset provenance](docs/website-assets.md).

## Application and extension: focused review tools

Preserve the existing system sans-serif stack, white light-mode surfaces, Oxford actions and theme behavior. Native fields and buttons stay at least 44px high. Group related controls and retain visible keyboard focus. Do not apply the website's oversized headings or rotated compositions to review screens.

Navigation preserves the applied filters and protects unsaved drafts. Optional organization, personal views and diagnostics use disclosure sections. Screenshot comparison preserves image proportions and provides a labeled native range control. Arrow-key navigation must not intercept typing, selectors, sliders or dialogs.

## Content and evidence

- Name what an action actually does. Never invent successful writes, integrations, deployment, customer records or endorsements.
- Keep response obligation, work status and delivery evidence distinct.
- Label illustrative screenshots and generated marketing imagery; preserve actual screenshot pixels in the product.
- Show fewer, stronger examples rather than long feature grids or repeated claims.
- Use design guidance as support for the requested visual direction, not a constraint against expressive work.
