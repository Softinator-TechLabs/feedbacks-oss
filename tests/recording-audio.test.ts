import test from "node:test";
import assert from "node:assert/strict";
import {
  recordingDefaults,
  microphonePermission,
  requireMicrophonePermission,
  captureMicrophone,
  testMicrophone,
} from "../extension/recordings/audio-access.js";

test("audio defaults include both sources and preserve deliberate saved choices", () => {
  assert.deepEqual(recordingDefaults(), { tabAudio: true, microphone: true });
  assert.deepEqual(recordingDefaults({ maskText: true, microphone: false }), {
    maskText: true,
    tabAudio: true,
    microphone: false,
  });
  assert.deepEqual(recordingDefaults({ tabAudio: false, microphone: false }), {
    tabAudio: false,
    microphone: false,
  });
});

test("offscreen microphone preflight distinguishes first grant and persistent block", async () => {
  for (const [state, code] of [
    ["prompt", "microphone-permission"],
    ["denied", "microphone-blocked"],
  ]) {
    const media = { permissions: { query: async () => ({ state }) } };
    await assert.rejects(
      requireMicrophonePermission(media),
      (error: any) => error.audioCode === code,
    );
  }
  await requireMicrophonePermission({
    permissions: { query: async () => ({ state: "granted" }) },
  });
  assert.equal(await microphonePermission({}), "unknown");
});

test("permission test releases the device; recorder retains it until stopped", async () => {
  let stopped = 0;
  const track = { readyState: "live", stop: () => stopped++ };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const media = { mediaDevices: { getUserMedia: async () => stream } };
  assert.equal(await captureMicrophone(media), stream);
  assert.equal(stopped, 0);
  await testMicrophone(media);
  assert.equal(stopped, 1);
});

test("missing/blocked/busy microphone errors offer recovery and release unusable streams", async () => {
  for (const [name, code] of [
    ["NotAllowedError", "microphone-blocked"],
    ["NotFoundError", "microphone-missing"],
    ["NotReadableError", "microphone-busy"],
  ]) {
    await assert.rejects(
      captureMicrophone({
        mediaDevices: {
          getUserMedia: async () => {
            throw Object.assign(Error("raw browser failure"), { name });
          },
        },
      }),
      (error: any) =>
        error.audioCode === code &&
        /Settings|microphone/i.test(error.message) &&
        !error.message.includes("raw browser failure"),
    );
  }
  let stopped = 0;
  await assert.rejects(
    captureMicrophone({
      mediaDevices: {
        getUserMedia: async () => ({
          getTracks: () => [{ stop: () => stopped++ }],
          getAudioTracks: () => [],
        }),
      },
    }),
    /No microphone audio/,
  );
  assert.equal(stopped, 1);
});
