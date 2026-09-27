import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownText } from "../src/web/markdown-text.js";

test("feedback Markdown renders common formatting without active content", () => {
  const html = renderToStaticMarkup(
    React.createElement(MarkdownText, {
      body: "**Bold** and [guide](https://example.com/guide)\n\n- First\n- Second\n\n<script>alert(1)</script>![tracker](https://example.com/pixel) [bad](javascript:alert(1))",
    }),
  );
  assert.match(html, /<strong>Bold<\/strong>/);
  assert.match(html, /href="https:\/\/example.com\/guide"/);
  assert.match(html, /<li>First<\/li>/);
  assert.doesNotMatch(html, /<script|<img|javascript:|pixel/);
});
