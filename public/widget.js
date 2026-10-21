(() => {
  const script = document.currentScript;
  const permanent = !!script?.dataset.intake;
  const linkId = script?.dataset.intake || script?.dataset.link;
  const token = script?.dataset.token;
  const service = script ? new URL(script.src).origin : "";
  if (!linkId || (!permanent && !token) || !/^[a-f0-9-]{36}$/i.test(linkId)) return;

  const api = async (operation, input) => {
    const response = await fetch(
      `${service}/api/${permanent ? operation.replace("widget.", "intake.") : operation}?${permanent ? "intakeId" : "linkId"}=${encodeURIComponent(linkId)}`,
      {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          permanent ? { ...input, intakeId: linkId } : { ...input, linkId, token },
        ),
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
        if (document.getElementById(`feedbacks-widget-${linkId}`)) return;
        const host = document.createElement("div");
        host.id = `feedbacks-widget-${linkId}`;
        host.className = "feedbacks-widget";
        if (permanent) {
          host.dataset.position = details.position;
          host.dataset.color = details.color;
        }
        document.body.append(host);
        const root = host;
        const css = document.createElement("link");
        css.rel = "stylesheet";
        css.href = `${service}/widget.css`;
        document.head.append(css);
        const launcher = document.createElement("button");
        launcher.type = "button";
        launcher.className = "launcher";
        launcher.textContent = details.label || "Send feedback";
        launcher.setAttribute("aria-expanded", "false");
        root.append(launcher);
        const panel = document.createElement("section");
        panel.className = "panel";
        panel.hidden = true;
        panel.innerHTML = `
      <header><div><h2>Send feedback</h2></div><button type="button" class="close" aria-label="Close feedback form">×</button></header>
      <p class="project"></p>
      <form>
        <label>Your name<input name="name" maxlength="120" autocomplete="name" required></label>
        <label>Feedback<textarea name="body" maxlength="12000" rows="4" required></textarea></label>
        <p class="context">Your page URL and viewport size will be sent with this feedback.</p>
        <p class="screenshot-hint">Need to show a screenshot? Use the Feedbacks Chrome extension for a private capture.</p>
        <div class="turnstile"></div>
        <p class="error" role="alert" hidden></p>
        <button type="submit" class="send">Send feedback</button>
      </form>
      <p class="done" role="status" tabindex="-1" hidden>Feedback sent. You can close this form.</p>
      <p class="privacy">Your name, feedback, page URL and viewport go to this project's team. The widget cannot read existing feedback.</p>`;
        root.append(panel);
        panel.querySelector(".project").textContent =
          details.projectName || "Share feedback with this website's team.";
        const form = panel.querySelector("form");
        const error = panel.querySelector(".error");
        const requestId = permanent ? crypto.randomUUID() : undefined;
        let element;
        let cancelPick;
        if (permanent) {
          form.elements.name.required = false;
          form.elements.name.closest("label").firstChild.textContent =
            "Your name (optional)";
          panel.querySelector(".context").textContent =
            "Your page address (without query or fragment), viewport size and optional selected element position will be sent. No screenshot, page text or form values are captured.";
          panel.querySelector(".screenshot-hint").remove();
          const privacy = panel.querySelector(".privacy");
          privacy.textContent = details.privacyText;
          if (details.privacyUrl) {
            const link = document.createElement("a");
            link.href = details.privacyUrl;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = " Privacy policy";
            privacy.append(link);
          }
          if (details.collectContact) {
            const contact = document.createElement("div");
            contact.innerHTML =
              '<label>Email (optional)<input type="email" name="email" maxlength="254" autocomplete="email"></label><label class="consent"><input type="checkbox" name="shareContact">Share this email with the website team so they can contact me.</label>';
            form.insertBefore(contact, form.querySelector(".context"));
          }
          const trap = document.createElement("label");
          trap.className = "feedbacks-trap";
          trap.setAttribute("aria-hidden", "true");
          trap.innerHTML =
            'Leave empty<input name="website" tabindex="-1" autocomplete="off">';
          form.append(trap);
          const pick = document.createElement("button");
          pick.type = "button";
          pick.className = "pick-element";
          pick.textContent = "Choose an element (optional)";
          const picked = document.createElement("p");
          picked.className = "context";
          picked.setAttribute("role", "status");
          picked.textContent = "Feedback about this page.";
          form.insertBefore(pick, form.querySelector(".context"));
          form.insertBefore(picked, pick.nextSibling);
          pick.addEventListener("click", () => {
            panel.hidden = true;
            const tip = document.createElement("p");
            tip.className = "pick-tip";
            tip.setAttribute("role", "status");
            tip.textContent =
              "Select an element, or focus it and press Enter. Escape cancels.";
            root.append(tip);
            const finish = () => {
              document.removeEventListener("click", select, true);
              document.removeEventListener("keydown", keyboard, true);
              tip.remove();
              panel.hidden = false;
              pick.focus();
              cancelPick = undefined;
            };
            const select = (event) => {
              if (root.contains(event.target)) return;
              event.preventDefault();
              event.stopImmediatePropagation();
              const target = event.target;
              element = {
                tag: target.tagName.toLowerCase().slice(0, 31),
                x: Math.max(0, Math.min(1, (event.clientX ?? 0) / window.innerWidth)),
                y: Math.max(0, Math.min(1, (event.clientY ?? 0) / window.innerHeight)),
              };
              if (event.type === "keydown") {
                const rect = target.getBoundingClientRect();
                element.x = Math.max(
                  0,
                  Math.min(1, (rect.left + rect.width / 2) / window.innerWidth),
                );
                element.y = Math.max(
                  0,
                  Math.min(1, (rect.top + rect.height / 2) / window.innerHeight),
                );
              }
              picked.textContent = `Selected ${element.tag}. Only its tag and viewport position will be sent.`;
              finish();
            };
            const keyboard = (event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                finish();
              } else if (event.key === "Enter") select(event);
            };
            cancelPick = finish;
            // The triggering click has finished before selection listeners attach.
            queueMicrotask(() => {
              document.addEventListener("click", select, true);
              document.addEventListener("keydown", keyboard, true);
            });
          });
        }
        let widgetId;
        const showError = (message) => {
          error.textContent = message;
          error.hidden = !message;
        };
        form.addEventListener("input", () => showError(""));
        const loadTurnstile = () => {
          const render = () => {
            if (widgetId !== undefined || !window.turnstile) return;
            widgetId = window.turnstile.render(panel.querySelector(".turnstile"), {
              sitekey: details.turnstileSiteKey,
              action: permanent ? "intake_submit" : "widget_submit",
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
          if (!open && cancelPick) cancelPick();
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
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          showError("");
          const challenge =
            widgetId === undefined ? "" : window.turnstile?.getResponse(widgetId);
          if (!challenge) return showError("Complete verification before sending.");
          const send = form.querySelector(".send");
          send.disabled = true;
          try {
            const page = new URL(location.href);
            if (permanent) page.search = "";
            page.hash = "";
            const email = form.elements.email?.value.trim();
            if (permanent && email && !form.elements.shareContact.checked)
              throw new Error("Choose whether to share your email, or leave it empty.");
            await api("widget.submit", {
              name: form.elements.name.value,
              body: form.elements.body.value,
              url: page.toString(),
              viewport: { width: window.innerWidth, height: window.innerHeight },
              turnstileToken: challenge,
              ...(permanent
                ? {
                    requestId,
                    website: form.elements.website.value,
                    ...(element ? { element } : {}),
                    ...(email ? { contact: { email, consent: true } } : {}),
                  }
                : {}),
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
