---
name: "Feedbacks"
description: "Website feedback with clear context for developers and their AI agents."
colors:
  app-oxford: "#17324d"
  review-draft: "#a43e17"
  site-ink: "#202020"
  site-paper: "#fffdfa"
  site-coral: "#db4939"
  site-coral-text: "#a93729"
  site-example-surface: "#f1eee9"
typography:
  app-body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "15px"
    lineHeight: 1.55
  site-display:
    fontFamily: "Manrope, sans-serif"
    fontSize: "clamp(38px, 5.1vw, 70px)"
    fontWeight: 800
    lineHeight: 1.12
    letterSpacing: "-0.035em"
---

# Design System: Feedbacks

## Overview

**Creative North Star: "Context your AI agent can use"**

The public website explains visual feedback through warm paper, heavy Manrope type and coral accents. Plain language and one concrete illustrated request make the evidence and next action easy to understand. This refinement preserves the existing identity.

The application and extension keep their focused system-font interface, Oxford actions and existing theme behavior. Their density serves reviewing, setup and resolution. Each surface retains its own scale.

## Colors

Website ink and paper establish the canvas; coral remains the brand accent. The darker coral text color marks landing-page emphasis, the selected workflow step and the example pin. The workflow illustration has a warm neutral backing.

Oxford is the application's action color. Preserve the app's [theme overrides](src/web/theme.css) and the extension's [semantic variables](extension/appearance.css). Frontmatter colors record light-mode values, not replacements for dark-mode tokens.

Unsent review pins use rust `review-draft` with a dashed white border. Published pins remain Oxford. The distinction signals local versus shared state before a reviewer opens a tooltip.

## Typography

The landing headline uses the frontmatter display scale from [landing.css](site/landing.css). Landing section headings use `clamp(28px, 3.2vw, 43px)` with a 1.2 line height. The larger generic website heading rule in [site.css](site/site.css) is not the landing hero's effective size.

Application body text uses the system stack at 15px/1.55; extension body text uses system-ui at 15px/1.5. Preserve the compact hierarchy in task screens. Website display typography does not set application typography. Font licensing and provenance are recorded in [website assets](docs/website-assets.md).

## Layout

The website wrapper is at most 1280px wide, with 48px side gutters by default, 28px at 1050px and below, and 18px at 720px and below. The landing page uses left-aligned sections, a two-column illustration and handoff, and ruled setup and role rows. At 760px and below, its section headings, workflow, context and role rows become single-column layouts.

Application forms group related controls; optional settings use disclosure sections. Help presents setup and capture as ordered steps, with wrapping guide links and a server URL field beside its copy action. That field and action stack at 600px and below. The extension popup stays compact at 368px wide, with secondary capture tools and diagnostics disclosed as needed.

## Elevation & Depth

The current landing composition relies on flat tonal panels and thin borders. Its illustrated browser is contained by a border, without rotated scraps or raised cards. Application overlays retain their existing shadows where depth separates floating controls from review content; ordinary Help sections use rules and spacing.

## Shapes

Website buttons use 6px corners; the illustrated browser uses 12px corners and clips its contents. Application buttons use 7px corners, fields use 8px, and status badges use 4px. Extension controls keep their 8px corners. Circular pins identify feedback points.

## Components

### Actions and fields

Website primary actions are ink-filled with white text, a 48px minimum height and a 150ms color/background transition. Application buttons and fields have a 44px base minimum height; preserve intentional compact extension overrides for secondary controls. App primary hover and active colors are `#254762` and `#10283e`. The extension has its own `--accent-hover` value.

Use native links, buttons, fields and summaries with visible focus. Website focus is a 3px `#2159b1` outline with a 5px offset; application focus is a 2px `#3875a9` outline with a 2px offset. Read-only values remain selectable and copy failures provide manual instructions.

### Public onboarding and workflow illustration

The primary landing action is **Set up your team server**; the header says **Set up your server**. The secondary hero link helps teams that already have a server connect the extension. Keep source, docs and the extension installation path easy to find. The extension does not create or host the server.

One stable illustrated example follows **Point & comment**, **Review & send** and **Read with an agent**. Save point is a local draft; Review & send opens the evidence review; Send feedback shares checked notes and screenshots. The developer connects their own agent through MCP, asks for the agreed change, verifies it and records actual evidence before resolving.

Native step buttons expose `aria-pressed`; selection updates the title, description, evidence, state and next action in a polite live region. There is no automatic advance or pencil animation. The example remains explicitly illustrative. [site/index.html](site/index.html) and [site/site.js](site/site.js) are the source for its content and states.

### Help and extension setup

[Help](src/web/help.tsx) offers guides for clients, reviewers/testers, DevOps and resolving developers. It explains the owner responsibility for projects, context, optional GitHub, members and profiles. **Copy server URL** copies the current installation's origin from a selectable read-only field; clipboard failure keeps manual copying available. Agent setup uses each member's own identity and retains its permission disclosure.

The [extension popup](extension/popup.html) states the running-server and account prerequisites before connection. First-use guidance covers installing, pinning, connecting, capturing, reviewing and sending. Connected review controls remain compact and task-focused.

### Navigation and review controls

Navigation preserves applied filters and protects unsaved drafts. Optional organization, personal views and diagnostics use disclosure sections. Screenshot comparison preserves proportions and provides a labeled native range control. Arrow-key navigation must not intercept typing, selectors, sliders or dialogs. Keep response obligation, work status and delivery evidence distinct.

## Do's and Don'ts

### Do

- Do preserve each surface's existing typography, palette and theme behavior.
- Do use exact action labels and distinguish local drafts from sent feedback.
- Do preserve original screenshot proportions and label illustrative evidence.
- Do keep drafts safe during navigation and failed requests.

### Don't

- Don't invent successful writes, automatic fixes, integrations or customer evidence.
- Don't apply marketing display styles to the application or extension.
- Don't treat reviewer guidance or weights as authorization.
