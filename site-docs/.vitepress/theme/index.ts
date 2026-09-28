import DefaultTheme from "vitepress/theme";
import { h } from "vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      "doc-top": () =>
        h("div", { class: "docs-motion-control" }, [h("feedbacks-motion-control")]),
    }),
  enhanceApp({ app }) {
    app.component("Demo", {
      props: ["step"],
      setup: (props) => () => h("feedbacks-demo", { step: props.step }),
    });
  },
};
