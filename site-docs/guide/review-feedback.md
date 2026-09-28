# Capture and review feedback

## Capture

On a website, open the extension and choose **Capture this page**, or right-click an element. Feedbacks outlines the element and opens a small comment field beside it. Write a note, choose **Save point**, and repeat on other elements. Choose **Review screenshots** when you are done. The screenshot editor shows all numbered comments, drawing tools and an optional overall note. Each point keeps its own element context in the resulting thread. Every point saves its original visible screenshot, including open menus. A visible-area capture includes those saved views even for points now offscreen. Full-page capture is optional; use it only when the whole page matters. Inspect each image before sending. A separate **Record a short tab video** flow records up to five minutes, with separate optional tab audio and microphone.

Saved points reappear on the reviewed website when the element still matches. Hover or focus a pin to read its comment. In the screenshot editor you can revise each point's text before sending; its selector, rectangle and border evidence stay attached to that point. The editor also draws the captured element rectangle alongside the numbered pin. In the thread, **Review on the page** places clickable numbered points and captured element boxes on the screenshot alongside their full notes. Open a point's **Element details** to see its tag, selector, screenshot position, box geometry and captured border styling. A point captured without a matching element is labeled **Page position only** instead of implying an element was selected. On a phone, tap a point or **Show on screenshot** to jump to it. The screenshot selector lets you inspect each numbered page or the optional combined full-page overview; drawing marks are visible in the image.

Point notes, the overall feedback comment and discussion replies accept simple Markdown such as **bold**, _italic_, links, lists and code. The editor provides a small formatting toolbar for the overall comment and replies. Feedbacks renders these notes as text and safe links; embedded HTML and remote Markdown images are not rendered.

The extension uploads only when you send. Screenshots can include visible forms and frames, and video has no redaction tool. Review sensitive content first. [Extension permissions and setup](/guide/chrome-extension).

## Review a queue

Open a project's **Feedback** tab. Search text, filter status and sort by latest activity or priority. Use **More filters** for page, domain, device, category and tag. Maintainers can mark **Top priority** directly on a row. Saved views remember a person's filters for that project.

Open a thread to compare the request with its screenshot or video. **Previous** and **Next** follow the queue filters. A discussion reply can answer a request without claiming a fix. Work status records whether the requested work is open, in progress, ready for review, resolved or declined. Formal review decisions are optional per project and separate from work status.

## Connect the outcome

A maintainer can create a [GitHub Issue](/guide/github) from a thread in one click after connecting the project. Add a real commit, PR or incorporated design as delivery evidence. Resolve only when the result has been verified. A linked Issue and a reply are not proof that the website changed.

For exact limits and advanced flows, see the [complete review workflow](/reference/manual/review-workflow).

## Complete individual points

Resolve or reopen a point from its note in the thread, or from a published website pin when you have resolution permission. The other points and the thread stay open. Maintainers can remove an irrelevant point and restore it later; the original screenshot and audit history remain, including any marks already drawn into its pixels.

Resolving or declining the whole thread closes its active pins together. Reopen the thread to continue; earlier individual decisions are retained. The thread lets you filter open, completed and removed points.

## Find feedback for a page

The extension popup shows team totals for **This page**, **This website** or **This page · current screen size**. Its link opens your configured server with the project and filters applied. Counts include matching feedback beyond the first list page. “Screen size” means mobile, tablet or desktop capture size; a menu being open is preserved in a point’s original image.
