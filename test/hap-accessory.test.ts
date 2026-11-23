import { Accessory, Characteristic, Service, uuid } from '@homebridge/hap-nodejs';
import type { PlatformAccessory } from 'homebridge';
import { describe, expect, it, vi } from 'vitest';
import { HapEquipmentAccessory } from '../src/accessories/hap-accessory.js';
import type { IAquaLinkPlatform } from '../src/platform.js';
import type { EquipmentState } from '../src/types.js';

const programs = ['Alpine White', 'Sky Blue', 'Caribbean Blue'];
const poolLight: EquipmentState = {
  id: 'pool-light', name: 'Pool Light', kind: 'light', available: true, on: false, lightPrograms: programs,
};

function cachedLightAccessory(programSwitches: string[]): PlatformAccessory {
  // A hap-nodejs Accessory has the service API the handler uses; the context
  // stands in for what Homebridge restores from its cache.
  const accessory = new Accessory('Pool Light', uuid.generate('iaqualink:pool-light')) as unknown as PlatformAccessory;
  accessory.context = { lightUiVersion: 2 };
  accessory.addService(Service.Lightbulb, 'Light');
  for (const program of programSwitches) accessory.addService(Service.Switch, program, `program:${program}`);
  return accessory;
}

function platform(exposeLightShows: boolean | undefined): IAquaLinkPlatform {
  return {
    Service,
    Characteristic,
    config: { exposeLightShows },
    api: { isMatterEnabled: () => false },
    log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
  } as unknown as IAquaLinkPlatform;
}

const programSwitches = (accessory: PlatformAccessory) => accessory.services
  .filter((service) => service.UUID === Service.Switch.UUID)
  .map((service) => service.subtype)
  .sort();

describe('HapEquipmentAccessory light program switches', () => {
  it('removes cached program switches when light shows are turned off', () => {
    const accessory = cachedLightAccessory(programs);
    new HapEquipmentAccessory(platform(false), accessory, poolLight);
    expect(programSwitches(accessory)).toEqual([]);
    expect(accessory.getService(Service.Lightbulb)).toBeDefined();
  });

  it('adds a switch per program when light shows are on, and drops programs no longer listed', () => {
    const accessory = cachedLightAccessory(['Alpine White', 'Retired Show']);
    new HapEquipmentAccessory(platform(undefined), accessory, poolLight);
    expect(programSwitches(accessory)).toEqual(programs.map((program) => `program:${program}`).sort());
  });
});
