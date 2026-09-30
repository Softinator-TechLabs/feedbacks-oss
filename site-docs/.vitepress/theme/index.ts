import DefaultTheme from "vitepress/theme";
import { h } from "vue";
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
  enhanceApp({ app }) {
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
