import type { API, Logger, MatterAccessory } from 'homebridge';
import { describe, expect, it, vi } from 'vitest';
import { MatterPublisher } from '../src/matter/matter-publisher.js';
import { createExclusionMatcher } from '../src/util/exclusions.js';

describe('createExclusionMatcher', () => {
  it('excludes nothing when no exclusions are configured', () => {
    const isExcluded = createExclusionMatcher({});
    expect(isExcluded({ id: 'pool-heater', name: 'Pool Heater' })).toBe(false);
  });

  it('matches configured equipment IDs', () => {
    const isExcluded = createExclusionMatcher({ excludedDevices: ['pool-heater', 'spa-heater'] });
    expect(isExcluded({ id: 'pool-heater', name: 'Pool Heater' })).toBe(true);
    expect(isExcluded({ id: 'spa-heater', name: 'Spa Heater' })).toBe(true);
    expect(isExcluded({ id: 'filter-pump', name: 'Filter Pump' })).toBe(false);
  });

  it('matches free-text names or IDs, ignoring case and surrounding spaces', () => {
    const isExcluded = createExclusionMatcher({ excludedDeviceNames: ['  jet pump ', 'AUX-6', ''] });
    expect(isExcluded({ id: 'aux-4', name: 'Jet Pump' })).toBe(true);
    expect(isExcluded({ id: 'aux-6', name: 'Cleaner' })).toBe(true);
    expect(isExcluded({ id: 'aux-5', name: 'Bubblers' })).toBe(false);
  });

  it('ignores non-string entries from a hand-edited config', () => {
    const isExcluded = createExclusionMatcher({
      excludedDevices: [null, 5, 'swg'] as unknown as string[],
    });
    expect(isExcluded({ id: 'swg', name: 'Salt Water Chlorinator' })).toBe(true);
    expect(isExcluded({ id: 'pool-light', name: 'Pool Light' })).toBe(false);
  });
});

describe('MatterPublisher.remove', () => {
  function setup(matterEnabled = true) {
    const order: string[] = [];
    const registerPlatformAccessories = vi.fn(async () => {
      order.push('register');
    });
    const unregisterPlatformAccessories = vi.fn(async () => {
      order.push('unregister');
    });
    const api = {
      isMatterEnabled: () => matterEnabled,
      hap: { uuid: { generate: (value: string) => value } },
      matter: {
        deviceTypes: { TemperatureSensor: {}, Thermostat: {}, OnOffOutlet: {}, OnOffLight: {} },
        registerPlatformAccessories,
        unregisterPlatformAccessories,
      },
    } as unknown as API;
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() } as unknown as Logger;
    const publisher = new MatterPublisher(api, log, {
      setPower: vi.fn(),
      setTargetTemperature: vi.fn(),
      setCoolingTargetTemperature: vi.fn(),
      setThermostatMode: vi.fn(),
    });
    return { publisher, order, unregisterPlatformAccessories };
  }

  it('unregisters excluded accessories by UUID after registration settles', async () => {
    const { publisher, order, unregisterPlatformAccessories } = setup();
    publisher.publish([{ id: 'filter-pump', name: 'Filter Pump', kind: 'switch', available: true }]);
    await publisher.remove([
      { id: 'pool-heater', name: 'Pool Heater', kind: 'thermostat', available: true },
      { id: 'air-blower', name: 'Air Blower', kind: 'switch', available: true },
    ]);

    expect(order).toEqual(['register', 'unregister']);
    const [plugin, platform, accessories] = unregisterPlatformAccessories.mock.calls[0] as unknown as
      [string, string, MatterAccessory[]];
    expect([plugin, platform]).toEqual(['homebridge-iaqualink-matter', 'iAquaLink']);
    // Homebridge reads deviceType while unregistering, so it must be present.
    expect(accessories.map((accessory) => [accessory.UUID, accessory.deviceType !== undefined])).toEqual([
      ['iaqualink:matter:v7:pool-heater', true],
      ['iaqualink:matter:v7:air-blower', true],
    ]);
  });

  it('does nothing when Matter is not enabled', async () => {
    const { publisher, unregisterPlatformAccessories } = setup(false);
    publisher.publish([{ id: 'filter-pump', name: 'Filter Pump', kind: 'switch', available: true }]);
    await publisher.remove([{ id: 'pool-heater', name: 'Pool Heater', kind: 'thermostat', available: true }]);
    expect(unregisterPlatformAccessories).not.toHaveBeenCalled();
  });
});
