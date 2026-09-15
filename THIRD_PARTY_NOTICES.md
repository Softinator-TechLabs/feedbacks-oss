# Third-party notices and provenance

Feedbacks' own source is covered by `LICENSE` and `NOTICE`. Dependencies retain their original copyrights, licenses and notices in their installed packages; the lockfile records exact resolved versions. A source release includes the lockfile; the runtime container preserves production packages and their notices.

The principal runtime packages are React/React DOM, Express, pg, Zod, Argon2, Sharp, tldts, the AWS SDK and the Model Context Protocol SDK. Development tools include TypeScript, Vite, tsx, Prettier and PGlite. Native dependencies such as libvips have their own notices in the relevant packages. Use `npm sbom --sbom-format cyclonedx` after `npm ci` for the installed dependency inventory; this does not replace reviewing license text.

Existing reference research is recorded in [reference provenance](docs/reference-provenance.md). It records inspected examples, not a claim of copied code or permission to reuse proprietary features. New source reuse requires its exact origin, revision, license and required notices here.

The extension icons are the project's own Feedbacks mark. No third-party marketing photographs, customer logos or production screenshots are included in the public website.

The extension contains packaged project scripts and does not bundle the server's npm dependencies. Its ZIP includes these project-wide notices; the referenced provenance document is also available in the [public source repository](https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/reference-provenance.md).
