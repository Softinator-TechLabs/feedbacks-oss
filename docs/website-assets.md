# Website asset provenance

The public landing uses actual extension and app screenshots with fictional review content. Names, pages, conversations and prices are illustrative, not customer evidence. Behance's home page and Penecho were visual references for scale, composition and concise storytelling; no assets or site code were copied from either.

## Manrope

The self-hosted Manrope font files in `site/public/fonts/` were obtained from Google Fonts on 16 September 2026. They are redistributed under the SIL Open Font License 1.1; the complete copyright and license text is in `site/public/fonts/OFL-Manrope.txt`.

Sources: [Manrope at Google Fonts](https://fonts.google.com/specimen/Manrope), [license source](https://github.com/google/fonts/blob/main/ofl/manrope/OFL.txt). These fonts are used on the public website; the application retains its system font stack.

## Studio chair illustration

`site/public/media/studio-chair.png` was generated for this project on 16 September 2026 using OpenAI image generation. It is an illustrative furniture photograph inside a fictional webpage, with no customer data or third-party brand asset. The generation prompt was:

> Create an original premium editorial product photograph for a fictional design-studio website mockup. Landscape 3:2 aspect ratio. A sculptural burnt-orange tubular lounge chair with soft cream upholstery, one folded cobalt-blue fabric draped over its arm, on a pale warm concrete floor against a very light cool-blue seamless wall. Direct afternoon sunlight enters from the upper left and casts one long crisp architectural shadow. The chair sits toward the right half; the left half has generous calm negative space. Sophisticated art direction, tactile materials, restrained but vivid color, realistic medium-format photography, high-end furniture campaign. No text, no typography, no logos, no people, no UI, no watermark. This will be used inside a clearly labeled illustrative webpage screenshot on the Feedbacks open-source landing page.

Pencil marks, layout shapes, webpage compositions and discussion cards are implemented in the repository's HTML/CSS/SVG. The generation record establishes provenance, not a guarantee of exclusive rights to the image.

## Product workflow screenshots

`site/public/media/workflow/point.png`, `point-detail.png`, `review.png` and `thread.png` were captured on 28 September 2026 from the running Feedbacks extension and an isolated local Feedbacks server. The demo furniture website and feedback are synthetic; no customer records or credentials appear. The chair photograph uses the existing generated asset described above. The screenshots are not AI-generated UI.

Run `node scripts/capture-website-workflow.mjs` after building the app to reproduce capture → Save point → Review & send → Send feedback → server thread. The script uses a temporary extension copy with pre-granted host access for headless capture; it does not change the shipped extension manifest or prove native Chrome permission/install prompts. The isolated database, browser profile and local server are cleaned up afterward. The mobile detail is a direct browser screenshot clip of the same selected button and comment; the full original remains available through zoom. The shipped screenshots preserve the captured product pixels; the landing page adds its annotations separately.

## Caveat annotations

The self-hosted `site/public/fonts/caveat-600.ttf` was obtained from [Google Fonts](https://fonts.google.com/specimen/Caveat) on 28 September 2026. It is used only for brief pencil-style annotations; Manrope remains the reading and control face. The SIL Open Font License is in `site/public/fonts/OFL-Caveat.txt`.

## Silent step walkthroughs

The shared player in `public/learn/demo.js` is used by the landing page, VitePress guides and authenticated Setup. Each action takes 3.6 seconds: the cursor moves to the real control, click rings acknowledge the press, text appears as it is typed, and a red pencil stroke highlights the next action. Playback pauses offscreen, in hidden tabs or by user choice. Reduced-motion preferences start it paused. Click the image or Play/Pause to hold and resume the same moment. Numbered controls show a completed action; the expand icon opens the original full screenshot.

`public/learn/*.webp` are actual extension and local application captures with synthetic accounts and a fictional Good Form project. Run `node scripts/capture-help-walkthroughs.mjs` after building to reproduce them. The connection scene shows an example address in the actual popup; it does not claim to demonstrate native Chrome permission prompts. Install/pin and server ownership use schematic illustrations. The final agent handoff is instructional, not a fabricated agent response or verified code fix. No credentials are rendered in the frames. The capture frames were refreshed for extension 0.1.53 after separating the saved-point count from the launcher icon. Action coordinates and focused crops use the original screenshot pixel space. The server address shown by the instructional overlay is an example; typed notes and cursor marks are explanatory overlays, not recorded user input.

`public/learn/` is canonical. Player script and stylesheet references carry a release version; update it together in the app entry, landing entry, VitePress head and player stylesheet link when changing this shared player. Nginx serves player code with revalidation headers; image frames remain cacheable. The player loads its shadow-root stylesheet from `demo.css` so the public site can retain its strict `style-src 'self'` policy. `scripts/prepare-walkthroughs.mjs` copies it into the static website before build; the app serves the same assets locally, without an iframe or external media dependency. Reuse a scene only beside the task it teaches; Setup shows the short pinning walkthrough directly; longer walkthroughs stay behind optional disclosures.

The landing hero bounds the walkthrough stage to the laptop viewport while keeping its controls visible. Each walkthrough has one **Play / Pause** control below the animation. Play starts only that walkthrough; Pause stops every walkthrough on the page. Clicking the animation does the same. There is no header playback control. The pause choice persists for that tab across navigation, and newly mounted players respect it. The pinning sequence shows the cursor opening Chrome’s Extensions menu, clicking Pin and opening the pinned toolbar icon; reduced motion and selected frames show each completed action.

## Current product story

The public product story adds four original geometric diagrams in `site/public/media/story/`: a shared recording timeline, an exact text replacement, a portable thread archive and the boundary between captured evidence and approved project guidance. They are explanatory illustrations, not screenshots of shipped controls. Example events use a fictional checkout and `.example` addresses.

`public/learn/evidence.js` and `evidence.css` provide a user-started, keyboard-operable walkthrough of actual recording-review screens, reused on the landing and public recording guide. It starts paused, stops when offscreen or hidden, and removes transitions for reduced motion. The first actual review screenshot remains visible without JavaScript. These assets never record a visitor or contact a third-party service.

`site/public/media/story/recording-{desktop,mobile}-{0,1,2}.webp` are browser captures of the original `extension/video.html`, `createVideoTimeline` and `createSessionReview` renderer with unmodified application styles. Run `node scripts/capture-public-recording-demo.mjs` to reproduce the Activity, Network and Console states. The script creates a local synthetic checkout video and diagnostic events; it never contacts the sample shop or uses customer data. The website adds playback and enlarge controls outside these screenshots. It does not present a redesigned mockup as the product.

`site/public/media/story/recording-inspector.webp` is captured from the current `createSessionReview` implementation with synthetic events. Run `node scripts/capture-public-recording.mjs` to reproduce it. It demonstrates the actual inspector layout, not end-to-end capture, native permission prompts or a submitted customer recording.

`site/public/media/social-preview.png` is a browser-rendered typographic sharing image generated by `node scripts/capture-site-social.mjs`. It uses the existing licensed Manrope font and the project's own timeline geometry. No customer logos, endorsements or invented usage metrics are included.

The build copies story illustrations into the docs public directory from the canonical site assets; do not edit the generated copies.

## Comparison evidence

`site/comparison-evidence/` stores dated, qualified primary-source verdicts for each product; `site/comparison-matrix.mjs` defines the feature groups. `scripts/generate-comparisons.mjs` produces category tables on the index and 15 synchronized comparison pages. Each category includes all 16 tools; the named alternative is highlighted on its page. Verdicts use tick/cross marks with muted color. Review dates appear in a native hover tooltip and accessible label; opening a mark exposes its source, date, audit basis and scope. Public-source negatives are edition-scoped; missing keywords are not absence evidence. See the [audit method](../site-docs/reference/comparison-method.md). Run `npm run site:comparisons` after canonical changes and `npm run site:comparisons:check` to verify generated output.

Category tables fill the page width and use ordinary page scrolling. On smaller screens, all product names remain visible and expandable feature lists show the dated verdicts; Feedbacks and the named alternative start expanded. Native disclosures retain evidence without JavaScript; modern browsers enhance them with a dismissible evidence popover. Dates record source/documentation inspection rather than runtime certification.
