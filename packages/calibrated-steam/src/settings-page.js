function settingsBrowser() {
  const base = '/api/v1/plugins/calibrated-steam.reaplugin';
  const form = document.getElementById('settings');
  const status = document.getElementById('status');
  const save = document.getElementById('save');
  let schema = {};
  async function request(path, options) {
    const response = await fetch(path, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || (data.errors || []).map(error => error.message).join(' ') || 'Request failed.');
    return data;
  }
  async function load() {
    try {
      const data = await request(base + '/status');
      schema = data.schema;
      for (const [key, item] of Object.entries(schema)) {
        const label = document.createElement('label');
        const title = document.createElement('span');
        title.textContent = item.label;
        label.append(title);
        const input = document.createElement(item.type === 'enum' ? 'select' : 'input');
        input.name = key;
        if (item.type === 'enum') {
          for (const value of item.values) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value;
            input.append(option);
          }
        } else {
          input.type = 'number';
          input.step = 'any';
          input.inputMode = 'decimal';
          input.required = true;
        }
        input.value = data.settings[key];
        label.append(input);
        const help = document.createElement('small');
        help.textContent = item.description;
        label.append(help);
        form.append(label);
      }
      status.textContent = data.ready ? 'Calibration is ready.' : 'Enter your measured calibration values before using Auto Calc.';
      save.disabled = false;
    } catch (error) { status.textContent = error.message; }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    save.disabled = true;
    try {
      const values = Object.fromEntries(Object.entries(schema).map(([key, item]) => {
        const value = form.elements.namedItem(key).value;
        return [key, item.type === 'number' ? (value.trim() === '' ? null : Number(value)) : value];
      }));
      const options = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(values) };
      await request(base + '/validate', options);
      await request(base + '/settings', options);
      status.textContent = 'Saved. Return to the calculator to use this calibration.';
    } catch (error) { status.textContent = error.message; }
    finally { save.disabled = false; }
  });
  load();
}

function settingsPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Calibrated Steam Timer</title>
<style>:root{color-scheme:light dark;font:18px system-ui,sans-serif}body{max-width:850px;margin:auto;padding:24px;background:Canvas;color:CanvasText}h1{font-size:28px}p{line-height:1.5}form{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:22px}label{display:flex;flex-direction:column;gap:8px}label span{font-weight:600}small{opacity:.8;line-height:1.4}input,select,button{font:inherit;padding:12px;border:1px solid GrayText;border-radius:8px;color:CanvasText;background:Canvas}button{cursor:pointer;min-height:48px}#status{min-height:2em}a{color:LinkText}footer{margin-top:28px;font-size:15px}</style></head><body>
<h1>Calibrated Steam Timer</h1><p>Measure how long a known weight of milk takes to reach your preferred temperature. Use similar starting milk temperature, milk type and steaming technique each time. The timer estimates the result; it does not read milk temperature.</p>
<p>For automatic jug selection, weigh the jug and milk together without taring. The jug choice is an estimate and can be corrected in the calculator. Choose <strong>tared</strong> mode if your scale displays milk weight only.</p>
<form id="settings"></form><p id="status" role="status" aria-live="polite">Loading settings…</p><button id="save" form="settings" type="submit" disabled>Save calibration</button>
<footer>Calibration formula and automatic jug-selection heuristic inspired by <a href="https://github.com/Damian-AU/DSx2">Damian / Damian-AU’s DSx2</a>. JavaScript implementation for Decaid by pponce.</footer>
<script>(${settingsBrowser.toString()})();</script></body></html>`;
}
