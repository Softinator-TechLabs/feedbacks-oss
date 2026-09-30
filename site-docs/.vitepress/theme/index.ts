import DefaultTheme from "vitepress/theme";
import { h } from "vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("Evidence", {
      setup: () => () =>
        h("feedbacks-evidence", {}, [
          h("img", {
            src: "/media/story/timeline.svg",
            width: 760,
            height: 320,
            alt: "A click, failed request and console error share one recording timeline.",
          }),
        ]),
    });
    app.component("Demo", {
      props: ["step"],
      setup: (props) => () => h("feedbacks-demo", { step: props.step }),
    });
  },
};
