(() => {
  const script = document.currentScript;
  const linkId = script?.dataset.link;
  const token = script?.dataset.token;
  const service = script ? new URL(script.src).origin : "";
  if (!linkId || !token || !/^[a-f0-9-]{36}$/i.test(linkId)) return;

  const api = async (operation, input) => {
    const response = await fetch(
      `${service}/api/${operation}?linkId=${encodeURIComponent(linkId)}`,
      {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, linkId, token }),
      },
    );
    const result = await response.json();
    if (!response.ok || result.ok !== true)
      throw new Error(result.error?.message || "Feedback could not be sent. Try again.");
    return result.data;
  };

  const mount = () =>
    api("widget.inspect", {})
      .then((details) => {
        const host = document.createElement("div");
        host.id = `feedbacks-widget-${linkId}`;
        host.className = "feedbacks-widget";
        document.body.append(host);
        const root = host;
        const css = document.createElement("link");
        css.rel = "stylesheet";
        css.href = `${service}/widget.css`;
        document.head.append(css);
        const launcher = document.createElement("button");
        launcher.type = "button";
        launcher.className = "launcher";
        launcher.textContent = "Send feedback";
        launcher.setAttribute("aria-expanded", "false");
        root.append(launcher);
        const panel = document.createElement("section");
        panel.className = "panel";
        panel.hidden = true;
        panel.innerHTML = `
      <header><div><small>FEEDBACKS</small><h2>Send feedback</h2></div><button type="button" class="close" aria-label="Close feedback form">×</button></header>
      <p class="project"></p>
      <form>
        <label>Your name<input name="name" maxlength="120" autocomplete="name" required></label>
        <label>Feedback<textarea name="body" maxlength="12000" rows="4" required></textarea></label>
        <p class="context">Your page URL and viewport size will be sent with this feedback.</p>
        <button type="button" class="capture">Add a screenshot</button>
        <p class="capture-hint">Optional. Your browser will ask you to choose a tab. Choose this tab to show this page.</p>
        <div class="preview" hidden><button type="button" class="remove">Remove screenshot</button></div>
        <div class="turnstile"></div>
        <p class="error" role="alert" hidden></p>
        <button type="submit" class="send">Send feedback</button>
      </form>
      <p class="done" role="status" tabindex="-1" hidden>Feedback sent. You can close this form.</p>
      <p class="privacy">Your name, feedback, page URL, viewport and any screenshot you choose to add go to this project's team. The widget cannot read existing feedback.</p>`;
        root.append(panel);
        panel.querySelector(".project").textContent = details.projectName;
        const form = panel.querySelector("form");
        const error = panel.querySelector(".error");
        const capture = panel.querySelector(".capture");
        const preview = panel.querySelector(".preview");
        let screenshot;
        let widgetId;
        const showError = (message) => {
          error.textContent = message;
          error.hidden = !message;
        };
        const loadTurnstile = () => {
          const render = () => {
            if (widgetId !== undefined || !window.turnstile) return;
            widgetId = window.turnstile.render(panel.querySelector(".turnstile"), {
              sitekey: details.turnstileSiteKey,
              action: "widget_submit",
              theme: "auto",
            });
          };
          if (window.turnstile) return render();
          const tag = document.createElement("script");
          tag.src =
            "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
          tag.async = true;
          tag.addEventListener("load", render);
          tag.addEventListener("error", () =>
            showError("Verification could not load. Try again later."),
          );
          document.head.append(tag);
        };
        const setOpen = (open) => {
          panel.hidden = !open;
          launcher.setAttribute("aria-expanded", String(open));
          if (open) {
            loadTurnstile();
            panel.querySelector("input[name=name]").focus();
          } else launcher.focus();
        };
        launcher.addEventListener("click", () => setOpen(panel.hidden));
        panel.querySelector(".close").addEventListener("click", () => setOpen(false));
        document.addEventListener("keydown", (event) => {
          if (event.key === "Escape" && !panel.hidden) setOpen(false);
        });
        capture.addEventListener("click", async () => {
          showError("");
          let stream;
          try {
            if (!navigator.mediaDevices?.getDisplayMedia)
              throw new Error("Tab capture is unavailable in this browser.");
            stream = await navigator.mediaDevices.getDisplayMedia({
              video: { displaySurface: "browser" },
              audio: false,
            });
            const track = stream.getVideoTracks()[0];
            if (track.getSettings().displaySurface !== "browser")
              throw new Error("Choose a browser tab to capture a screenshot.");
            const video = document.createElement("video");
            video.srcObject = stream;
            video.muted = true;
            await video.play();
            if (!video.videoWidth || !video.videoHeight)
              throw new Error("The selected tab did not provide a frame.");
            const scale = Math.min(
              1,
              1600 / Math.max(video.videoWidth, video.videoHeight),
            );
            const canvas = document.createElement("canvas");
            canvas.width = Math.round(video.videoWidth * scale);
            canvas.height = Math.round(video.videoHeight * scale);
            canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
            const image = canvas.toDataURL("image/webp", 0.8);
            if (image.length > 3 * 1024 * 1024)
              throw new Error("The screenshot is too large. Try a smaller tab.");
            screenshot = image;
            let thumbnail = preview.querySelector("img");
            if (!thumbnail) {
              thumbnail = document.createElement("img");
              thumbnail.alt = "Screenshot preview";
              preview.prepend(thumbnail);
            }
            thumbnail.src = image;
            preview.hidden = false;
          } catch (cause) {
            showError(cause?.message || "Screenshot was not captured.");
          } finally {
            stream?.getTracks().forEach((track) => track.stop());
          }
        });
        panel.querySelector(".remove").addEventListener("click", () => {
          screenshot = undefined;
          preview.querySelector("img")?.remove();
          preview.hidden = true;
        });
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          showError("");
          const challenge =
            widgetId === undefined ? "" : window.turnstile?.getResponse(widgetId);
          if (!challenge) return showError("Complete verification before sending.");
          const send = form.querySelector(".send");
          send.disabled = true;
          try {
            await api("widget.submit", {
              name: form.elements.name.value,
              body: form.elements.body.value,
              url: location.href.split("#")[0],
              viewport: { width: window.innerWidth, height: window.innerHeight },
              turnstileToken: challenge,
              ...(screenshot ? { screenshot } : {}),
            });
            form.hidden = true;
            const done = panel.querySelector(".done");
            done.hidden = false;
            done.focus();
          } catch (cause) {
            showError(cause?.message || "Feedback could not be sent. Try again.");
            window.turnstile?.reset(widgetId);
          } finally {
            send.disabled = false;
          }
        });
      })
      .catch(() => {});
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount, { once: true });
})();
