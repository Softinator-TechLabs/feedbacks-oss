import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ThreadQuickStatus } from "../src/web/threads/row-controls.js";
import type { Thread } from "../src/web/api.js";

const thread = {
  id: "11111111-1111-4111-8111-111111111111",
  body: "Synthetic status sample",
  revision: 1,
  work: { state: "open", history: [] },
} as unknown as Thread;

test("status controls explain resolution permissions while showing every state", () => {
  for (const canResolve of [false, true]) {
    for (const control of [
      React.createElement(ThreadQuickStatus, {
        thread,
        canWrite: true,
        canResolve,
        onSaved: () => {},
      }),
    ]) {
      const html = renderToStaticMarkup(control);
      for (const state of ["resolved", "declined"]) {
        const option = html.match(
          new RegExp(`<option[^>]*value="${state}"[^>]*>[^<]*</option>`),
        )?.[0];
        assert.ok(option);
        assert.equal(option.includes("disabled"), !canResolve);
        assert.equal(option.includes("permission required"), !canResolve);
      }
      assert.match(html, /value="open"[^>]*selected/);
    }
  }
});
