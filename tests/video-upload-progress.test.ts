import test from "node:test";
import assert from "node:assert/strict";
import { uploadVideoWithProgress } from "../extension/video-upload.js";

const input = {
  threadId: "thread-1",
  revision: 2,
  videoBase64: "data:video/webm;base64,AAAA",
  durationMs: 3000,
  idempotencyKey: "upload-1",
};

test("video Send reports transferred bytes, waits for server confirmation, then completes", async () => {
  const progress: Array<{ phase: string; percent: number }> = [];
  let request: any;
  const xhrFactory = () => {
    request = {
      upload: {},
      headers: {} as Record<string, string>,
      open(method: string, url: string) {
        this.method = method;
        this.url = url;
      },
      setRequestHeader(name: string, value: string) {
        this.headers[name] = value;
      },
      send(body: string) {
        this.body = JSON.parse(body);
        this.upload.onprogress({ lengthComputable: true, loaded: 50, total: 100 });
        this.upload.onprogress({ lengthComputable: true, loaded: 100, total: 100 });
      },
    };
    return request;
  };
  const pending = uploadVideoWithProgress({
    server: "https://feedback.example.test",
    token: "private-token",
    input,
    onProgress: (value) => progress.push(value),
    xhrFactory,
  });
  assert.equal(request.method, "POST");
  assert.equal(request.url, "https://feedback.example.test/api/assets.uploadVideo");
  assert.equal(request.headers.Authorization, "Bearer private-token");
  assert.deepEqual(request.body, input);
  assert.deepEqual(progress, [
    { phase: "uploading", percent: 0 },
    { phase: "uploading", percent: 50 },
    { phase: "confirming", percent: 100 },
  ]);
  request.status = 200;
  request.responseText = JSON.stringify({
    ok: true,
    data: { asset: { id: "video-1" }, thread: { id: "thread-1", revision: 3 } },
  });
  request.onload();
  assert.deepEqual(await pending, {
    asset: { id: "video-1" },
    thread: { id: "thread-1", revision: 3 },
  });
  assert.deepEqual(progress.at(-1), { phase: "complete", percent: 100 });
});

test("video Send keeps a failed upload retryable without announcing completion", async () => {
  const progress: Array<{ phase: string; percent: number }> = [];
  let request: any;
  const pending = uploadVideoWithProgress({
    server: "https://feedback.example.test",
    token: "private-token",
    input,
    onProgress: (value) => progress.push(value),
    xhrFactory: () =>
      (request = {
        upload: {},
        open() {},
        setRequestHeader() {},
        send() {},
      }),
  });
  request.status = 503;
  request.responseText = JSON.stringify({
    ok: false,
    error: { code: "STORAGE_UNAVAILABLE", message: "Private storage unavailable" },
  });
  request.onload();
  await assert.rejects(pending, /Private storage unavailable/);
  assert.equal(
    progress.some((item) => item.phase === "complete"),
    false,
  );
});
