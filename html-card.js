const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const loadedScripts = new Set();
const TEMPLATE_RE = /\{\{|\{%|\{#/;

class HtmlCard extends HTMLElement {
  constructor() {
    super();
    this._config = null;
    this._hass = null;
    this._container = null;
    this._rendered = false;
    this._tpl = false;
    this._gen = 0;
    this._runId = 0;
    this._embedded = [];
    this._unsub = null;
    this._subscribed = false;
    this.onHass = null;
  }

  setConfig(config) {
    if (!config || typeof config.content !== "string") {
      throw new Error("html-card: 'content' (HTML string) is required");
    }
    this._teardown();
    this._config = config;
    this._rendered = false;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._embedded.forEach((el) => {
      el.hass = hass;
    });
    if (!this._rendered) {
      this._render();
    } else if (this._tpl && !this._subscribed) {
      this._subscribe();
    }
    if (typeof this.onHass === "function") {
      try {
        this.onHass(hass);
      } catch (e) {
        console.error("html-card: error in onHass", e);
      }
    }
    this.dispatchEvent(new CustomEvent("hass-update", { detail: hass }));
  }

  get hass() {
    return this._hass;
  }

  getCardSize() {
    return this._config?.card_size ?? 3;
  }

  connectedCallback() {
    if (this._rendered && this._tpl && !this._subscribed && this._hass) {
      this._subscribe();
    }
  }

  disconnectedCallback() {
    if (this._tpl) this._teardown();
    this.dispatchEvent(new CustomEvent("html-card-disconnected"));
  }

  _teardown() {
    this._gen++;
    this._runId++;
    if (this._unsub) {
      try {
        this._unsub();
      } catch (e) {}
      this._unsub = null;
    }
    this._subscribed = false;
  }

  _render() {
    if (!this._config) return;
    this._rendered = true;
    this.onHass = null;

    const cfg = this._config;
    const useShadow = cfg.shadow !== false;
    const useCard = cfg.card !== false;

    this.innerHTML = "";
    if (this.shadowRoot) this.shadowRoot.innerHTML = "";

    const host = useShadow ? this.shadowRoot || this.attachShadow({ mode: "open" }) : this;

    const container = document.createElement(useCard ? "ha-card" : "div");
    host.appendChild(container);
    this._container = container;

    this._tpl = cfg.templates !== false && TEMPLATE_RE.test(cfg.content);

    if (this._tpl) {
      if (this._hass) this._subscribe();
    } else {
      this._apply(cfg.content);
    }
  }

  _subscribe() {
    if (!this._hass?.connection || !this._config) return;
    this._subscribed = true;
    const gen = this._gen;

    this._hass.connection
      .subscribeMessage(
        (msg) => {
          if (gen !== this._gen) return;
          if (msg.error) {
            this._showError("Template error: " + msg.error);
            return;
          }
          const res = msg.result;
          const html =
            typeof res === "string"
              ? res
              : res !== null && typeof res === "object"
              ? JSON.stringify(res)
              : String(res);
          this._apply(html);
        },
        {
          type: "render_template",
          template: this._config.content,
          variables: { config: this._config },
          strict: false,
          report_errors: true,
        }
      )
      .then((unsub) => {
        if (gen !== this._gen) {
          unsub();
        } else {
          this._unsub = unsub;
        }
      })
      .catch((e) => {
        if (gen !== this._gen) return;
        this._subscribed = false;
        this._showError("Template error: " + (e?.message || JSON.stringify(e)));
      });
  }

  _showError(text) {
    if (!this._container) return;
    this._runId++;
    this._container.innerHTML = "";
    const err = document.createElement("pre");
    err.style.cssText = "color:#c00;white-space:pre-wrap;padding:8px;margin:0";
    err.textContent = text;
    this._container.appendChild(err);
  }

  _apply(html) {
    const container = this._container;
    if (!container) return;
    const run = ++this._runId;
    this.onHass = null;
    this._embedded = [];
    container.innerHTML = "";

    const tpl = document.createElement("template");
    tpl.innerHTML = html;
    const fragment = tpl.content;

    const scripts = Array.from(fragment.querySelectorAll("script"));
    const scriptData = scripts.map((s) => ({
      src: s.getAttribute("src"),
      type: s.getAttribute("type"),
      text: s.textContent,
      attrs: Array.from(s.attributes),
    }));
    scripts.forEach((s) => s.remove());

    container.appendChild(fragment);

    this._embedCards(container, run).then(() => this._runScripts(scriptData, container, run));
  }

  async _createCard(cfg, run) {
    const helpers = await window.loadCardHelpers();
    const el = await helpers.createCardElement(cfg);
    if (this._hass) el.hass = this._hass;
    if (run === undefined || run === this._runId) this._embedded.push(el);
    return el;
  }

  async _embedCards(root, run) {
    const nodes = Array.from(root.querySelectorAll("hass-card"));
    for (const node of nodes) {
      node.style.display = "block";
      try {
        const raw = node.getAttribute("config") ?? node.textContent;
        const cfg = JSON.parse(raw);
        node.textContent = "";
        const el = await this._createCard(cfg, run);
        if (run !== this._runId) return;
        node.appendChild(el);
      } catch (e) {
        node.style.color = "#c00";
        node.textContent = "hass-card error: " + e.message;
      }
    }
  }

  async _runScripts(list, root, run) {
    for (const s of list) {
      if (run !== this._runId) return;

      const isModule = s.type === "module";
      const isExternal = !!s.src;

      if (isExternal || isModule) {
        if (isExternal) {
          if (loadedScripts.has(s.src)) continue;
          loadedScripts.add(s.src);
        }
        await new Promise((resolve) => {
          const el = document.createElement("script");
          s.attrs.forEach((a) => el.setAttribute(a.name, a.value));
          if (!isExternal) el.textContent = s.text;
          el.onload = el.onerror = () => resolve();
          document.head.appendChild(el);
          if (!isExternal) resolve();
        });
        continue;
      }

      try {
        const fn = new AsyncFunction("root", "card", "config", "getHass", "hass", "createCard", s.text);
        await fn.call(
          this,
          root,
          this,
          this._config,
          () => this._hass,
          this._hass,
          (cfg) => this._createCard(cfg, run)
        );
      } catch (e) {
        console.error("html-card: script error", e);
        const err = document.createElement("pre");
        err.style.cssText = "color:#c00;white-space:pre-wrap;padding:8px;margin:0";
        err.textContent = "html-card script error: " + e.message;
        root.appendChild(err);
      }
    }
  }

  static getConfigElement() {
    return document.createElement("html-card-editor");
  }

  static getStubConfig() {
    return {
      type: "custom:html-card",
      content: '<style>.t{padding:16px}</style>\n<div class="t">Hello, <b>HTML</b>!</div>',
    };
  }
}

class HtmlCardEditor extends HTMLElement {
  constructor() {
    super();
    this._config = {};
    this._timer = null;
    this._built = false;
  }

  setConfig(config) {
    this._config = { ...config };
    if (!this._built) this._build();
    const ta = this.querySelector("textarea");
    if (ta && this.getRootNode().activeElement !== ta && ta.value !== (this._config.content || "")) {
      ta.value = this._config.content || "";
    }
    this.querySelector("#shadow").checked = this._config.shadow !== false;
    this.querySelector("#card").checked = this._config.card !== false;
    this.querySelector("#templates").checked = this._config.templates !== false;
  }

  set hass(hass) {
    this._hass = hass;
  }

  _build() {
    this._built = true;
    this.innerHTML = `
      <style>
        html-card-editor { display: block; }
        html-card-editor textarea {
          width: 100%;
          min-height: 300px;
          box-sizing: border-box;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 13px;
          line-height: 1.45;
          padding: 10px;
          resize: vertical;
          tab-size: 2;
          color: var(--primary-text-color);
          background: var(--code-editor-background-color, var(--secondary-background-color));
          border: 1px solid var(--divider-color);
          border-radius: 6px;
        }
        html-card-editor .opts { display: flex; gap: 24px; margin-top: 12px; flex-wrap: wrap; }
        html-card-editor label { display: flex; align-items: center; gap: 8px; color: var(--primary-text-color); cursor: pointer; }
        html-card-editor .hint { margin-top: 10px; font-size: 12px; color: var(--secondary-text-color); }
      </style>
      <textarea spellcheck="false" placeholder="<div>Your HTML, CSS and JS here</div>"></textarea>
      <div class="opts">
        <label><input type="checkbox" id="templates"> HA templates</label>
        <label><input type="checkbox" id="shadow"> Shadow DOM</label>
        <label><input type="checkbox" id="card"> Wrap in ha-card</label>
      </div>
      <div class="hint">Use {% raw %} ... {% endraw %} to keep literal {{ }} in JS or CSS.</div>
    `;

    const ta = this.querySelector("textarea");
    ta.addEventListener("input", () => {
      clearTimeout(this._timer);
      this._timer = setTimeout(() => this._update({ content: ta.value }), 400);
    });
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const s = ta.selectionStart;
        ta.setRangeText("  ", s, ta.selectionEnd, "end");
        ta.dispatchEvent(new Event("input"));
      }
      e.stopPropagation();
    });
    ta.addEventListener("keyup", (e) => e.stopPropagation());

    this.querySelector("#shadow").addEventListener("change", (e) =>
      this._update({ shadow: e.target.checked })
    );
    this.querySelector("#card").addEventListener("change", (e) =>
      this._update({ card: e.target.checked })
    );
    this.querySelector("#templates").addEventListener("change", (e) =>
      this._update({ templates: e.target.checked })
    );
  }

  _update(patch) {
    const config = { ...this._config, ...patch };
    if (config.shadow === true) delete config.shadow;
    if (config.card === true) delete config.card;
    if (config.templates === true) delete config.templates;
    this._config = config;
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config },
        bubbles: true,
        composed: true,
      })
    );
  }
}

if (!customElements.get("html-card")) {
  customElements.define("html-card", HtmlCard);
}

if (!customElements.get("html-card-editor")) {
  customElements.define("html-card-editor", HtmlCardEditor);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "html-card",
  name: "HTML Card",
  description: "Render arbitrary HTML, CSS and JavaScript in a card",
});
