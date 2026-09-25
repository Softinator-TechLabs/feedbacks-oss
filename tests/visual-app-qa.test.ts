import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Operator script is native JavaScript.
import { allowedAppRequest, validateSandboxOrigin } from "../scripts/visual-app-qa.mjs";

test("authenticated visual check accepts only the disposable loopback app", () => {
  assert.equal(validateSandboxOrigin("http://127.0.0.1:43121"), "http://127.0.0.1:43121");
  for (const origin of [
    "https://example.com",
    "http://localhost:43121",
    "http://127.0.0.1:3000/path",
    "http://127.0.0.1:3000?x=1",
    "http://127.0.0.1:0",
  ])
    assert.throws(() => validateSandboxOrigin(origin));
});

test("browser route guard denies external destinations and unsafe methods", () => {
  const origin = "http://127.0.0.1:43121";
  assert.equal(allowedAppRequest(`${origin}/projects/id`, "GET", origin), true);
  assert.equal(allowedAppRequest(`${origin}/api/projects.list`, "POST", origin), true);
  assert.equal(allowedAppRequest("https://example.com/collect", "GET", origin), false);
  assert.equal(allowedAppRequest("http://127.0.0.1:43122/", "GET", origin), false);
  assert.equal(allowedAppRequest(`${origin}/api/threads.status`, "PUT", origin), false);
});
