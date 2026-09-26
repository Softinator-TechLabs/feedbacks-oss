# Inline multi-point review

## Goal

One review can contain several comments, each written beside and linked to the element selected on the website. The screenshot editor opens after the reviewer finishes selecting points; its overall comment is optional.

The submitted thread must keep every numbered point discoverable on the original
page and in Feedbacks. Drawn marks are baked into the approved screenshot;
attachment metadata should also tell MCP clients where each mark and screenshot
section belongs, including the optional merged full-page image.

## Implementation

- Preserve each point's text and anchor as ordered `context.annotations` in the existing thread context JSON. Keep `context.anchor` as the first point for older clients and view grouping. No migration is needed.
- In the extension's shadow UI, outline the selected element, focus an inline textarea, and keep numbered draft pins while the reviewer selects more points. The native capture action and automatic right-click path must enter this same flow.
- Capture only after **Review screenshots**. Carry the ordered annotations into the local draft, mark the corresponding screenshot points, and show the ordered comments in the editor before Send.
- Store a readable body assembled from the point comments and optional overall note, while retaining each structured anchor/text pair for the web app, API, MCP and CLI.
- Add bounded, normalized marking metadata and page ranges to screenshot assets. Render the corresponding point notes and screenshot locations together on the web thread, with mobile touch access.

## Acceptance and evidence

- [x] Right-click highlights the target and gives an in-page text field without opening the editor.
- [x] Two separate points can be saved, edited or removed before capture; order and selectors survive submission.
- [x] The editor shows both notes and permits an empty overall comment.
- [x] The thread shows ordered comments beside their element context; API/MCP context contains the same data.
- [x] Capture and send failure keep the draft; older single-point threads remain readable.
- [x] Run focused tests, typecheck, extension build, browser UI smoke and full required checks.
- [x] Reopened webpage shows every confidently matched point; mouse or keyboard focus shows that point's full text.
- [x] Web thread shows point notes beside the marked image and can jump to a point on mobile.
- [x] MCP/CLI thread and asset metadata explain ordered pages, combined image, point positions and drawing marks.

The browser smoke checked desktop and mobile inline composition, two distinct
selectors on a submitted thread, no overall note, and ordered screenshot markers
for points on separate scroll positions. It reopened the page, hovered both saved
pins, selected a point in the mobile web thread, and verified point, arrow and
pencil metadata on the uploaded asset. The combined-image run verified the
retained section map after deleting an intermediate screenshot. The existing
capture smoke also checked partial upload recovery and previously supported
capture modes. `npm run check` and `npm run qa:extension-browser` passed after
the implementation.

## Compatibility

`context.annotations` is optional. Existing readers continue to use `context.anchor` and `body`. Extension versions before this feature see a combined textual body and the first anchor. The per-point structured fields are additional untrusted review content.
