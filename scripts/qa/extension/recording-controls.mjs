import assert from "node:assert/strict";
import { join } from "node:path";

export async function verifyRecordingControls({
  page,
  send,
  id,
  sendFromReview,
  context,
  root,
  results,
  worker,
}) {
  await page.bringToFront();
  await send({ type: "activate", tabId: id });
  // Real MediaRecorder with deterministic local canvas and tone instead of a
  // toolbar-granted tab capture. The actual tabCapture permission is a manual gate.
  await worker.evaluate(() =>
    chrome.storage.local.set({
      videoRecordingOptions: { tabAudio: true, microphone: true },
    }),
  );
  await context.addInitScript(() => {
    if (location.protocol !== "chrome-extension:" || location.pathname !== "/video.html")
      return;
    window.qaPlaybackVideos = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      window.qaPlaybackVideos.push(this);
      return play.call(this);
    };
    const tone = () => {
      const audio = new AudioContext();
      const oscillator = audio.createOscillator();
      const destination = audio.createMediaStreamDestination();
      oscillator.connect(destination);
      oscillator.start();
      const track = destination.stream.getAudioTracks()[0];
      track.addEventListener("ended", () => audio.close());
      return destination.stream;
    };
    navigator.mediaDevices.getUserMedia = async (options) => {
      if (!options?.video) return tone();
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 180;
      const ctx = canvas.getContext("2d");
      const draw = () => {
        ctx.fillStyle = "#17324d";
        ctx.fillRect(0, 0, 320, 180);
        ctx.fillStyle = "white";
        ctx.fillText(String(Date.now()), 20, 50);
      };
      draw();
      const stream = canvas.captureStream(10);
      stream.addTrack(tone().getAudioTracks()[0]);
      const timer = setInterval(draw, 100);
      const track = stream.getVideoTracks()[0];
      track.getSettings = () => ({ displaySurface: "browser" });
      track.addEventListener("ended", () => clearInterval(timer));
      return stream;
    };
  });
  const recorderOpened = context.waitForEvent("page");
  await sendFromReview({ type: "openRecorder" });
  const recorderPage = await recorderOpened;
  await recorderPage.waitForLoadState();
  await recorderPage.locator("#stop:visible").waitFor();
  await page.waitForTimeout(400);
  assert.match(
    await recorderPage.locator("#timer").textContent(),
    /(300|29[0-9]) seconds remaining/,
  );
  // Cross MV3's idle timeout while the recorder is in the background.
  await page.waitForTimeout(32000);
  await page.reload();
  await page.waitForTimeout(1500);
  assert.equal(
    (await sendFromReview({ type: "recordingControl", action: "pause" })).ok,
    true,
  );
  await sendFromReview({ type: "recordingControl", action: "resume" });
  assert.equal(
    (await sendFromReview({ type: "recordingControl", action: "pause" })).ok,
    true,
  );
  await recorderPage.locator("#pause").filter({ hasText: "Resume" }).waitFor();
  await recorderPage.locator("#timer").filter({ hasText: "Paused" }).waitFor();
  const pausedText = await recorderPage.locator("#timer").textContent();
  await page.waitForTimeout(1100);
  assert.equal(await recorderPage.locator("#timer").textContent(), pausedText);
  await sendFromReview({ type: "recordingControl", action: "resume" });
  await recorderPage.locator("#pause").filter({ hasText: "Pause" }).waitFor();
  await page.waitForTimeout(400);
  await sendFromReview({ type: "recordingControl", action: "stop" });
  await recorderPage.locator("#review:visible").waitFor();
  assert.ok(
    (await recorderPage.locator("#preview").getAttribute("src")).startsWith("blob:"),
  );
  // Trim with both drag handles, seek, and play only the selected interval.
  await recorderPage.locator("#trim-start-handle").waitFor();
  await recorderPage.locator("#trim-track").scrollIntoViewIfNeeded();
  const trimTrack = await recorderPage.locator("#trim-track").boundingBox();
  assert.ok(trimTrack);
  const dragHandle = async (id, fraction) => {
    const handle = await recorderPage.locator(id).boundingBox();
    await recorderPage.mouse.move(
      handle.x + handle.width / 2,
      handle.y + handle.height / 2,
    );
    await recorderPage.mouse.down();
    await recorderPage.mouse.move(
      trimTrack.x + trimTrack.width * fraction,
      trimTrack.y + 30,
      { steps: 6 },
    );
    await recorderPage.mouse.up();
  };
  await dragHandle("#trim-start-handle", 0.2);
  await dragHandle("#trim-end-handle", 0.3);
  const trimStart = Number(await recorderPage.locator("#trim-start").inputValue());
  const trimEnd = Number(await recorderPage.locator("#trim-end").inputValue());
  assert.ok(trimStart > 5 && trimEnd > trimStart);
  assert.equal(await recorderPage.locator("#send").isEnabled(), false);
  await recorderPage.locator("#trim-play").click();
  await recorderPage.locator("#trim-pause-icon:visible").waitFor();
  await recorderPage.waitForFunction(() => document.querySelector("#preview").paused, {
    timeout: 10000,
  });
  assert.ok(
    Math.abs(
      (await recorderPage.locator("#preview").evaluate((v) => v.currentTime)) - trimEnd,
    ) < 0.15,
  );
  await recorderPage.locator("#trim-start-handle").focus();
  await recorderPage.keyboard.press("ArrowRight");
  assert.ok(Number(await recorderPage.locator("#trim-start").inputValue()) > trimStart);
  await recorderPage.locator("#precise-trim summary").click();
  await recorderPage.locator("#trim-end").fill("");
  await recorderPage.locator("#trim-end").pressSequentially("30");
  assert.equal(await recorderPage.locator("#trim-end").inputValue(), "30");
  await recorderPage.locator("#trim-start").fill("0.1");
  await recorderPage.locator("#trim-end").fill("0.5");
  await recorderPage.locator("#crop-editing summary").click();
  await recorderPage.locator("#crop-width").fill("50");
  await recorderPage.locator("#apply-edit").click();
  await recorderPage
    .locator("#status")
    .filter({ hasText: "Edits applied" })
    .waitFor({ timeout: 20000 })
    .catch(async (error) => {
      throw Error(
        `${error.message}: ${await recorderPage.locator("#status").textContent()} ${JSON.stringify(await recorderPage.evaluate(() => window.qaPlaybackVideos.map((video) => ({ currentTime: video.currentTime, paused: video.paused, ended: video.ended, readyState: video.readyState, duration: video.duration, error: video.error?.message }))))}`,
      );
    });
  await recorderPage.locator("#preview").evaluate(
    (video) =>
      new Promise((resolve) => {
        if (video.readyState >= 1) resolve();
        else video.onloadedmetadata = resolve;
      }),
  );
  assert.equal(
    await recorderPage.locator("#preview").evaluate((video) => video.videoWidth),
    160,
  );
  // Crop again while the crop panel stays open: coordinates must remain original-based.
  await recorderPage.locator("#crop-preview").scrollIntoViewIfNeeded();
  const cropBoxVisible = await recorderPage.locator("#crop-preview").boundingBox();
  await recorderPage.mouse.move(
    cropBoxVisible.x + cropBoxVisible.width * 0.5,
    cropBoxVisible.y + 10,
  );
  await recorderPage.mouse.down();
  await recorderPage.mouse.move(
    cropBoxVisible.x + cropBoxVisible.width * 0.75,
    cropBoxVisible.y + cropBoxVisible.height - 10,
    { steps: 4 },
  );
  await recorderPage.mouse.up();
  assert.ok(Number(await recorderPage.locator("#crop-left").inputValue()) >= 49);
  assert.ok(Number(await recorderPage.locator("#crop-width").inputValue()) <= 26);
  await recorderPage.waitForFunction(
    () => document.querySelector("#preview").videoWidth === 320,
  );
  await recorderPage.locator("#reset-edit").click();
  await recorderPage.locator("#preview").evaluate(
    (video) =>
      new Promise((resolve) => {
        if (video.readyState >= 1) resolve();
        else video.onloadedmetadata = resolve;
      }),
  );
  assert.equal(
    await recorderPage.locator("#preview").evaluate((video) => video.videoWidth),
    320,
  );
  await recorderPage.evaluate(() => {
    document.getElementById("precise-trim").open = false;
    document.getElementById("crop-editing").open = false;
    window.scrollTo(0, 0);
  });
  await recorderPage.setViewportSize({ width: 1440, height: 1200 });
  await recorderPage.screenshot({
    path: join(root, ".local/remaining-todos-qa/video-desktop.png"),
  });
  await recorderPage.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await recorderPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await recorderPage.screenshot({
    path: join(root, ".local/remaining-todos-qa/video-mobile.png"),
  });
  await recorderPage.close();
  await page.bringToFront();
  results.recordingControls = {
    pauseResumeStop: true,
    preview: true,
    navigation: true,
    cropExport: true,
    originalRestored: true,
  };
}
