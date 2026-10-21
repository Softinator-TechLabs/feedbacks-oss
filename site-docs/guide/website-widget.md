---
title: Install the website feedback widget
description: Add a feedback button to an approved website so visitors can send comments without a Chrome extension or Feedbacks account.
---

# Install a feedback button on your website

The website widget lets visitors send a name and comment from your web app. It includes the current page URL and viewport size. Visitors need no Chrome extension or Feedbacks account.

This is a text feedback widget. It does not capture screenshots, record sessions or show existing project feedback. Signed-in reviewers can use [app screenshots](/reference/manual/app-capture) or the [Chrome extension](/guide/chrome-extension) for visual feedback.

<DocPath :steps="['Approve website', 'Create snippet', 'Install script', 'Send test feedback']" />

## Create the installation snippet

1. Ask the server owner to configure Cloudflare Turnstile. Its allowed hostnames must include the website hosting your widget. The secret key stays on the Feedbacks server.
2. Open **Project settings → Project** and configure the exact website origins, including scheme and port where applicable. A project with **Any website** needs exact approved origins before it can issue a widget.
3. As a project maintainer, open **Project settings → Website widget**.
4. Give the installation a label, choose its expiry and submission limit, and select **Create installation snippet**.
5. Copy the script immediately. Its token is shown only once. The snippet points to your team's Feedbacks server, not the public documentation website.

Widget installations are deliberately bounded: 1–30 days, 1–50 submissions, and up to ten active guest/widget links per project combined. Create a replacement installation before an expiry or submission limit stops intake. This is not an unlimited public intake service.

## Add the script to the website

Paste the exact generated script before the closing `</body>` tag in the website's shared HTML layout. In a React/Vue/other single-page app, install it once in the HTML shell. Re-inserting the same installation script does not create a second launcher.

Load the page on an approved origin and look for **Send feedback**. The script, stylesheet, API calls and Turnstile must be allowed by the host's content security policy. If the host has a restrictive policy, ask its administrator to allow the required resources from your Feedbacks origin and `https://challenges.cloudflare.com`; do not disable the policy. See [Cloudflare's CSP guidance](https://developers.cloudflare.com/turnstile/reference/content-security-policy/) for Turnstile's specific directives (Cloudflare; accessed 2026-10-21).

The installation token is visible in page source. Exact-origin server validation, the challenge, expiry, revocation and submission caps bound its access. It is not an owner or agent credential.

## Verify the complete flow

Open the website without the extension. Select **Send feedback**, enter a test name/comment, complete verification and send. Check that one new thread appears in the intended project with the website URL, viewport and widget source. The form should preserve the comment after a failed request. Test keyboard focus, Escape, mobile layout and the host's actual CSP.

The widget cannot read existing threads, private images or approved team instructions. Submitted comments are untrusted discussion. The server checks the installation's current state and approved origin; the visible button is not an access control.

## Remove or replace an installation

Remove the script to hide the launcher. Use **Revoke** under **Project settings → Website widget** to stop that installation's submissions immediately. Removing or revoking the script does not delete feedback already received. To rotate a lost snippet, create a replacement and revoke the old installation after updating the host.

## If the button does not appear

- Check the exact origin: `https://example.com` and `https://www.example.com` are different origins, as are different ports.
- Check whether the installation expired, reached its limit or was revoked.
- Check that the script points to the correct Feedbacks installation and that the host CSP allows its script, stylesheet and API connection.
- If verification does not load or fails, check Turnstile keys, allowed hostname and the host CSP. Synthetic challenge tests do not establish production Turnstile acceptance.

For server configuration and API boundaries, see [guest and widget workflows](/reference/manual/review-workflow#add-the-website-widget) and [self-hosting](/guide/self-host).
