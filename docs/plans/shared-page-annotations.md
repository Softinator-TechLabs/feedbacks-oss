# Shared page annotations

Status: implemented and locally verified. Date: 2026-09-27.

## Outcome

An inline point stays visibly local until the screenshot review is submitted. Published points on the original website identify their author and age, link to the shared Feedbacks thread, and can be resolved by a member with resolve permission. Project members see the same published points after refresh. A website menu covering a point also covers its marker.

## Work

- [x] Verify current draft, submit, project-thread read and resolve behavior with a browser fixture.
- [x] Distinguish unsent point markers from published markers on the page and in the compact review handle.
- [x] Give published markers an interactive, accessible detail card with author, relative time, thread link and authorized resolve action.
- [x] Hide markers when the page paints another element over their target, including menus opened by hover or keyboard.
- [x] Test separate reviewers, interrupted image upload, resolution and menu overlap; update the extension guide.
- [x] Pass final checks and package a development build.

## Boundaries

The server remains the authority for project grants and resolution. Local points are never described as shared. A denied or conflicted resolution leaves the pin visible and offers a refresh. The extension uses the existing optional website and server access grants.

## Verification

The browser fixture checks owner and reviewer sessions, published hover details, the thread link, server-side resolution, overlay occlusion and restoration, screenshot evidence, and interrupted upload retry. `npm run check` covers typechecking, security and integration tests, builds, and release checks. Production deployment and a user Chrome install of 0.1.23 are separate gates.

Local receipts: `npm run check` and `npm run qa:extension-browser` passed. The versioned unpacked build and ZIP are in Downloads; the ZIP SHA-256 is `47b1c932cdba10f9db092b6e98b4cfa944e9779f5ac8441fa8f3beab5e5e199c`.
