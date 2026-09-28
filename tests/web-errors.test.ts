import test from "node:test";
import assert from "node:assert/strict";
import { ApiError, errorText } from "../src/web/api.js";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { AuthScreen } from "../src/web/auth.js";

test("API errors keep machine codes out of user-facing messages", () => {
  const login = new ApiError("UNAUTHENTICATED", "Invalid email or password", 401);
  const comparison = new ApiError(
    "VALIDATION",
    "These images are too large for pixel comparison.",
    400,
  );

  assert.equal(errorText(login), "Invalid email or password");
  assert.equal(errorText(comparison), "These images are too large for pixel comparison.");
  assert.equal(login.code, "UNAUTHENTICATED");
});

test("sign-in asks the browser to validate email format before submission", () => {
  const html = renderToStaticMarkup(
    React.createElement(AuthScreen, { onAuthenticated: () => {} }),
  );
  assert.match(
    html,
    /<input[^>]*type="email"[^>]*name="email"|<input[^>]*name="email"[^>]*type="email"/,
  );
});
