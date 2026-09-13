function settingsBrowser(resolveReturnUrl) {
  const base = '/api/v1/plugins/calibrated-steam.reaplugin';
  const form = document.getElementById('settings');
  const status = document.getElementById('status');
  const save = document.getElementById('save');
  const back = document.getElementById('return-settings');
  back.href = resolveReturnUrl(window.location.href, document.referrer);
  let schema = {};
  async function request(path, options) {
    const response = await fetch(path, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || data.error || (data.errors || []).map(error => error.message).join(' ') || 'Request failed.');
    return data;
  }
  async function load() {
    try {
      const data = await request(base + '/status');
      schema = data.schema;
      const groups = [
        ['Pitcher weights and selection', ['smallJugGrams', 'mediumJugGrams', 'largeJugGrams', 'weightMode', 'autoDetect', 'defaultJug']],
        ['Automatic pitcher detection', ['singleDrinkGrams', 'singleDrinkJug']],
        ['Steam calibration', ['referenceMilkGrams', 'referenceSeconds', 'referenceFlow']],
      ];
      const labels = {};
      for (const [heading, keys] of groups) {
        const section = document.createElement('fieldset');
        const legend = document.createElement('legend');
        legend.textContent = heading;
        section.append(legend);
        form.append(section);
        for (const key of keys) {
          const item = schema[key];
          if (!item) continue;
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
              option.textContent = value || 'Choose a pitcher';
              input.append(option);
            }
          } else if (item.type === 'boolean') {
            input.type = 'checkbox';
            input.checked = data.settings[key] === true;
          } else {
            input.type = 'number';
            input.step = 'any';
            input.inputMode = 'decimal';
            input.required = !key.endsWith('JugGrams');
            input.min = key === 'referenceFlow' ? '0.4' : '0';
            if (key === 'referenceFlow') { input.max = '2.5'; input.step = '0.1'; }
          }
          if (item.type !== 'boolean') input.value = item.type === 'number' && data.settings[key] === 0 ? '' : data.settings[key];
          label.append(input);
          const help = document.createElement('small');
          help.textContent = item.description;
          label.append(help);
          section.append(label);
          labels[key] = label;
        }
      }
      const field = key => form.elements.namedItem(key);
      const updateChoices = () => {
        const automatic = field('autoDetect').checked;
        for (const key of ['singleDrinkGrams', 'singleDrinkJug']) {
          labels[key].closest('fieldset').hidden = !automatic;
          field(key).required = automatic;
        }
        const choices = ['small', 'medium', 'large'].filter(size => {
          const weight = Number(field(`${size}JugGrams`).value);
          return weight >= 1 && weight <= 3000;
        });
        const milk = Number(field('singleDrinkGrams').value);
        if (automatic && choices.length === 3 && field('weightMode').value === 'gross' && milk >= 10 && milk <= 1000 &&
            ['small', 'medium'].includes(field('singleDrinkJug').value)) choices.push('auto');
        const select = field('defaultJug');
        const previous = select.value;
        select.replaceChildren();
        for (const value of choices) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = value === 'auto' ? 'Auto' : value[0].toUpperCase() + value.slice(1);
          select.append(option);
        }
        select.value = choices.includes(previous) ? previous : (choices[0] ?? '');
        select.disabled = choices.length === 0;
      };
      form.addEventListener('input', updateChoices);
      form.addEventListener('change', updateChoices);
      updateChoices();
      status.textContent = data.ready ? 'Calibration is ready.' : 'Enter at least one pitcher weight and your measured calibration. Steam stays Off in Auto mode until setup and a calculation are complete.';
      save.disabled = false;
    } catch (error) { status.textContent = error.message; }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    save.disabled = true;
    try {
      const values = Object.fromEntries(Object.entries(schema).map(([key, item]) => {
        const input = form.elements.namedItem(key);
        return [key, item.type === 'boolean' ? input.checked : item.type === 'number' ? (input.value.trim() === '' ? 0 : Number(input.value)) : input.value];
      }));
      const options = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(values) };
      await request(base + '/validate', options);
      await request(base + '/settings', options);
      window.location.assign(back.href);
    } catch (error) { status.textContent = error.message; }
    finally { save.disabled = false; }
  });
  load();
}

function settingsPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Auto Steam Calculator</title>
<style>:root{color-scheme:light dark;font:18px system-ui,sans-serif}body{max-width:850px;margin:auto;padding:24px;background:Canvas;color:CanvasText}h1{font-size:28px}p{line-height:1.5}fieldset{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:22px;border:1px solid GrayText;border-radius:8px;padding:20px}legend{font-weight:600}fieldset[hidden]{display:none}form{display:grid;grid-template-columns:1fr;gap:22px}label{display:flex;flex-direction:column;gap:8px}label span{font-weight:600}small{opacity:.8;line-height:1.4}input,select,button{font:inherit;padding:12px;border:1px solid GrayText;border-radius:8px;color:CanvasText;background:Canvas}input[type=checkbox]{width:28px;height:28px}button{cursor:pointer;min-height:48px}#status{min-height:2em}a{color:LinkText}#return-settings{display:inline-block;padding:14px 18px;border:1px solid GrayText;border-radius:8px;text-decoration:none}footer{margin-top:28px;font-size:15px}</style></head><body>
<a id="return-settings" href="/api/v1/plugins/settings.reaplugin/ui">Return to settings</a>
<h1>Auto Steam Calculator</h1><p>Measure how long a known weight of milk takes to reach your preferred temperature. Use similar starting milk temperature, milk type and steaming technique each time. The timer estimates the result; it does not read milk temperature.</p>
<p>Enter at least one empty pitcher weight. Leave unused sizes blank or 0; only configured sizes appear in the steam controls. Choose a starting pitcher selection; the skin can remember subsequent selections.</p>
<p>Enable <strong>Offer Auto pitcher selection</strong> if you want automatic detection. Then enter your usual milk per drink and the pitcher normally used for one drink. Damian’s detection thresholds require all three pitcher weights and <strong>gross</strong> scale weight (pitcher plus milk, without taring). With Auto detection disabled, you can configure just the sizes you use. <strong>Tared</strong> mode uses milk weight only and does not subtract the pitcher.</p>
<p>For calibration, use manual Flow or Time mode to steam a known milk-only weight to your preferred temperature. Record the seconds and flow used. Auto steam mode applies that flow with each calculated time. Use the same normal steam heater setting; the calculator does not compensate for changes to heater or starting milk temperature.</p><form id="settings"></form><p id="status" role="status" aria-live="polite">Loading settings…</p><button id="save" form="settings" type="submit" disabled>Save calibration</button>
<footer>Calibration formula and automatic pitcher-selection heuristic inspired by <a href="https://github.com/Damian-AU/DSx2">Damian / Damian-AU’s DSx2</a>. JavaScript implementation for Decaid by pponce.</footer>
<script>(${settingsBrowser.toString()})(${settingsReturnUrl.toString()});</script></body></html>`;
}
