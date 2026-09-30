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
            src: "/media/story/recording-desktop-0.webp",
            width: 900,
            height: 655,
            alt: "Actual Feedbacks video review with its timeline and captured activity.",
          }),
        ]),
    });
    app.component("Demo", {
      props: ["step"],
      setup: (props) => () => h("feedbacks-demo", { step: props.step }),
    });
  },
};
