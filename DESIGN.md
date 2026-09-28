---
name: "Feedbacks"
description: "Website feedback with clear context for developers and their AI agents."
colors:
  app-oxford: "#17324d"
  review-draft: "#a43e17"
  site-ink: "#202020"
  site-paper: "#fffdfa"
  site-coral: "#db4939"
  landing-paper: "#fff"
  landing-ink: "#20241e"
  landing-secondary: "#596054"
  landing-line: "#dfe3da"
  landing-pencil: "#dc452c"
  landing-capture-mark: "#c63f29"
  landing-capture-scene: "#edf2e5"
  landing-review-scene: "#f6ece6"
  landing-thread-scene: "#edf0f9"
  landing-agent-highlight: "#e4efc3"
  landing-setup-surface: "#f6f7f3"
  landing-action-hover: "#394431"
  site-focus: "#2159b1"
typography:
  app-body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "15px"
    lineHeight: 1.55
  landing-display:
    fontFamily: "Manrope, Arial, sans-serif"
    fontSize: "clamp(40px, 5.3vw, 76px)"
    fontWeight: 800
    lineHeight: 1.08
    letterSpacing: "-0.04em"
  landing-title:
    fontFamily: "Manrope, Arial, sans-serif"
    fontSize: "28px"
    fontWeight: 800
    lineHeight: 1.2
  landing-body:
    fontFamily: "Manrope, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  landing-label:
    fontFamily: "Manrope, Arial, sans-serif"
    fontSize: "14px"
  landing-pencil-note:
    fontFamily: "Caveat, cursive"
    fontSize: "30px"
    fontWeight: 600
    letterSpacing: "-0.6px"
rounded:
  landing-action: "5px"
  landing-screen: "6px"
  landing-scene: "10px"
  landing-play: "30px"
  landing-context: "3px"
  app-button: "7px"
  app-field: "8px"
spacing:
  landing-inline: "12px"
  landing-control: "18px"
  landing-section-gap: "24px"
  landing-column: "32px"
components:
  landing-primary:
    backgroundColor: "{colors.landing-ink}"
    textColor: "{colors.landing-paper}"
    rounded: "{rounded.landing-action}"
    padding: "13px 22px"
  landing-primary-hover:
    backgroundColor: "{colors.landing-action-hover}"
  landing-step:
    textColor: "{colors.landing-secondary}"
    padding: "9px 6px"
  landing-step-selected:
    textColor: "{colors.landing-ink}"
  landing-context:
    rounded: "{rounded.landing-context}"
    padding: "9px 16px"
  landing-scene:
    backgroundColor: "{colors.landing-capture-scene}"
    rounded: "{rounded.landing-scene}"
    padding: "30px 38px 30px 30px"
---

# Design System: Feedbacks

## Overview

**Creative North Star: "The marked-up review desk"**

The public landing uses actual product captures, concise conversational copy and red pencil annotations on a white desk. Bold Manrope carries the reading hierarchy; small Caveat notes add a human voice. Muted green, peach and blue scene backgrounds distinguish capture, review and the shared thread without competing with the screenshot.

The application and extension keep their focused system-font interface, Oxford actions and existing theme behavior. Their density serves reviewing, setup and resolution. Each surface retains its own scale. Other public pages retain their existing warm-paper and coral website palette; landing overrides do not redefine those surfaces.

**Key Characteristics:**

- Actual product pixels with clearly labeled fictional demo content.
- Brief handwritten notes and target-pointing pencil marks.
- Flat scene surfaces with a small tilt on desktop screenshots.
- Direct setup guidance and deliberate, user-started motion.

## Colors

### Primary

Landing ink carries reading and actions; pencil red marks emphasis and the selected workflow step. A slightly darker capture-mark red points to the actual control inside each captured screen.

### Secondary

Capture green, review peach and thread blue give each walkthrough state a distinct quiet surface. The agent highlight and setup surface support the handoff and onboarding areas.

### Neutral

Landing paper, secondary text and line colors provide the white canvas, supporting copy and thin rules. Site ink, paper and coral retain the incumbent palette for other public pages.

Oxford is the application's action color. Preserve the app's [theme overrides](src/web/theme.css) and the extension's [semantic variables](extension/appearance.css). Frontmatter colors record light-mode values, not replacements for dark-mode tokens.

Unsent review pins use rust `review-draft` with a dashed white border. Published pins remain Oxford. The distinction signals local versus shared state before a reviewer opens a tooltip.

## Typography

The landing uses self-hosted Manrope for reading, controls and bold headings, with self-hosted Caveat only for short pencil notes. Frontmatter records the default desktop hierarchy from [landing.css](site/landing.css). The hero becomes 80px at 1450px and wider; at 900px and below it uses `clamp(36px, 6.2vw, 48px)` with a 1.1 line height, overridden to 42px between 600px and 900px. Pencil notes become 28px at 1050px and below. Supporting prose remains upright Manrope; handwritten text never carries a setup instruction by itself.

**The Reading Voice Rule.** Use Manrope for product explanation and controls; reserve Caveat for brief annotations alongside the evidence.

Application body text uses the system stack at 15px/1.55; extension body text uses system-ui at 15px/1.5. Preserve the compact hierarchy in task screens. Website display typography does not set application typography. Font licensing and provenance are recorded in [website assets](docs/website-assets.md).

## Layout

The landing wrapper is at most 1280px wide, with 48px side gutters by default, 32px at 1050px and below, and 18px at 900px and below. The desktop introduction pairs headline and setup action; the scene pairs a large screenshot and a short note. At 900px and below, the first scene uses a legible detail crop of the actual capture, while zoom always opens the complete original. Between 600px and 900px the detail and note remain side by side; smaller screens stack them. The compact introduction and control row keep the screenshot near the first viewport. Setup links use four columns, changing to two at 1050px. Other website pages keep their incumbent wrapper breakpoints.

Application forms group related controls; optional settings use disclosure sections. Help presents setup and capture as ordered steps, with wrapping guide links and a server URL field beside its copy action. That field and action stack at 600px and below. The extension popup stays compact at 368px wide, with secondary capture tools and diagnostics disclosed as needed.

## Elevation & Depth

The landing relies on flat tonal scenes, thin screenshot borders and a small desktop screenshot tilt. Pencil marks sit over the captured image without altering its pixels. No hard offset shadow is part of the landing system. Application overlays retain their existing shadows where depth separates floating controls from review content; ordinary Help sections use rules and spacing.

## Shapes

Landing actions have compact rounded corners, screenshots have softly rounded clipped edges, and scene containers use a larger radius that tightens on small screens. The Play control is pill-shaped. Loose red circles, underlines and target-pointing paths supply the hand-drawn silhouette. Application buttons use 7px corners, fields use 8px, and status badges use 4px. Extension controls keep their 8px corners. Circular pins identify feedback points.

## Components

### Actions and fields

The landing primary action is ink-filled with white text, a 52px minimum height and a 180ms lift transition; its narrow-screen minimum height is 48px. Hover changes the fill and lifts it 2px; reduced motion removes the transition and lift. Website actions outside the landing retain their existing 48px minimum height. Application buttons and fields have a 44px base minimum height; preserve intentional compact extension overrides for secondary controls. App primary hover and active colors are `#254762` and `#10283e`. The extension has its own `--accent-hover` value.

Use native links, buttons, fields and summaries with visible focus. Website focus is a 3px `#2159b1` outline with a 5px offset; application focus is a 2px `#3875a9` outline with a 2px offset. Read-only values remain selectable and copy failures provide manual instructions.

### Public onboarding and screenshot walkthrough

The primary landing action is **Set up Feedbacks**, linking to the website's own getting-started docs. Setup and audience guides also link to local website docs. Server setup comes first; the extension connects to that installation. GitHub remains a source link, separate from the setup route.

The walkthrough follows **Point it out**, **Check & send** and **Fix with your agent** through actual extension and app captures of the fictional Good Form project. Save point is a local draft; Review & send opens the evidence review; Send feedback shares checked notes and screenshots. The server thread shows the submitted request, not proof that an agent fixed it. [Asset provenance](docs/website-assets.md) records the screenshot source and font licenses.

Native step buttons expose `aria-pressed`; selection updates the screenshot, pencil target, short note and guide link together, with prose in a polite live region. Play starts only on request, advances every 6.5 seconds and stops after the last scene. Pause, manual selection, opening the screenshot and hiding the tab stop playback. Scene entrance uses a 350ms fade/8px rise and the background changes over 400ms; reduced motion disables those transitions and the entrance animation. A preference change stops playback. The first scene and its content exist in the initial HTML.

The screenshot button opens a native dialog containing the full unmodified capture. Close and Escape dismiss it, and the image can scroll on narrow screens. Responsive cropping improves the inline first-scene detail without changing the original shown in zoom. [site/index.html](site/index.html), [landing.css](site/landing.css) and [site/site.js](site/site.js) are the source for these states.

**The Evidence Rule.** Annotate actual product captures separately, label fictional demo content and keep the full original available for inspection.

### Help and extension setup

[Help](src/web/help.tsx) offers guides for clients, reviewers/testers, DevOps and resolving developers. It explains the owner responsibility for projects, context, optional GitHub, members and profiles. **Copy server URL** copies the current installation's origin from a selectable read-only field; clipboard failure keeps manual copying available. Agent setup uses each member's own identity and retains its permission disclosure.

The [extension popup](extension/popup.html) states the running-server and account prerequisites before connection. First-use guidance covers installing, pinning, connecting, capturing, reviewing and sending. Connected review controls remain compact and task-focused.

### Navigation and review controls

Navigation preserves applied filters and protects unsaved drafts. Optional organization, personal views and diagnostics use disclosure sections. Screenshot comparison preserves proportions and provides a labeled native range control. Arrow-key navigation must not intercept typing, selectors, sliders or dialogs. Keep response obligation, work status and delivery evidence distinct.

## Do's and Don'ts

### Do

- Do preserve each surface's existing typography, palette and theme behavior.
- Do use exact action labels and distinguish local drafts from sent feedback.
- Do preserve original screenshot proportions in zoom and label fictional demo evidence.
- Do keep drafts safe during navigation and failed requests.
- Do keep landing explanations brief, use pencil marks to point at evidence, and link setup guidance to the website docs.

### Don't

- Don't invent successful writes, automatic fixes, integrations or customer evidence.
- Don't apply marketing display styles to the application or extension.
- Don't treat reviewer guidance or weights as authorization.
