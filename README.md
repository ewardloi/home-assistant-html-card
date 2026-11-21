# HA HTML Card

A single Lovelace resource (`html-card.js`) that gives you a card where you can write **any HTML** - including `<style>`, `<script>`, external libraries, Home Assistant templates, and even other Lovelace cards - and have it rendered exactly as written.

You only supply the **content**. The card takes care of executing scripts, rendering templates, embedding cards and keeping everything in sync with Home Assistant.

## What's in the box

- `html-card` - the card itself. Add it to a dashboard like any other card.
- `html-card-editor` - a visual editor with a big text area for your HTML, so you never have to indent content inside YAML. Works like the built-in Markdown card editor.
- `<hass-card>` - a tag you can use inside your HTML to render any Lovelace card (built-in or custom).
- Home Assistant template support - `{{ states('sensor.x') }}` and `{% if %}` blocks are rendered by Home Assistant and update live.
- A script context - `root`, `card`, `config`, `hass`, `getHass()` and `createCard()` are available to your inline scripts.

## Installation

1. Copy `html-card.js` to your Home Assistant `www` folder, e.g. `/config/www/html-card.js`.

2. Add it as a Lovelace resource:

   **Settings → Dashboards → ⋮ (top right) → Resources → Add Resource**

   | Field         | Value                  |
   | ------------- | ---------------------- |
   | URL           | `/local/html-card.js`  |
   | Resource type | JavaScript Module      |

3. Hard-refresh your browser (Ctrl+Shift+R / Cmd+Shift+R) after installing or updating the file - browsers aggressively cache JS modules. If you added a version suffix such as `?v=1`, bump it.

No other resource or dependency is needed - everything lives in this one file.

## Adding the card

Pick **HTML Card** from the card picker, or use YAML:

```yaml
type: custom:html-card
content: |
  <style>
    .box { padding: 16px; font-size: 20px; }
  </style>
  <div class="box">Hello, <b>HTML</b>!</div>
```

The visual editor gives you a text area for `content` and checkboxes for the options below.

## Options

| Option      | Type    | Default | Description                                                                                  |
| ----------- | ------- | ------- | -------------------------------------------------------------------------------------------- |
| `content`   | string  | -       | **Required.** The HTML to render.                                                            |
| `shadow`    | boolean | `true`  | Render inside a Shadow DOM so styles do not leak in or out. `false` renders into the normal DOM. |
| `card`      | boolean | `true`  | Wrap the content in `ha-card`. Set to `false` for a bare container with no border or background. |
| `templates` | boolean | `true`  | Render Home Assistant templates. Only active when the content actually contains template syntax. |
| `card_size` | number  | `3`     | Height hint used by the dashboard layout.                                                    |

## Scripts

`<script>` tags are executed. Inline scripts run as async functions, so top-level `await` works, and these variables are available:

| Variable         | Description                                                              |
| ---------------- | ------------------------------------------------------------------------ |
| `root`           | The container element holding your rendered HTML.                        |
| `card`           | The `html-card` element itself.                                          |
| `config`         | The card configuration.                                                  |
| `hass`           | Snapshot of `hass` at the moment the script started (may be `null`).     |
| `getHass()`      | Always returns the current `hass`.                                       |
| `createCard(cfg)`| Creates a Lovelace card element from a config object. Returns a promise. |

To react to state changes, assign a function to `card.onHass`:

```html
<div id="out">Loading...</div>
<script>
  const el = root.querySelector('#out');
  const render = (h) => {
    el.textContent = 'Sun: ' + h.states['sun.sun'].state;
  };
  card.onHass = render;
  render(getHass());
</script>
```

`<script src="...">` and `<script type="module">` are added as real script tags to the page. They do not receive the variables above, but they can load libraries and use `import`. Each external `src` is loaded only once per page.

## Templates

Home Assistant templates are rendered by Home Assistant itself, so every Jinja function you already know is available:

```html
<style>
  .t { padding: 16px; font-size: 24px; }
</style>
<div class="t">
  {{ states('sensor.temperature') }} °C
  {% if is_state('light.kitchen', 'on') %}💡{% endif %}
</div>
```

The card subscribes to the template and re-renders whenever any entity used in it changes.

- Template syntax is detected automatically. Content without `{{`, `{%` or `{#` is rendered as plain HTML with no subscription.
- `{{ }}` inside `<script>` and `<style>` is also treated as a template. To keep literal braces, wrap them:

  ```
  {% raw %} ... {% endraw %}
  ```

- You can inject live values into scripts: `const t = {{ states('sensor.temperature') | float(0) }};`
- Set `templates: false` to disable template rendering entirely.
- Template errors are shown in red directly in the card.

> **Note:** Every time a template result changes, the card content is rebuilt and scripts run again. Long-lived state inside a script (timers, cached element references) is reset. For scripts that must keep running, read values from `hass.states` and set `templates: false`.

## Embedding other cards

Use the `<hass-card>` tag with the card configuration written as **JSON**:

```html
<div style="display:grid; grid-template-columns:1fr 1fr; gap:12px">
  <hass-card>
  {"type": "entities", "entities": ["light.kitchen", "sensor.temperature"]}
  </hass-card>
  <hass-card>
  {"type": "gauge", "entity": "sensor.temperature", "min": 0, "max": 40}
  </hass-card>
</div>
```

You can also pass the config as an attribute:

```html
<hass-card config='{"type":"button","entity":"light.kitchen"}'></hass-card>
```

Or create cards from a script:

```html
<div id="slot"></div>
<script>
  const el = await createCard({ type: "thermostat", entity: "climate.living_room" });
  root.querySelector("#slot").appendChild(el);
</script>
```

Embedded cards receive `hass` automatically and update together with the rest of the card. Any card type works - built-in or custom.

### Converting YAML to JSON

- keys and string values go in double quotes (`'10:5'` becomes `"10:5"`)
- `true`, `false` and numbers stay unquoted
- list items (`- entity: ...`) become arrays (`[ { ... } ]`)

> **Note:** If you want a nested card to process its own templates (for example a Markdown card), wrap them in `{% raw %}...{% endraw %}` so `html-card` does not render them first.

> **Tip:** Embedded cards inside a default `ha-card` get a double border. Set `card: false` to avoid it.

## Example: clickable tile that opens a map

A tile that opens Google Maps at the device's current position in a new tab, with the same hover highlight as a native clickable tile:

```html
<style>
  .wrap { position: relative; }
  .wrap a {
    position: absolute;
    inset: 0;
    z-index: 2;
    cursor: pointer;
    border-radius: var(--ha-card-border-radius, 12px);
    background: transparent;
    transition: background-color 0.15s ease;
    outline: none;
    -webkit-tap-highlight-color: transparent;
    -webkit-touch-callout: none;
    user-select: none;
  }
  .wrap a:hover {
    background: color-mix(in srgb, var(--primary-text-color) 6%, transparent);
  }
  .wrap a:active,
  .wrap a:focus-visible {
    background: color-mix(in srgb, var(--primary-text-color) 12%, transparent);
  }
</style>

<div class="wrap">
  <hass-card>
  {
    "type": "tile",
    "entity": "device_tracker.my_car",
    "name": "Open on Google Maps",
    "state_content": "last_changed",
    "vertical": false,
    "features_position": "bottom"
  }
  </hass-card>
  <a target="_blank" rel="noopener noreferrer" aria-label="Open on Google Maps"
     href="https://www.google.com/maps/search/?api=1&query={{ state_attr('device_tracker.my_car', 'latitude') }},{{ state_attr('device_tracker.my_car', 'longitude') }}"></a>
</div>
```

The link is an invisible overlay on top of the tile. Wrapping the tile in a plain `<a>` does not work reliably because the tile intercepts the click.

## Example: map card

```html
<hass-card>
{
  "type": "map",
  "entities": [
    { "entity": "device_tracker.my_car", "label_mode": "icon" }
  ],
  "aspect_ratio": "10:5",
  "default_zoom": 16,
  "auto_fit": false,
  "theme_mode": "auto"
}
</hass-card>
```

## Security

Scripts have full access to `hass`, which means they can call services and control devices. Only paste code you trust, and be careful with HTML copied from the internet. Dashboard editors can run arbitrary JavaScript in the browser of everyone who opens the dashboard.

## Troubleshooting

- **Card does not show up in the picker:** confirm the resource is added as a *JavaScript Module* and hard-refresh the browser.
- **Old behaviour after updating:** the browser cached the previous file. Hard-refresh or bump the `?v=` suffix on the resource URL.
- **`hass-card error` in red:** the JSON is invalid or the card type is unknown. Validate the JSON and check the card type.
- **Template error in red:** the template failed to render. Test it in **Developer tools → Template**.
- **Literal `{{ }}` disappears from scripts or styles:** wrap it in `{% raw %}...{% endraw %}` or set `templates: false`.
