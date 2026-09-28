# Third-party notices and provenance

Feedbacks' own source is covered by `LICENSE` and `NOTICE`. Dependencies retain their original copyrights, licenses and notices in their installed packages; the lockfile records exact resolved versions. A source release includes the lockfile; the runtime container preserves production packages and their notices.

The principal runtime packages are React/React DOM, React Markdown (MIT), Express, pg, Zod, Argon2, Sharp, tldts, the AWS SDK and the Model Context Protocol SDK. Development tools include TypeScript, Vite, tsx, Prettier, PGlite and Playwright (Apache-2.0). Native dependencies such as libvips have their own notices in the relevant packages. Use `npm sbom --sbom-format cyclonedx` after `npm ci` for the installed dependency inventory; this does not replace reviewing license text.

The public documentation build uses VitePress (MIT) and its local search. VitePress and its build dependencies are installed only while building the static website. The static output includes VitePress client assets and self-hosted font files; their package licenses remain in the npm dependency tree. The S3 request presigner is part of the AWS SDK family and runs only on the application server.

Existing reference research is recorded in [reference provenance](docs/reference-provenance.md). It records inspected examples, not a claim of copied code or permission to reuse proprietary features. New source reuse requires its exact origin, revision, license and required notices here.

The extension icons are the project's own Feedbacks mark. The public website uses self-hosted Manrope under SIL OFL 1.1 and an image generated for a fictional webpage. Font license text is retained in `site/public/fonts/OFL-Manrope.txt`; [website asset provenance](docs/website-assets.md) records sources and the image prompt. No customer logos or production screenshots are included.

The extension contains packaged project scripts and the pinned rrweb recorder and replay bundles; it does not bundle the server's npm dependencies. Its ZIP includes these project-wide notices; the referenced provenance document is also available in the [public source repository](https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/reference-provenance.md).

The Codex plugin build bundles its MCP adapter dependencies and copies their full license/notice files into `licenses/`. Its `BUILD.json` records the bundled inputs, package versions and license paths.

## rrweb session replay

`@rrweb/record` and `@rrweb/replay` 2.1.6 are bundled locally for recording and playback. Source: https://github.com/rrweb-io/rrweb. OpenReplay Spot was inspected as a reference; no Spot or player source is copied. Published rrweb bundles include their internal dependencies; their retained distribution notices are preserved in generated bundles. The upstream rrweb license is reproduced here:

```text
MIT License

Copyright (c) 2018 Contributors (https://github.com/rrweb-io/rrweb/graphs/contributors)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## WebM duration metadata

`@fix-webm-duration/fix` and `@fix-webm-duration/parser` 1.0.1 are bundled locally in the extension to repair duration metadata in native and edited MediaRecorder output. Source: https://github.com/yusitnikov/fix-webm-duration, license retrieved from tag `v1.0.1`. The package license is reproduced below. The bundle also uses `tslib` 2.8.1 under the 0BSD license.

```text
The MIT license

Copyright (c) 2018 Yury Sitnikov

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

```text
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```
