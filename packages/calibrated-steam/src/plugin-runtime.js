globalThis.createPlugin = function createPlugin() {
  let settings = {};
  let loaded = false;
  let calibration = null, calibrationToken = null, calibrationTimer = null, latestMachine = null, latestMachineAt = 0;
  const calibrationActive = () => calibration?.snapshot().active === true;
  async function machineRequest(path, method = 'GET', body) {
    const response = await fetch('http://localhost:8080/api/v1/' + path, {
      method, headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error('Machine request failed (' + response.status + ').');
    return method === 'GET' ? response.json() : null;
  }
  function scheduleCalibration() {
    if (calibrationTimer !== null || !loaded) return;
    calibrationTimer = setTimeout(async () => {
      calibrationTimer = null;
      try { await calibration?.tick(); }
      finally { if (calibrationActive()) scheduleCalibration(); }
    }, 250);
  }
  async function calibrationRequest(body) {
    if (!body || typeof body !== 'object') return json(400, { message: 'Supply a calibration action.' });
    try {
      if (body.action === 'begin') {
        if (calibrationActive()) return json(409, { message: 'Another calibration is active.' });
        calibration = createCalibrationSession({
          readWorkflow: () => machineRequest('workflow'),
          writeSteam: steamSettings => machineRequest('workflow', 'PUT', { steamSettings }),
          requestState: state => machineRequest('machine/state/' + state, 'PUT'),
        });
        if (latestMachine && Date.now() - latestMachineAt <= 3000) calibration.observe(latestMachine);
        calibrationToken = Date.now().toString(36) + Math.random().toString(36).slice(2);
        scheduleCalibration();
        await calibration.begin(body);
      } else {
        if (!calibration || body.token !== calibrationToken) return json(409, { message: 'This calibration session is no longer available.' });
        if (!['heartbeat', 'start', 'stop', 'cancel'].includes(body.action)) return json(400, { message: 'Unknown calibration action.' });
        calibration.heartbeat();
        await calibration[body.action]();
      }
      return json(200, { ...calibration.snapshot(), token: calibrationToken });
    } catch (error) {
      return json(409, { ...calibration?.snapshot(), token: calibrationToken, message: error.message });
    } finally { if (calibrationActive()) scheduleCalibration(); }
  }
  const defaults = Object.fromEntries(Object.entries(MANIFEST.settings).map(([key, schema]) => [key, schema.default]));
  const json = (status, value) => ({ status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(value) });

  function configured(values) {
    return Object.fromEntries(Object.keys(defaults).map(key => [key, values[key] ?? defaults[key]]));
  }

  return {
    id: MANIFEST.id,
    version: MANIFEST.version,
    onLoad(values = {}) {
      settings = configured(values);
      if (settings.referenceFlow === 0) settings.referenceFlow = defaults.referenceFlow;
      if (values.autoDetect === undefined && !availablePitchers(settings).includes(settings.defaultPitcher)) {
        settings.defaultPitcher = configuredPitchers(settings)[0] ?? 'small';
      }
      loaded = true;
    },
    onUnload() {
      loaded = false; settings = {};
      if (calibrationTimer !== null) clearTimeout(calibrationTimer);
      calibrationTimer = null;
      if (calibrationActive()) calibration.cancel('Extension unloaded; calibration is incomplete.');
    },
    onEvent(event) {
      if (event.name !== 'stateUpdate') return;
      latestMachine = event.payload;
      latestMachineAt = Date.now();
      calibration?.observe(event.payload);
    },
    __httpRequestHandler(request) {
      if (!loaded) return json(503, { code: 'plugin_disabled', message: 'Enable the calibrated steam plugin.' });
      const { endpoint, method, body } = request;
      const methods = { status: 'GET', calculate: 'POST', validate: 'POST', ui: 'GET', calibration: 'POST' };
      if (!methods[endpoint]) return json(404, { code: 'not_found', message: 'Unknown endpoint.' });
      if (method !== methods[endpoint]) return json(405, { code: 'method_not_allowed', message: `Use ${methods[endpoint]}.` });
      if (endpoint === 'calibration') return calibrationRequest(body);
      if (endpoint === 'status') return json(200, { apiVersion: 4, version: MANIFEST.version, calibrationActive: calibrationActive(), ready: validateSettings(settings).length === 0, settings, flowCalibration: flowCalibration(settings), availablePitchers: availablePitchers(settings), errors: validateSettings(settings), schema: MANIFEST.settings });
      if (endpoint === 'ui') return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }, body: settingsPage() };
      if (endpoint === 'validate') {
        if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { code: 'invalid_request', message: 'Settings must be an object.' });
        const errors = validateSettings(configured(body));
        return json(errors.length ? 422 : 200, { valid: errors.length === 0, errors });
      }
      if (calibrationActive()) return json(409, { code: 'calibration_active', message: 'Finish or cancel guided calibration first.' });
      try {
        return json(200, { ...calculate(settings, body), calibrationRevision: JSON.stringify(settings) });
      } catch (error) {
        if (error instanceof CalculationError) return json(422, { code: error.code, message: error.message });
        return json(500, { code: 'calculation_failed', message: 'Unable to calculate a steam time.' });
      }
    },
  };
};
