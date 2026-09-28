import DefaultTheme from "vitepress/theme";
import { h } from "vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("Demo", {
      props: ["step"],
      setup: (props) => () => h("feedbacks-demo", { step: props.step }),
    });
  },
};
