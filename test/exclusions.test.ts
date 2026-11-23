import type { API, Logger, MatterAccessory } from 'homebridge';
import { describe, expect, it, vi } from 'vitest';
import { MatterPublisher } from '../src/matter/matter-publisher.js';
import type { EquipmentState } from '../src/types.js';
import { createExclusionMatcher } from '../src/util/exclusions.js';

describe('createExclusionMatcher', () => {
  it('excludes nothing when no exclusions are configured', () => {
    const { isExcluded } = createExclusionMatcher({});
    expect(isExcluded({ id: 'pool-heater', name: 'Pool Heater' })).toBe(false);
  });

  it('matches configured equipment IDs', () => {
    const { isExcluded } = createExclusionMatcher({ excludedDevices: ['pool-heater', 'spa-heater'] });
    expect(isExcluded({ id: 'pool-heater', name: 'Pool Heater' })).toBe(true);
    expect(isExcluded({ id: 'spa-heater', name: 'Spa Heater' })).toBe(true);
    expect(isExcluded({ id: 'filter-pump', name: 'Filter Pump' })).toBe(false);
  });

  it('matches aux circuit names or any ID, ignoring case and surrounding spaces', () => {
    const { isExcluded } = createExclusionMatcher({ excludedDeviceNames: ['  jet pump ', 'AUX-6', 'FILTER-PUMP', ''] });
    expect(isExcluded({ id: 'aux-4', name: 'Jet Pump' })).toBe(true);
    expect(isExcluded({ id: 'aux-6', name: 'Cleaner' })).toBe(true);
    expect(isExcluded({ id: 'filter-pump', name: 'Filter Pump' })).toBe(true);
    expect(isExcluded({ id: 'aux-5', name: 'Bubblers' })).toBe(false);
  });

  it('does not match built-in equipment by name, which is not unique', () => {
    // A heat-only heat pump is reported as "Pool Heater", the same name as the
    // real pool heater, so a name entry would hide both.
    const { isExcluded } = createExclusionMatcher({ excludedDeviceNames: ['Pool Heater'] });
    expect(isExcluded({ id: 'pool-heater', name: 'Pool Heater' })).toBe(false);
    expect(isExcluded({ id: 'heat-pump', name: 'Pool Heater' })).toBe(false);
  });

  it('reports entries that match no device, as typed', () => {
    const matcher = createExclusionMatcher({
      excludedDevices: ['spa-heater'],
      excludedDeviceNames: [' Pool Heater ', 'cleaner', 'Cleaner'],
    });
    const devices = [
      { id: 'pool-heater', name: 'Pool Heater' },
      { id: 'aux-1', name: 'Cleaner' },
    ] as const;
    expect(matcher.unmatched([...devices])).toEqual(['spa-heater', 'Pool Heater']);
  });

  it('accepts a single string and ignores values that are not lists', () => {
    expect(() => createExclusionMatcher({ excludedDevices: {} as unknown as string[] })).not.toThrow();
    const { isExcluded } = createExclusionMatcher({
      excludedDevices: [null, 5, 'swg'] as unknown as string[],
      excludedDeviceNames: 'Cleaner' as unknown as string[],
    });
    expect(isExcluded({ id: 'swg', name: 'Salt Water Chlorinator' })).toBe(true);
    expect(isExcluded({ id: 'aux-1', name: 'Cleaner' })).toBe(true);
    expect(isExcluded({ id: 'pool-light', name: 'Pool Light' })).toBe(false);
  });
});

describe('MatterPublisher hidden-device removal', () => {
  const filterPump: EquipmentState = { id: 'filter-pump', name: 'Filter Pump', kind: 'switch', available: true };
  const poolHeater: EquipmentState = { id: 'pool-heater', name: 'Pool Heater', kind: 'thermostat', available: true };
  const airBlower: EquipmentState = { id: 'air-blower', name: 'Air Blower', kind: 'switch', available: true };

  function setup({ matterEnabled = true, cached = [] as string[], removalTimeoutMs = 1_000 } = {}) {
    const order: string[] = [];
    const present = new Set(cached.map((id) => `iaqualink:matter:v7:${id}`));
    const registerPlatformAccessories = vi.fn(async () => {
      order.push('register');
    });
    // Like Homebridge, resolve before the accessories are actually gone.
    const unregisterPlatformAccessories = vi.fn(async (_plugin: string, _platform: string, accessories: MatterAccessory[]) => {
      order.push('unregister');
      setTimeout(() => {
        for (const accessory of accessories) present.delete(accessory.UUID);
        order.push('closed');
      }, 150);
    });
    const getAccessoryState = vi.fn(async (uuid: string) => (present.has(uuid) ? { reachable: true } : undefined));
    const api = {
      isMatterEnabled: () => matterEnabled,
      hap: { uuid: { generate: (value: string) => value } },
      matter: {
        deviceTypes: { TemperatureSensor: {}, Thermostat: {}, OnOffOutlet: {}, OnOffLight: {} },
        registerPlatformAccessories,
        unregisterPlatformAccessories,
        getAccessoryState,
        updateAccessoryState: vi.fn(),
      },
    } as unknown as API;
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() } as unknown as Logger;
    const publisher = new MatterPublisher(api, log, {
      setPower: vi.fn(),
      setTargetTemperature: vi.fn(),
      setCoolingTargetTemperature: vi.fn(),
      setThermostatMode: vi.fn(),
    }, removalTimeoutMs);
    return { publisher, order, unregisterPlatformAccessories, registerPlatformAccessories, log };
  }

  it('removes cached hidden devices and waits until they are closed before registering', async () => {
    const { publisher, order, unregisterPlatformAccessories, log } = setup({ cached: ['pool-heater', 'air-blower'] });
    publisher.publish([filterPump], [poolHeater, airBlower]);
    await publisher.update([]);

    expect(order).toEqual(['unregister', 'closed', 'register']);
    const [plugin, platform, accessories] = unregisterPlatformAccessories.mock.calls[0]!;
    expect([plugin, platform]).toEqual(['homebridge-iaqualink-matter', 'iAquaLink']);
    // Homebridge reads deviceType while unregistering, so it must be present.
    expect(accessories.map((accessory) => [accessory.UUID, accessory.deviceType !== undefined])).toEqual([
      ['iaqualink:matter:v7:pool-heater', true],
      ['iaqualink:matter:v7:air-blower', true],
    ]);
    expect(log.info).toHaveBeenCalledWith('Removed hidden Matter accessories: Pool Heater, Air Blower');
  });

  it('skips the unregister call for hidden devices that are not cached', async () => {
    const { publisher, order, unregisterPlatformAccessories } = setup({ cached: ['air-blower'] });
    publisher.publish([filterPump], [poolHeater, airBlower]);
    await publisher.update([]);
    expect(unregisterPlatformAccessories).toHaveBeenCalledTimes(1);
    expect(unregisterPlatformAccessories.mock.calls[0]![2].map((accessory) => accessory.UUID))
      .toEqual(['iaqualink:matter:v7:air-blower']);
    expect(order).toEqual(['unregister', 'closed', 'register']);

    const second = setup();
    second.publisher.publish([filterPump], [poolHeater]);
    await second.publisher.update([]);
    expect(second.unregisterPlatformAccessories).not.toHaveBeenCalled();
    expect(second.order).toEqual(['register']);
  });

  it('still registers if removal does not finish in time', async () => {
    const { publisher, order } = setup({ cached: ['pool-heater'], removalTimeoutMs: 50 });
    publisher.publish([filterPump], [poolHeater]);
    await publisher.update([]);
    expect(order).toEqual(['unregister', 'register']);
  });

  it('does nothing when Matter is not enabled', async () => {
    const { publisher, unregisterPlatformAccessories, registerPlatformAccessories } = setup({
      matterEnabled: false,
      cached: ['pool-heater'],
    });
    publisher.publish([filterPump], [poolHeater]);
    await publisher.update([]);
    expect(unregisterPlatformAccessories).not.toHaveBeenCalled();
    expect(registerPlatformAccessories).not.toHaveBeenCalled();
  });
});
