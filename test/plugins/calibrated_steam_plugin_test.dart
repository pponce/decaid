import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:reaprime/src/plugins/plugin_manager.dart';
import 'package:reaprime/src/plugins/plugin_manifest.dart';

import 'plugin_test_helpers.dart';

void main() {
  final source = File(
    'assets/plugins/calibrated-steam.reaplugin/plugin.js',
  ).readAsStringSync();
  final manifest = PluginManifest.fromJson(
    jsonDecode(
          File(
            'assets/plugins/calibrated-steam.reaplugin/manifest.json',
          ).readAsStringSync(),
        )
        as Map<String, dynamic>,
  );
  const settings = <String, dynamic>{
    'autoDetect': true,
    'smallPitcherGrams': 150,
    'mediumPitcherGrams': 220,
    'largePitcherGrams': 300,
    'singleDrinkGrams': 160,
    'singleDrinkPitcher': 'small',
    'weightMode': 'gross',
    'referenceMilkGrams': 150,
    'referenceSeconds': 25,
    'referenceFlow': 1.5,
  };

  Future<Map<String, dynamic>> invoke(
    PluginManager manager,
    String endpoint, {
    String method = 'GET',
    Object? body,
  }) {
    const requestId = 'calibrated-steam-test';
    final pending = manager.registerPendingHttp(manifest.id, requestId);
    manager.dispatchEvent(manifest.id, 'httpRequest', {
      'requestId': requestId,
      'endpoint': endpoint,
      'method': method,
      'body': body,
    });
    return pending.timeout(const Duration(seconds: 5));
  }

  test(
    'bundled calculator works through the native plugin HTTP bridge',
    () async {
      final manager = PluginManager(kvStore: FakeKeyValueStoreService());
      addTearDown(manager.dispose);
      await manager.loadPlugin(
        id: manifest.id,
        manifest: manifest,
        settings: settings,
        jsCode: source,
      );
      final response = await invoke(
        manager,
        'calculate',
        method: 'POST',
        body: {
          'samples': [
            for (final age in [800, 400, 0]) {'weightGrams': 330, 'ageMs': age},
          ],
          'pitcher': 'auto',
          'machineState': 'idle',
          'stopAtTemperature': 0,
        },
      );
      expect(response['status'], 200);
      final body = jsonDecode(response['body'] as String);
      expect(body['durationSeconds'], 30);
      expect(body['pitcher'], 'small');
      expect(body['workflowPatch'], {
        'steamSettings': {'duration': 30, 'flow': 1.5},
      });
      final invalid = await invoke(
        manager,
        'calculate',
        method: 'POST',
        body: {},
      );
      expect(invalid['status'], 422);
    },
  );

  test('unconfigured plugin renders settings without arming a timer', () async {
    final manager = PluginManager(kvStore: FakeKeyValueStoreService());
    addTearDown(manager.dispose);
    await manager.loadPlugin(
      id: manifest.id,
      manifest: manifest,
      settings: {},
      jsCode: source,
    );
    final status = await invoke(manager, 'status');
    expect(jsonDecode(status['body'] as String)['ready'], isFalse);
    final ui = await invoke(manager, 'ui');
    expect(ui['status'], 200);
    expect(ui['body'], contains('github.com/Damian-AU/DSx2'));
  });
}
