import DefaultTheme from "vitepress/theme";
import { h, nextTick } from "vue";
import DocPath from "./DocPath.vue";
import "./custom.css";

const firstFrames = {
  capture: ["capture-1", "Right-click the element to leave a Feedbacks point."],
  connect: ["connect-1", "Copy the team server URL from Feedbacks Setup."],
  project: ["project-1", "Create a project with its approved website address."],
  send: ["send-1", "Review the notes and screenshots before sending feedback."],
  agent: ["agent-1", "Connect your personal coding agent from Feedbacks Setup."],
};

export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      "doc-after": () =>
        h("footer", { class: "doc-privacy-footer vp-raw" }, [
          h("a", { href: "/privacy.html" }, "Privacy"),
        ]),
    }),
  enhanceApp({ app, router }) {
    if (typeof window !== "undefined") {
      let pendingPage: string | undefined;
      // Page-load hooks also cover Back/Forward; anchors do not start a new load.
      router.onBeforePageLoad = (to) => {
        pendingPage = new URL(to, location.href).pathname;
        window.dispatchEvent(new Event("feedbacks:route-start"));
      };
      router.onAfterRouteChange = async (to) => {
        const path = new URL(to, location.href).pathname;
        if (pendingPage !== path || router.route.path !== path) return;
        await nextTick();
        if (pendingPage !== path) return;
        pendingPage = undefined;
        window.dispatchEvent(new Event("feedbacks:route-ready"));
      };
    }
    app.component("DocPath", DocPath);
    app.component("Evidence", {
      setup: () => () =>
        h("feedbacks-demo", { step: "recording" }, [
          h("img", {
            src: "/media/story/recording-desktop-0.webp",
            width: 900,
            height: 655,
            alt: "Actual Feedbacks video review with its timeline and captured activity.",
          }),
        ]),
    });
    app.component("Demo", {
      props: ["step"],
      setup: (props) => () => {
        const frame = firstFrames[props.step];
        return h(
          "feedbacks-demo",
          { step: props.step },
          frame
            ? [h("img", { src: `/learn/${frame[0]}.webp?v=20260930-3`, alt: frame[1] })]
            : [],
        );
      },
    });
  },
};
