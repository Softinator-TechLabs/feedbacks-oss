---
title: Install the website feedback widget
description: Add permanent or bounded website feedback intake with exact-origin controls, Turnstile and no project access.
---

# Install a feedback button on your website

The website widget lets visitors send feedback about a page or optionally select an element. They need no account or extension. Permanent public intake sends the page address without its query or fragment, viewport size, and the selected element's tag and position. It captures no screenshot, page text, selectors or form values, and cannot read existing project feedback.

<DocPath :steps="['Approve website', 'Enable intake', 'Install script', 'Send test feedback']" />

## Enable permanent public intake

1. Ask the server owner to configure Cloudflare Turnstile, including the widget website's hostname. The secret stays on the Feedbacks server.
2. Open **Project settings → Project** and approve the exact website origins. Scheme, hostname and port must match; **Any website** cannot enable public intake.
3. As a project maintainer, open **Project settings → Website widget → Always-on website feedback**.
4. Select the approved origins, button label, left/right placement and color. Set a privacy notice and optional HTTPS privacy-policy link. Email sharing is optional and requires the visitor's explicit consent; it does not subscribe them to notifications or verify their identity.
5. Enable public intake and save. Copy the installation snippet to your website's shared HTML layout before `</body>`. Install once, including in a single-page app's HTML shell.

The installation stays valid until disabled. Its identifier is public in page source and grants only submission access on the currently approved origins. Disabling intake or removing an origin withdraws that grant immediately. Removing the script hides the launcher; received feedback remains in the project.

Permanent intake has durable PostgreSQL limits shared across replicas: 5 submission attempts per IP per fixed 10-minute window, 20 per installation per fixed minute and a configurable 1–1,000 attempts per UTC day. Failed challenges and retries count. Bootstrap/preflight requests also have bounded ingress budgets. Network addresses are stored only as keyed hashes in durable counters; old counter buckets are cleaned after two days. Configure trusted proxy hops correctly so visitors have distinct addresses. Public submission receipts retain only request IDs and content hashes while the installation exists, preventing a retry from recreating deleted feedback.

## Privacy and verification

The form shows what it sends. Visitors may leave their name empty. A selected element contributes only its tag and normalized viewport position. Query strings and fragments are stripped on the client and server; avoid private identifiers in URL paths. Team members see submissions as public website intake and any voluntarily shared contact as unverified. The widget does not grant a guest project, board, screenshot or discussion-reading session.

The host content security policy must permit the script, stylesheet and API connection from your Feedbacks origin and Turnstile resources from `https://challenges.cloudflare.com`. Preserve the host's policy; add the specific required sources. See [Cloudflare's CSP guidance](https://developers.cloudflare.com/turnstile/reference/content-security-policy/) (accessed 2026-10-21).

Test from a logged-out browser on each approved origin. Open **Send feedback**, send a synthetic report and confirm exactly one thread in the intended project. Retry a timed-out submission before editing it; the draft request ID deduplicates successful retries. Test optional contact consent, element selection, Tab/Enter, Escape, mobile viewport and the actual host CSP. Production challenge verification checks both the website hostname and `intake_submit` action. Synthetic challenge tests do not prove production acceptance.

## WordPress and Drupal installation

No native CMS plugin is required. The generated script is the same supported integration on both systems; no published Feedbacks marketplace plugin is claimed.

For **WordPress**, a trusted administrator can put the exact snippet in a site-wide footer **Custom HTML** block/template part when the site's role and hosting policy permit script markup. WordPress sanitizes scripts for users without `unfiltered_html`; do not weaken contributor permissions to bypass this. Where the editor strips scripts, ask the site maintainer to add the snippet through the existing custom child-theme footer or an already approved script-management mechanism. Preserve the parent theme and core. Verify the published page source and a real submission after theme or cache changes. [WordPress Custom HTML documentation](https://wordpress.org/documentation/article/custom-html/) (accessed 2026-10-21).

For **Drupal**, have the site maintainer place the snippet in the site's existing custom theme HTML template near the closing body, or an administrator-only custom block whose configured text format actually permits that script. Text formats and editors may strip it. Keep Full HTML/script-capable formats restricted to trusted administrators; never grant that format to anonymous visitors to install the widget. Preserve core and contributed theme sources. Clear the site's normal theme/render cache and verify the published source, exact-origin check and submission. [Drupal text formats](https://www.drupal.org/docs/user_guide/en/structure-text-formats.html), [security guidance](https://www.drupal.org/docs/administering-a-drupal-site/security-in-drupal/configuring-text-formats-aka-input-formats-for-security) (accessed 2026-10-21).

## Existing bounded widget installations

The older **Create installation snippet** guest-link flow remains available and compatible. Those token-based installations expire after 1–30 days and accept 1–50 submissions, with up to ten active guest/widget links combined per project. They retain their original name/comment and URL behavior. Replace or revoke them through their existing link list. They do not become permanent automatically; choose the permanent installation above for continuous public intake.

If the button does not appear, check whether permanent intake is enabled (or a legacy link expired), the exact origin is still approved in both project and intake settings, Turnstile hostnames and keys match, limits are not exhausted, and CSP permits the resources. See [guest and widget workflows](/reference/manual/review-workflow#add-the-website-widget) and [self-hosting](/guide/self-host).
