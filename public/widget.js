/*!
 * LeadFlow AI — website chat widget loader.
 *
 * Embed with:
 *   <script src="https://YOUR_DOMAIN/widget.js" data-widget-key="PUBLIC_WIDGET_KEY" async></script>
 *
 * No framework, no build step. This script only:
 *   1. renders a floating launcher button (in a closed Shadow DOM, isolated
 *      from the host page's CSS/JS),
 *   2. on click, lazily creates a sandboxed <iframe> pointing at our own
 *      origin's /embed/<key> page.
 * Everything else — chat UI, the AI, lead capture — runs inside that iframe,
 * on OUR origin, using the exact same code path as every other chat surface.
 * This file never talks to any API directly and holds no secret: the widget
 * key is a public, rotatable identifier, not a credential.
 */
(function () {
  "use strict";

  // Capture our own <script> element synchronously — document.currentScript
  // is only valid while this top-level script body is still executing.
  var thisScript = document.currentScript;
  if (!thisScript) return;

  var widgetKey = thisScript.getAttribute("data-widget-key");
  if (!widgetKey || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(widgetKey)) {
    return; // no valid key → render nothing rather than a broken button
  }

  var appOrigin;
  try {
    appOrigin = new URL(thisScript.src).origin;
  } catch {
    return;
  }

  // A page may only embed one widget instance.
  if (window.__leadflowWidgetMounted) return;
  window.__leadflowWidgetMounted = true;

  var position = thisScript.getAttribute("data-position");
  if (position !== "left" && position !== "right") {
    // Auto-flip for an RTL host page unless the embedder overrides it.
    var htmlDir = (document.documentElement.getAttribute("dir") || "").toLowerCase();
    position = htmlDir === "rtl" ? "left" : "right";
  }
  var side = position === "left" ? "left" : "right";

  var host = document.createElement("div");
  host.style.all = "initial"; // isolate from host-page CSS reaching the host element itself
  document.body.appendChild(host);
  var root = host.attachShadow ? host.attachShadow({ mode: "closed" }) : host;

  var style = document.createElement("style");
  style.textContent =
    ":host, .lf-root { all: initial; }" +
    ".lf-launcher {" +
    "  position: fixed; z-index: 2147483000;" +
    "  bottom: calc(20px + env(safe-area-inset-bottom, 0px));" +
    "  " + side + ": calc(20px + env(safe-area-inset-" + side + ", 0px));" +
    "  width: 56px; height: 56px; border-radius: 999px; border: none; cursor: pointer;" +
    "  background: #4f46e5; color: #fff; box-shadow: 0 6px 20px rgba(0,0,0,.25);" +
    "  display: flex; align-items: center; justify-content: center;" +
    "  transition: transform .15s ease;" +
    "}" +
    ".lf-launcher:hover { transform: scale(1.06); }" +
    ".lf-launcher:focus-visible { outline: 2px solid #fff; outline-offset: 2px; box-shadow: 0 0 0 4px #4f46e5; }" +
    ".lf-launcher svg { width: 26px; height: 26px; display: block; }" +
    ".lf-panel {" +
    "  position: fixed; z-index: 2147483000; box-sizing: border-box;" +
    "  bottom: calc(90px + env(safe-area-inset-bottom, 0px));" +
    "  " + side + ": calc(20px + env(safe-area-inset-" + side + ", 0px));" +
    "  width: 380px; max-width: calc(100vw - 24px); height: 640px; max-height: calc(100vh - 110px);" +
    "  border-radius: 16px; overflow: hidden; box-shadow: 0 12px 40px rgba(0,0,0,.3);" +
    "  background: #fff; display: none;" +
    "}" +
    ".lf-panel.lf-open { display: block; }" +
    ".lf-panel iframe { width: 100%; height: 100%; border: 0; display: block; position: relative; z-index: 1; }" +
    ".lf-close {" +
    "  position: absolute; top: 8px; " + (side === "left" ? "right" : "left") + ": 8px; z-index: 2;" +
    "  width: 28px; height: 28px; border-radius: 999px; border: none; cursor: pointer;" +
    "  background: rgba(0,0,0,.45); color: #fff; display: flex; align-items: center; justify-content: center;" +
    "}" +
    ".lf-close:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }" +
    ".lf-loading {" +
    "  position: absolute; inset: 0; z-index: 1; display: flex;" +
    "  align-items: center; justify-content: center; background: #fff;" +
    "}" +
    ".lf-spinner {" +
    "  width: 28px; height: 28px; border-radius: 999px;" +
    "  border: 3px solid rgba(79,70,229,.2); border-top-color: #4f46e5;" +
    "  animation: lf-spin .7s linear infinite;" +
    "}" +
    "@keyframes lf-spin { to { transform: rotate(360deg); } }" +
    "@media (max-width: 480px) {" +
    "  .lf-panel {" +
    "    bottom: env(safe-area-inset-bottom, 0px); " + side + ": env(safe-area-inset-" + side + ", 0px);" +
    "    width: 100vw; max-width: 100vw;" +
    "    height: calc(100vh - env(safe-area-inset-bottom, 0px)); max-height: calc(100vh - env(safe-area-inset-bottom, 0px));" +
    "    border-radius: 0;" +
    "  }" +
    "}";
  root.appendChild(style);

  var wrap = document.createElement("div");
  wrap.className = "lf-root";
  root.appendChild(wrap);

  var panel = document.createElement("div");
  panel.className = "lf-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Chat");
  panel.setAttribute("aria-hidden", "true");
  wrap.appendChild(panel);

  var loading = document.createElement("div");
  loading.className = "lf-loading";
  var spinner = document.createElement("div");
  spinner.className = "lf-spinner";
  loading.appendChild(spinner);
  panel.appendChild(loading);

  var closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "lf-close";
  closeBtn.setAttribute("aria-label", "Close chat");
  // Static markup only — never interpolated with widget-key / host data.
  closeBtn.innerHTML =
    '<svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">' +
    '<path d="M5 5l10 10M15 5L5 15" stroke-linecap="round"/></svg>';
  panel.appendChild(closeBtn);

  var launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "lf-launcher";
  launcher.setAttribute("aria-label", "Open chat");
  launcher.setAttribute("aria-expanded", "false");
  var CHAT_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
  var CLOSE_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
    '<path d="M6 6l12 12M18 6L6 18"/></svg>';
  launcher.innerHTML = CHAT_ICON;
  wrap.appendChild(launcher);

  var iframeCreated = false;
  var open = false;
  var iframe = null;

  function ensureIframe() {
    if (iframeCreated) return;
    iframeCreated = true;
    iframe = document.createElement("iframe");
    var src =
      appOrigin +
      "/embed/" +
      encodeURIComponent(widgetKey) +
      "?parentOrigin=" +
      encodeURIComponent(window.location.origin);
    iframe.title = "Chat";
    iframe.setAttribute(
      "sandbox",
      "allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox",
    );
    iframe.setAttribute("allow", "clipboard-write");
    // Hide the spinner once the embed page has actually painted, whether it
    // loaded normally or landed on the "chat unavailable" state — either way
    // there is real content to show, not a blank flash.
    iframe.addEventListener("load", function () {
      loading.style.display = "none";
    });
    iframe.src = src;
    panel.insertBefore(iframe, loading);
  }

  function setOpen(next) {
    open = next;
    if (open) ensureIframe();
    panel.classList.toggle("lf-open", open);
    panel.setAttribute("aria-hidden", open ? "false" : "true");
    launcher.innerHTML = open ? CLOSE_ICON : CHAT_ICON;
    launcher.setAttribute("aria-label", open ? "Close chat" : "Open chat");
    launcher.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      // Move focus into the panel for keyboard/screen-reader users — the
      // close button is the first sensible stop (the iframe's own content is
      // a separate document and receives focus normally once tabbed into).
      closeBtn.focus();
    } else {
      launcher.focus();
    }
  }

  launcher.addEventListener("click", function () {
    setOpen(!open);
  });
  closeBtn.addEventListener("click", function () {
    setOpen(false);
  });
  document.addEventListener("keydown", function (event) {
    if (open && event.key === "Escape") setOpen(false);
  });

  // Escape pressed WITHIN the iframe's own document — its own Escape listener
  // (this file, above) can't see that keydown (iframes are a separate event
  // tree), so the chat page posts a message instead. Only trusted when it
  // comes from exactly our own iframe's window — not origin-checked because
  // the iframe's own origin can vary by deployment, but `event.source` is an
  // unforgeable window reference no other frame can produce.
  window.addEventListener("message", function (event) {
    if (!iframe || event.source !== iframe.contentWindow) return;
    var data = event.data;
    if (data && data.source === "leadflow-widget" && data.type === "close") {
      setOpen(false);
    }
  });
})();
