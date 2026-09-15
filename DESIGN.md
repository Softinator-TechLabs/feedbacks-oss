---
name: "Feedbacks"
description: "White, Oxford blue, and clear context across the app, extension, and public website."
colors:
  oxford: "#17324d"
  ink: "#202c37"
  secondary: "#596672"
  white: "#fff"
  line: "#dce1e5"
  quiet: "#f5f7f9"
  site-action-hover: "#244b6f"
  site-focus: "#377fbe"
  app-focus: "#3875a9"
  app-control-border: "#adb8c1"
  app-control-hover: "#7b8c99"
typography:
  app-body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "15px"
    lineHeight: 1.55
  app-heading:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "1.7rem"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  app-section:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "1.15rem"
    fontWeight: 650
    lineHeight: 1.4
  site-display:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "clamp(46px, 4.8vw, 68px)"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  site-headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "clamp(34px, 3.4vw, 46px)"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  site-title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "20px"
    fontWeight: 550
    lineHeight: 1.35
    letterSpacing: "-0.015em"
  site-body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "16px"
    lineHeight: 1.6
  site-lede:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "18px"
    lineHeight: 1.7
  site-label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "12px"
    lineHeight: 1.6
  site-discussion:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    lineHeight: 1.7
  site-action:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "15px"
    fontWeight: 550
    lineHeight: 1.6
  site-text-action:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 550
    lineHeight: 1.6
rounded:
  control: "8px"
  site-tool: "6px"
  site-demo: "10px"
  site-state: "4px"
spacing:
  control-gap: "8px"
  site-small: "12px"
  site-inset: "18px"
  site-mobile-gutter: "20px"
  site-medium: "24px"
  site-tablet-gutter: "32px"
  site-section-gap: "36px"
  site-desktop-gutter: "48px"
  site-column-gap: "70px"
components:
  app-button-primary:
    backgroundColor: "{colors.oxford}"
    textColor: "{colors.white}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
  app-input:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  site-button-primary:
    backgroundColor: "{colors.oxford}"
    textColor: "{colors.white}"
    typography: "{typography.site-action}"
    rounded: "{rounded.control}"
    padding: "12px 22px"
  site-button-primary-hover:
    backgroundColor: "{colors.site-action-hover}"
    textColor: "{colors.white}"
  site-text-link:
    textColor: "{colors.ink}"
    typography: "{typography.site-text-action}"
  site-copy-button:
    backgroundColor: "{colors.white}"
    textColor: "{colors.oxford}"
    rounded: "{rounded.site-tool}"
    padding: "8px 13px"
  site-stage-selected:
    backgroundColor: "{colors.oxford}"
    textColor: "{colors.white}"
    rounded: "{rounded.site-tool}"
    padding: "7px 17px"
  site-demo:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.site-demo}"
  site-state:
    backgroundColor: "#eef3f7"
    textColor: "{colors.oxford}"
    typography: "{typography.site-label}"
    rounded: "{rounded.site-state}"
    padding: "2px 7px"
  site-workflow-row:
    textColor: "{colors.ink}"
    padding: "27px 0"
  site-navigation:
    textColor: "{colors.ink}"
---

# Design System: Feedbacks

## Overview

**Creative North Star: "Review in place"**

Feedbacks keeps the point under review, its conversation, and the recorded outcome close together. Restrained sans-serif typography, white work surfaces, Oxford actions, and dividing rules make that context readable. Product evidence supplies the visual interest.

The existing application and extension retain their compact, task-oriented design. The public website extends the same identity with larger headlines and more open spacing. Website-specific tokens and patterns are scoped with `site-`; they do not replace the application's heading scale, controls, navigation, or appearance behavior.

**Key Characteristics:**

- White canvas and work surfaces, with restrained Oxford actions.
- One pinned system sans-serif stack across all three surfaces.
- Divided rows and readable context instead of decorative containers.
- Public website headlines paired with a clearly labeled illustrative workflow.
- Visible keyboard focus, legible states, and stable demonstration geometry.

Source authority: `src/web/styles.css`, `src/web/forms.css`, and `src/web/theme.css`
for the app; the existing extension rules below; and `site/index.html`, `site/site.css`,
`site/site.js`, and `site/privacy.html` for the public website. Documentation records
the built UI; deployment and independent acceptance are separate receipts.

## Colors

The light identity uses a white canvas, dark readable text, subtle rules, and one Oxford
action accent. The frontmatter holds normative color values.

### Primary

- **Oxford** identifies primary actions, selected workflow controls, navigation, and
  feedback markers. Website primary-action hover has its own scoped token.
- **Focus blue** has separate app and website tokens because their existing keyboard
  outline treatments differ.

### Neutral

- **White** is the application background, work-surface color, and website canvas,
  including its integrations section.
- **Ink** carries principal text; **Secondary** carries supporting copy and metadata.
- **Line** divides sections, workflow rows, and attached context.
- **Quiet** is limited to supporting inset material such as the synthetic reviewed page
  and source-command block. It does not replace the white site canvas.
- App control-border tokens retain the incumbent input outline and hover treatment.

The app's header sun/moon control switches the complete application between light and
dark, remembering the choice on this browser. Light is the default pure-white canvas.
Dark uses graphite surfaces, pale Oxford actions, and separately paired foreground and
background hover and disabled states. The extension respects the device's dark appearance.
The public website currently declares a light color scheme.

**The White Canvas Rule.** Keep light application work surfaces and the public website's section backgrounds white. Use tints for specific inset content and interaction or status states.

## Typography

The user-pinned system sans-serif stack is shared by display, body, and controls. Its
plain character remains part of the identity when the public website uses larger type.
Native monospace is used for source commands and operation identifiers.

### Application and extension

Body text, principal headings, and section headings retain the `app-body`, `app-heading`,
and `app-section` roles. Their scale stays compact. Common thread tools use labeled icon
buttons with tooltips, while discussion, status, save, and navigation retain visible words.

### Public website

- **Display** is reserved for the left-aligned landing-page statement. Its base width
  limit is nine ems; the authored line break remains part of the composition.
- **Headline** introduces major sections. **Title** introduces ruled workflow rows.
- **Body** carries explanations. **Lede** is used for the opening description; responsive
  adjustments are listed in Layout.
- **Label** keeps example metadata readable. Demo controls use the same size with a
  medium weight. The website's example labels remain at least twelve pixels.
- **Discussion** stays at fourteen pixels with generous leading across desktop and
  mobile. It remains visibly distinct from compact metadata.
- **Action** and **Text action** preserve the hierarchy between filled buttons and
  adjacent source links. Section descriptions generally use a 39–58ch maximum measure;
  the desktop hero description uses 36ch.

**The Surface Scale Rule.** Use the public website's display scale only on that public surface. Preserve the app and extension's compact heading hierarchy.

## Layout

### Application and extension

Navigation is a compact horizontal application header followed by project breadcrumbs
and four project sections. Project and thread lists use divided rows. Ordinary project
and thread navigation retains the application shell, revalidates the session, and isolates
each route's form state. Administrative and capability routes retain document navigation.
Unsent edits warn before leaving.

Threads present the feedback and screenshot beside a discussion pane. Discussion is the
default; Details holds page context and collapsed workflow tools. At 760px the panes
stack. Technical selectors and exact JSON remain available through disclosure, with
compact human-readable viewport values in the main context.

The capture editor reserves a wide drawing area with a 340–400px comment pane; below
960px it stacks. Page and device details and masking explanations remain accessible by
disclosure.

### Public website

The content container caps at 1280px, with 48px side gutters before the cap. The hero is
an asymmetric two-column grid (`0.82fr 1.18fr`) with a 48px gap and 85px/110px top/bottom
padding. The review example carries the larger column. Major explanatory sections use
paired columns and thin horizontal rules; workflow rows pair a title with its explanation
without enclosing each item in a card.

| Width condition | Built behavior                                                                                                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| At least 1600px | Hero column gap grows to 68px.                                                                                                                                                                                                                    |
| At most 1150px  | Gutters become 32px; hero uses `0.75fr 1.25fr`, a 32px gap, and a 47px heading. Main section gaps reduce to 50px.                                                                                                                                 |
| At most 900px   | Hero and major section introductions stack. Hero heading becomes 60px, description 18px, and hero gap 44px. The example keeps two internal panes; workflow rows retain paired columns.                                                            |
| At most 600px   | Gutters become 20px. Header navigation wraps into a full-width row. Hero heading uses `clamp(39px, 11vw, 58px)` and description 16px. Example panes and workflow rows stack. Main section headings become 36px. Footer and hosting content stack. |

The example is not scaled down as an image on mobile. The reviewed page appears before
the discussion, retaining the marker, context, and all three stage controls. The mobile
reviewed page reserves a 390px minimum height. All stages reserve the same reply track
(150px); the hidden reply retains layout space. The explanation reserves a minimum 82px
height, so changing stages keeps the surrounding composition steady.

The privacy page reuses the same shell and palette with a 760px maximum reading width.
Its headline is 48px, reduced to 39px on small screens; section headings are 25px. Source
commands scroll within their own inset when necessary instead of widening the page.

## Elevation & Depth

The app, extension, and public website use flat surfaces. Thin borders, dividing rules,
whitespace, and a limited quiet inset communicate grouping. Shadows and gradients are
not part of this visual vocabulary. The website example's outer border and internal rules
provide its depth; the integrations section stays white.

## Shapes

Buttons and inputs retain softly squared control corners. Website copy and stage tools
use the smaller tool radius, the demonstration has the larger outer radius, and its status
badge uses the compact state radius. The round numbered marker identifies an actual
feedback point in the example; it is not decorative section numbering.

Private application screenshots keep their natural aspect ratio and can open at full size.
Screenshot pixels are never inverted by appearance changes. The public website's visual
example is authored HTML and CSS, and its arrows and brand mark are authored SVG. There
are no shipping raster images on this public surface.

## Components

### App and extension controls

Buttons and inputs retain a 44px minimum height, while compact icon tools remain 40px.
Field labels have an 8px control gap, leaving clear space around the app's 2px keyboard
outline and its 2px offset. Forms retain native labeled inputs, inline validation, and
visible pending states. Error and success feedback appears adjacent to the relevant
action. Empty states explain the next useful action without fabricated records.

Reply text supports inline @member suggestions with keyboard selection; there is no
standalone member-selection form. Message intent remains under Options; request and
response semantics are unchanged. Work-state badges use restrained semantic colors.
Response state remains independent plain text.

The extension popup and capture editor share these control tokens. The Text tool alone
reveals its label input; status messages use neutral text unless they report an error or
successful send. Connection settings collapse after pairing while project choice and
Start review remain visible.

### Website actions and navigation

Filled Oxford actions are at least 48px high. Text actions, stage controls, copy controls,
and the landing-page navigation links have 44px minimum heights. Website links and
buttons receive a 3px focus outline with a 5px offset. Primary hover uses the scoped
website hover color; secondary text links gain an underline. Directional arrows are
inline SVG strokes with rounded ends, carrying the link's current text color.

The website's prominent actions lead to self-hosting and source inspection. Hosting is a
secondary text-link inquiry beneath the setup section. Preserve that relative visual
weight; the current page does not present a hosted sign-up action.

### Illustrative review example

The example is visibly labeled "Illustrative example." Capture, Discuss, and Resolve
are real buttons with `aria-pressed` state. Selection updates the status, reply, evidence,
and politely announced explanation. Selected controls use Oxford and white; unselected
controls use secondary text and a light hover treatment. Resolution changes the point
and status to restrained green and moves the annotated target downward by 19px.

The target motion uses a transform over 350ms with `cubic-bezier(0.16, 1, 0.3, 1)`;
layout space stays reserved. Reduced-motion preference disables transitions. The example
starts in Capture and exposes its initial content without JavaScript; a noscript message
explains how to enable the other stages. It is illustrative content, not a real customer
thread or evidence that a production action occurred.

**The Stable Context Rule.** Keep the original reviewed point and context visible while the example changes stage. Reserve reply and explanation space so the page does not move when the visitor selects Capture, Discuss, or Resolve.

### Ruled content and source commands

Workflow, permissions, and ownership explanations use divided rows. The integrations
example aligns plain operation descriptions with monospace identifiers. The source block
uses the quiet inset and a readable code measure. Copy commands appears only when the
Clipboard API is available, disables while pending, and reports success or a manual-copy
fallback through a nearby status message. The command text remains selectable.

## Do's and Don'ts

### Do:

- **Do** preserve white light-mode work surfaces and the restrained Oxford accent.
- **Do** keep the pinned system sans-serif stack and use each surface's own type scale.
- **Do** group related content with spacing and rules while keeping context readable.
- **Do** keep synthetic examples explicitly labeled and separate from production evidence.
- **Do** retain the website's source and self-hosting action hierarchy.
- **Do** preserve keyboard focus, readable discussion text, and stable stage geometry.
- **Do** retain original screenshot proportions and pixels across appearance changes.

### Don't:

- **Don't** apply the public website's display headings to application or extension screens.
- **Don't** add decorative illustration, shadows, gradients, colored side-tabs, or card grids to the existing app and extension identity.
- **Don't** turn the website's white integrations section into a contrasting banner.
- **Don't** use decorative section numbering; the demonstration marker must identify a feedback point.
- **Don't** present invented records, successful writes, deployment, or storage claims as actual product evidence.
- **Don't** merge response state, work status, and reported outcome into one visual signal.
