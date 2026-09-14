export function readFlowReadings(settings) {
  try {
    if (typeof settings.flowReadings !== 'string' || settings.flowReadings.length > 4096) return null;
    const readings = JSON.parse(settings.flowReadings);
    return Array.isArray(readings) ? readings : null;
  } catch { return null; }
}

export function validFlowReading(reading) {
  return reading && Number.isFinite(reading.flow) && reading.flow >= 0.4 && reading.flow <= 2.5 &&
    Number.isFinite(reading.milkGrams) && reading.milkGrams >= 10 && reading.milkGrams <= 1500 &&
    Number.isFinite(reading.seconds) && reading.seconds >= 1 && reading.seconds <= 255;
}

export function validateFlowCalibration(settings) {
  const mode = settings.calibrationMode ?? 'single';
  if (!['single', 'multiple'].includes(mode)) return [{ field: 'calibrationMode', message: 'Choose Single flow or Multiple flows.' }];
  if (mode === 'single') return [];
  const readings = readFlowReadings(settings);
  if (!readings || readings.length < 2 || readings.length > 4 || readings.some((reading, index) =>
    !validFlowReading(reading) || (index > 0 && (!validFlowReading(readings[index - 1]) || reading.flow - readings[index - 1].flow < 0.099999)))) {
    return [{ field: 'flowReadings', message: 'Complete 2–4 readings with increasing flows at least 0.1 ml/s apart, 10–1500 g of milk and 1–255 seconds.' }];
  }
  if (!Number.isFinite(settings.referenceFlow) || settings.referenceFlow < readings[0].flow || settings.referenceFlow > readings[readings.length - 1].flow) {
    return [{ field: 'referenceFlow', message: 'Default Auto flow must be within the calibrated range.' }];
  }
  return [];
}

export function flowCalibration(settings) {
  if (validateFlowCalibration(settings).length) return null;
  const multiple = settings.calibrationMode === 'multiple';
  const readings = multiple ? readFlowReadings(settings) : [{ flow: settings.referenceFlow, milkGrams: settings.referenceMilkGrams, seconds: settings.referenceSeconds }];
  if (!readings.every(validFlowReading)) return null;
  return { mode: multiple ? 'multiple' : 'single', adjustable: multiple,
    minimum: readings[0].flow, maximum: readings[readings.length - 1].flow, defaultFlow: settings.referenceFlow, readings };
}

export function secondsPerGram(settings, flow) {
  if (settings.calibrationMode !== 'multiple') return settings.referenceSeconds / settings.referenceMilkGrams;
  const readings = readFlowReadings(settings);
  for (let i = 1; i < readings.length; i++) {
    const a = readings[i - 1], b = readings[i];
    if (flow <= b.flow) {
      const position = (flow - a.flow) / (b.flow - a.flow);
      return (1 - position) * a.seconds / a.milkGrams + position * b.seconds / b.milkGrams;
    }
  }
  return NaN;
}

export function proposedFlows(minimum, maximum, count) {
  if (![2, 3, 4].includes(count) || !Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum < 0.4 || maximum > 2.5 || maximum <= minimum) {
    throw new Error('Choose 2–4 readings and a flow range between 0.4 and 2.5 ml/s.');
  }
  const flows = Array.from({ length: count }, (_, index) => Math.round((minimum + (maximum - minimum) * index / (count - 1)) * 10) / 10);
  flows[0] = minimum; flows[flows.length - 1] = maximum;
  if (flows.some((flow, index) => index > 0 && flow - flows[index - 1] < 0.099999)) throw new Error('Choose fewer readings or a wider flow range.');
  return flows;
}
