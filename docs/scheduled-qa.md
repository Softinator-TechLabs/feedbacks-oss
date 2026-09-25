# Scheduled page QA and visual baselines

Project maintainers can opt in under **Project settings → Scheduled page QA**. Enter one to three explicit public HTTPS page URLs on exact origins already approved for the project, then save and enable. URLs cannot contain credentials, a query, fragment or non-default port. A newly enabled project with no recent scan is due on the next worker tick; later scans are due daily. If a worker stops before recording its report, the scan stays due and can retry after its ten-minute lease expires. Re-enabling within an hour of a scan waits for that hour to pass. **Run soon** queues the next tick, subject to the same one-hour limit; it is unavailable while a scan is running. **Disable QA** stops new scans. Existing reports remain in the latest-20 history for review.

The worker downloads at most 256 KiB of HTML per page with a five-second timeout, no redirects, and DNS resolution pinned to a checked public address. It reports missing `alt` on static `<img>` tags as a count capped at `10+`. It sends HEAD requests to at most six same-origin links without queries or fragments and reports only HTTP 404/410 as definite broken links. Only HTTP 2xx, 404 and 410 count as checked links; redirects, unsupported HEAD responses and network errors remain unknown. The report retains the configured page URL, HTTP status, counts and broken-link paths; it does not retain HTML, credentials or screenshot bytes. A changed project origin stops scanning that URL and records an approval error. Scans never create threads or send feedback automatically.

This is a static public-page check. It cannot sign in, execute JavaScript, inspect authenticated dashboards or take browser screenshots. The [Chrome extension's optional QA scan](extension.md) remains a separate, reviewer-initiated action on the current tab and can create an editable local draft.

For a visual baseline, open a feedback thread with a private image attachment, expand **Visual baseline and comparison**, choose the image and select **Set first image as baseline**. A project maintainer sets the baseline; other project members can compare a second image from the same thread after it is attached. Equal-sized images can be compared on demand. Feedbacks returns the percentage of pixels that differ by more than 20 channel values and keeps the existing side-by-side and overlay views. Alignment, animation, fonts and different page positions can change pixels without indicating a product regression; a person must inspect the images and decide. No scheduled screenshot capture or visual diff is performed.

The typed `qa.get`, `qa.configure`, `qa.runNow`, `qa.runs`, `qa.baselineGet`, `qa.baselineSet` and `qa.compare` operations share server authorization across HTTP, MCP and JSON CLI. Scoped agent keys need explicit QA read or compare scopes. Configuration and baseline changes require project maintainer access; an owner-admin key still requires its own granted scope and current authority. Migration 15 stores the opt-in configuration, latest runs and baseline references. No existing project is enabled by migration.

## Local browser screenshot regression

An operator can opt in to a separate local Chromium check for one public HTTPS page. Install the locked Node dependencies with `npm ci` and the browser with `npx playwright install chromium`. Use only a page whose exact public origin you are authorized to inspect. Start with a clean baseline:

```sh
mkdir -p output/playwright
npm run qa:visual -- --url=https://example.com/page --origin=https://example.com --baseline=output/playwright/page-baseline.png --output=output/playwright/page-first.png --init-baseline=true --scripts=true
```

On a later run, use a fresh output path and omit `--init-baseline=true`. Keep the same `--scripts` setting and viewport for both captures. `--max-change=0.5` allows up to 0.5% changed pixels; the default is zero. The command exits 0 for a comparison within the threshold, 1 for a visual difference and 2 for invalid input or a failed capture. It prints the changed-pixel percentage and counts of requested and blocked resources. Candidate screenshots stay in the operator's local ignored `output/playwright/` folder; the command does not upload them or change project QA records. Baselines are never overwritten by the command. Keep private or customer screenshots outside source control.

The command uses a new browser context without cookies, downloads or permissions. By default it disables page JavaScript. `--scripts=true` runs JavaScript to render a public, unauthenticated SPA; use it only for an approved page you trust. It blocks peer transports, WebSockets, popups, foreign origins, queries, fragments and form submissions. Every allowed browser request is fulfilled by a same-origin GET through the server's checked public-DNS rule, without forwarding browser headers or cookies. It refuses redirects, non-HTML top-level responses, failed same-origin resources, more than 40 resources, any resource over 1 MiB and more than 4 MiB total. The viewport is fixed by default at 1280 × 800; `--width` accepts 320–1920, `--height` accepts 320–1200, with a 2-million-pixel maximum. Pages depending on authenticated APIs, third-party fonts, query-bearing resources or blocked POST requests may render incompletely or fail. A public Feedbacks SPA route renders with `--scripts=true`; private workspace pages cannot be checked by this command. Use the same browser version and page state when comparing, and inspect the saved images before accepting a change.

Request interception and browser flags reduce exposure but are not an operating-system network sandbox for hostile page code. Do not run script mode on an untrusted third-party page or in an environment with private network access or sensitive browser profiles.

This local operator check does not run in the scheduled worker. Unattended screenshot capture still needs a managed browser runtime and independently enforced network egress isolation before it can safely be connected to scheduled project QA. The existing scheduled static scan and authorized thread image comparison continue as described above.

## Signed-in app layout regression

The separate `qa:app-visual` command starts the disposable local harness, signs in as its synthetic owner, and captures the seeded feedback list and thread at desktop (1280 × 800) and mobile (390 × 844) sizes in both themes. It never loads production credentials, projects, screenshots or cookies. Its browser permits requests only to the harness's exact loopback origin and blocks WebSockets and popups. Run `npm run build` first; install Chromium with `npx playwright install chromium` if needed. Create a local baseline once, then compare against it after UI changes:

```sh
npm run qa:app-visual -- --baseline-dir=output/playwright/app-baseline --output-dir=output/playwright/app-first --init-baseline=true
npm run qa:app-visual -- --baseline-dir=output/playwright/app-baseline --output-dir=output/playwright/app-next --max-change=0.5
```

Each capture writes eight PNGs to the ignored `output/playwright/` folder with private file permissions. The command never overwrites a baseline or output image. Exit 1 means at least one capture changed beyond the selected pixel threshold; exit 2 means setup or capture failed. Review the PNGs before accepting a changed baseline. This checks the authenticated app shell and synthetic queue/thread layout; the seeded thread has no screenshot, and the command does not browse production or run on a schedule. Browser-version and font changes can cause pixel differences even when the app behavior is correct.
