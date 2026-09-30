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
    fontSize: "clamp(40px, 4.5vw, 64px)"
    fontWeight: 800
    lineHeight: 1.1
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

- Actual product pixels; capture provenance belongs in the asset documentation.
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

Project tags use a restrained seven-color palette: slate, blue, teal, mint, amber, rose and violet. The exact paired light/dark backgrounds, text and borders live in [taxonomy.css](src/web/threads/taxonomy.css). A new tag's name selects its initial palette entry deterministically; a project maintainer may change it. Category badges stay neutral so tag colors do not imply work status or priority.

Unsent review pins use rust `review-draft` with a dashed white border. Published pins remain Oxford. The distinction signals local versus shared state before a reviewer opens a tooltip.

## Typography

The landing uses self-hosted Manrope for reading, controls and bold headings, with self-hosted Caveat only for short pencil notes. Frontmatter records the default desktop hierarchy from [landing.css](site/landing.css), with the hero display overridden by [product-story.css](site/product-story.css). The hero uses a 1.1 line height and becomes 45px at 1050px and below, `clamp(38px, 7vw, 54px)` at 800px and below, and 38px at 480px and below. Pencil notes become 28px at 1050px and below. Supporting prose remains upright Manrope; handwritten text never carries a setup instruction by itself.

**The Reading Voice Rule.** Use Manrope for product explanation and controls; reserve Caveat for brief annotations alongside the evidence.

Application body text uses the system stack at 15px/1.55; extension body text uses system-ui at 15px/1.5. Preserve the compact hierarchy in task screens. Website display typography does not set application typography. Font licensing and provenance are recorded in [website assets](docs/website-assets.md).

## Layout

The landing wrapper is at most 1280px wide, with 48px side gutters by default, 32px at 1050px and below, and 18px at 900px and below. The desktop introduction pairs the headline and setup action with actual recording-review captures. The hero and alternating product sections stack at 800px and below. The product-capture walkthrough follows in its own section, pairing a large screenshot with a short note; zoom opens the complete original. Text-suggestion, evidence-bundle and project-context diagrams use dedicated mobile compositions at 600px and below. On desktop viewports up to 760px tall, tighter spacing keeps the hero and recording controls together. Other website pages keep their incumbent wrapper breakpoints.

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

Native landing step buttons expose `aria-pressed`; selection updates the shared player, short note and guide link together. The selected sequence plays automatically: the cursor approaches the real control, a left/right click is visible, the field types the note, and a red pencil stroke draws attention to the action. Each action takes 3.6 seconds. **Pause** / **Play** and clicking the image hold/resume the same moment; numbered controls select completed actions. Playback pauses offscreen/in hidden tabs and starts paused for reduced motion. A separate expand icon opens the full screenshot in a native dialog. Frame crops and motion cues share the same original-pixel coordinates. The stage stays the same size within each sequence. Keep the interface focused on the task: no display-mode switch, demo-account label or media-production notes.

The first scene and its copy exist in the initial HTML. The [shared player](public/learn/demo.js) is reused in docs and optional Help disclosures; source and capture provenance are in [website assets](docs/website-assets.md).

**The Evidence Rule.** Annotate actual product captures separately, document fictional content in asset provenance and keep the full original available for inspection.

### Help and extension setup

[Help](src/web/help/index.tsx) is a short, three-step connection flow for an already-running server: project readiness, extension connection and personal agent setup. It checks the selected project's active teammates and published agent context before showing completion text; missing access/context links to the corresponding project controls. A project picker keeps multiple projects distinct. **Copy server URL** copies the current installation's origin from a selectable read-only field. **Set in extension** uses the bridge installed when the reviewer opens the pinned icon on that tab, then opens extension Settings. The first activation detects an empty server setting; unavailable bridges explain how to open the icon. Both actions sit below the full-width URL and stack on mobile. **Create key & copy prompt** retains the key's permission disclosure, clipboard fallback and Account link for narrower permissions. Full instructions live in the public docs.

The [extension popup](extension/popup.html) states the running-server and account prerequisites before connection. First-use guidance covers installing, pinning, connecting, capturing, reviewing and sending. Connected review controls remain compact and task-focused.

### Navigation and review controls

Account groups agent setup, connections, owner links and security in keyboard-accessible tabs. At narrow widths all tabs stay visible in two rows. Active credentials appear first; extension and expired/revoked lists use disclosures. Newly created owner links show a four-character ending, while older hashed links state that the ending is unavailable. The mobile Menu overlays navigation without moving the header or page content.

Project Members uses People, Invite, Create user and Add existing tabs for owners; a selected person's details stay within People. Project Settings uses Project, Categories & tags, Integrations and Advanced tabs. Keep every panel mounted while switching so drafts and one-time credentials remain available. Existing operation boundaries and owner permissions still govern every action.

Navigation preserves applied filters and protects unsaved drafts. Thread rows keep a narrow selection column at every breakpoint, with actions below the content on mobile. The Saved views icon stays in the filter panel’s top-right corner without reserving a separate column. Top priority uses the same outlined control treatment as Archive. Optional organization, personal views and diagnostics use disclosure sections. Screenshot comparison preserves proportions and provides a labeled native range control. Arrow-key navigation must not intercept typing, selectors, sliders or dialogs. Keep response obligation, work status and delivery evidence distinct.

## Do's and Don'ts

### Do

- Do preserve each surface's existing typography, palette and theme behavior.
- Do use exact action labels and distinguish local drafts from sent feedback.
- Do preserve original screenshot proportions in zoom and document fictional demo evidence in asset provenance.
- Do keep drafts safe during navigation and failed requests.
- Do keep landing explanations brief, use pencil marks to point at evidence, and link setup guidance to the website docs.

### Don't

- Don't invent successful writes, automatic fixes, integrations or customer evidence.
- Don't apply marketing display styles to the application or extension.
- Don't treat reviewer guidance or weights as authorization.

The landing opening is a two-column composition on desktop: positioning and setup action on the left, a compact recording timeline illustration on the right. At 800px and below it stacks. Keep the three capture-walkthrough choices and player controls visible together. Comparisons are an open section and primary navigation destination. The capture walkthrough on landing, docs and Help exposes a shared Pause all / Play all control; the illustrative recording timeline has its own Play example / Pause example control.

All native selects inherit the shared form control border, surface and 44px minimum height. Their 16px chevron sits 12px inside the right edge, with room for selected text; forced-colors mode uses the system arrow. The Help project switcher uses a 48px full-width field; review evidence keeps the Points filter labelled and responsive beside its counts, with each screenshot shown inline by its point. Keep native keyboard and mobile selection behavior.

Thread screenshots captured with separate point metadata draw the reviewer's chosen marker over the image: no marker, outline circle, solid circle, arrow or numbered pin, in small, medium or large size. The default is a small red outline circle without a number or selection box. The extension Settings save the default; hover Page Controls override it for one review. Each marked image has its own Hide pins / Show pins control above the image; hiding pins reveals the approved page pixels underneath. Point metadata and per-point screenshots remain available with No marker. Older screenshots with baked pins state that limitation instead of offering a false hide action.

## Public feature storytelling

The landing now opens with concise free Apache-2.0 positioning beside a user-started walkthrough of actual recording-review captures. Three selectable events connect a click, failed request and console error. The existing product-capture walkthrough follows in its own section. Alternating editorial sections show exact text suggestions, portable evidence and approved project context; a compact linked directory exposes the remaining review workflows. The setup order remains server first.

Landing diagrams use the established green, peach and blue scene colors, clear geometry and ordinary product vocabulary. Explanatory diagrams are labelled as illustrative. The hero uses screenshots of the actual extension video-review renderer, with its native timeline and diagnostic tabs; only the recording data is synthetic. The full screenshot opens through Enlarge. Real captures retain their original pixels and provenance. Docs use Manrope and warm paper with a rust link color in light mode, preserving accessible dark mode. Shared diagrams and short task guides link to canonical reference manuals. Motion is optional and off by default for the new timeline; manual controls always work.

Keep promotional claims distinct: the landing states free Apache-2.0 licensing once in its hero. Later sections explain separate capabilities and setup; avoid repeating a licensing banner or the same setup links as a second role menu.
