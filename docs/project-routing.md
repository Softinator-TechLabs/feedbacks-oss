# Project routing from the extension

An owner can create a project in **Projects → New project** in Feedbacks. The Projects index is the connected server's root path (`/`). Add each website's exact origin and grant colleagues reviewer or maintainer access. An origin is the scheme, host and any non-default port, without a page path, query or fragment: for example, `https://example.org` or `http://localhost:4175`.

The extension popup lists only projects returned for the connected account that grant write access and explicitly include the current tab's exact origin:

- One matching project: selected automatically, with its name and website shown. Click **Start review**.
- Several matching projects: choose explicitly from those matches, then click **Start review**. This choice is not remembered between popup openings; a global last-used project never selects a different website's destination.
- No matching project: review stays disabled. Ask an owner to add this exact origin in Projects and grant review access. **Open Projects** uses the currently connected Feedbacks server.
- Unsupported browser pages and the Chrome Web Store: review stays disabled; open a supported HTTP(S) website instead.

`http://example.org`, `https://example.org`, `https://www.example.org`, subdomains and non-default ports are separate approvals. Routing never adds wildcard access or infers approval from a similar hostname. Read-only projects are not selectable.

Only the explicit **Start review** click requests website permission; Chrome may show a one-time permission prompt. Opening the popup or selecting a project does not request website permission, capture a screenshot or upload feedback. If the active website or connected server changes while the popup is open, reopen it before reviewing. The background still rechecks the current origin and project permission during activation.

After starting review, choose an element and use **Capture & annotate**. The captured draft stays bound to that review's project and server. Inspect the image, annotate and write your comment, then explicitly **Send feedback**. Auto-selection is not auto-capture or auto-upload. **Resume pending draft**, pairing and disconnect remain separate controls.
