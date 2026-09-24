import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Extension modules ship as native JavaScript.
import { formatPageQa } from "../extension/page-qa.js";

test("page QA draft includes only bounded same-origin findings", () => {
  const page = "https://review.example.test/article?private=1";
  assert.equal(
    formatPageQa({ missingAlt: [], brokenLinks: [], checkedLinks: 4 }, page),
    null,
  );
  const report = formatPageQa(
    {
      missingAlt: [240],
      brokenLinks: [{ url: "https://review.example.test/missing", status: 404 }],
      checkedLinks: 5,
    },
    page,
  );
  assert.match(report, /Image near page y=240px has no alt/);
  assert.match(report, /HTTP 404: https:\/\/review.example.test\/missing/);
  assert.match(report, /Review these findings before sending/);
  assert.throws(
    () =>
      formatPageQa(
        {
          missingAlt: [],
          brokenLinks: [{ url: "https://external.test/missing", status: 404 }],
          checkedLinks: 1,
        },
        page,
      ),
    /unsafe link/,
  );
  assert.throws(
    () => formatPageQa({ missingAlt: [], brokenLinks: [], checkedLinks: 99 }, page),
    /invalid results/,
  );
});
