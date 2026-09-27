import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { editRegion } from "../extension/video-media.js";

test("crop rejects off-frame and invalid regions", () => {
  assert.deepEqual(editRegion([25, 10, 50, 80], 1600, 900), {
    x: 400,
    y: 90,
    width: 800,
    height: 720,
  });
  for (const values of [
    [-1, 0, 100, 100],
    [0, 0, 0, 10],
    [70, 0, 40, 100],
    [0, NaN, 20, 20],
  ])
    assert.throws(() => editRegion(values, 1600, 900), /crop/);
});

for (const tabAudio of [false, true])
  for (const mic of [false, true]) {
    test(`audio sources tab=${tabAudio}, microphone=${mic}; five-minute active timer and cleanup`, async () => {
      const html = await readFile(
        new URL("../extension/video.html", import.meta.url),
        "utf8",
      );
      const nodes = Object.fromEntries(
        [...html.matchAll(/id="([^"]+)"/g)].map((m) => [
          m[1],
          { value: "", checked: false, removeAttribute() {} },
        ]),
      ) as any;
      nodes["tab-audio"].checked = tabAudio;
      nodes.microphone.checked = mic;
      let clock = 0,
        interval: any,
        constructed: any,
        picked: any,
        micCalls = 0,
        closed = 0;
      const tracks: any[] = [];
      const track = (kind: string) => {
        const t = {
          kind,
          stopped: false,
          stop() {
            this.stopped = true;
          },
          getSettings: () => ({ displaySurface: "browser" }),
          addEventListener() {},
        };
        tracks.push(t);
        return t;
      };
      class Stream {
        constructor(public tracks: any[]) {}
        getTracks() {
          return this.tracks;
        }
        getAudioTracks() {
          return this.tracks.filter((t) => t.kind === "audio");
        }
        getVideoTracks() {
          return this.tracks.filter((t) => t.kind === "video");
        }
      }
      class Recorder {
        state = "inactive";
        onstop: any;
        ondataavailable: any;
        static isTypeSupported(type: string) {
          return type.includes("vp8");
        }
        constructor(
          public stream: Stream,
          public options: any,
        ) {
          constructed = this;
        }
        start() {
          this.state = "recording";
        }
        pause() {
          this.state = "paused";
        }
        resume() {
          this.state = "recording";
        }
        stop() {
          this.state = "inactive";
          this.ondataavailable({ data: new Blob(["webm"]) });
          this.onstop();
        }
      }
      const context = vm.createContext({
        createVideoTimeline: () => ({
          load() {},
          clear() {},
          lock() {},
          reset() {},
          applied() {},
          original() {},
        }),
        Blob,
        URL,
        crypto,
        console,
        MediaRecorder: Recorder,
        MediaStream: Stream,
        performance: { now: () => clock },
        clearInterval() {},
        setInterval(fn: any) {
          interval = fn;
        },
        location: { href: "chrome-extension://test/video.html?sourceTabId=10" },
        document: { getElementById: (id: string) => nodes[id] },
        window: { addEventListener() {} },
        AudioContext: class {
          createMediaStreamDestination() {
            return { stream: new Stream([track("audio")]) };
          }
          createMediaStreamSource() {
            return { connect() {} };
          }
          async resume() {}
          async close() {
            closed++;
          }
        },
        navigator: {
          mediaDevices: {
            async getDisplayMedia(options: any) {
              picked = options;
              return new Stream([
                track("video"),
                ...(options.audio ? [track("audio")] : []),
              ]);
            },
            async getUserMedia() {
              micCalls++;
              return new Stream([track("audio")]);
            },
          },
        },
        chrome: {
          runtime: {
            connect: () => ({
              onMessage: { addListener() {} },
              onDisconnect: { addListener() {} },
              postMessage() {},
            }),
            sendMessage: async () => ({
              ok: true,
              data: { project: { name: "Test" }, viewport: { width: 1600, height: 900 } },
            }),
          },
        },
      });
      vm.runInContext(
        (
          await readFile(new URL("../extension/video-media.js", import.meta.url), "utf8")
        ).replaceAll("export ", ""),
        context,
      );
      vm.runInContext(
        (
          await readFile(new URL("../extension/video.js", import.meta.url), "utf8")
        ).replace(/^import[\s\S]*?from "\.\/video-media.js";\n/, ""),
        context,
      );
      await new Promise((resolve) => setImmediate(resolve));
      await nodes.start.onclick();
      assert.equal(picked.audio, tabAudio);
      assert.equal(micCalls, Number(mic));
      assert.equal(constructed.stream.getAudioTracks().length, tabAudio || mic ? 1 : 0);
      assert.match(constructed.options.mimeType, tabAudio || mic ? /vp8,opus/ : /vp8$/);
      if (!tabAudio && !mic) {
        clock = 1236;
        nodes.stop.onclick();
        assert.equal(
          nodes["trim-end"].value,
          "1.236",
          "crop-only end stays within original duration",
        );
        clock = 0;
        await nodes.start.onclick();
      }
      clock = 60000;
      nodes.pause.onclick();
      clock = 180000;
      interval();
      assert.equal(constructed.state, "paused");
      nodes.pause.onclick();
      clock = 419000;
      interval();
      assert.equal(constructed.state, "recording", "pause time excluded");
      clock = 420000;
      interval();
      assert.equal(constructed.state, "inactive");
      assert.equal(vm.runInContext("durationMs", context), 300000);
      assert.equal(
        tracks.every((t) => t.stopped),
        true,
        "all input and mixed tracks released",
      );
      assert.equal(closed, Number(mic));
    });
  }
