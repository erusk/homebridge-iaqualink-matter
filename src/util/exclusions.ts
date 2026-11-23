import type { EquipmentState, IAquaLinkConfig } from '../types.js';

type ExclusionConfig = Pick<IAquaLinkConfig, 'excludedDevices' | 'excludedDeviceNames'>;
type Device = Pick<EquipmentState, 'id' | 'name'>;

export interface ExclusionMatcher {
  isExcluded(item: Device): boolean;
  /**
   * Typed `excludedDeviceNames` entries that match none of the given devices,
   * as typed. Checklist entries are left out: checking equipment a system
   * doesn't have is harmless, while a typed entry that matches nothing is
   * likely a typo.
   */
  unmatched(equipment: Device[]): string[];
}

/**
 * Builds a matcher for equipment the user chose not to publish. Every entry,
 * from `excludedDevices` (IDs picked in the Homebridge UI) or
 * `excludedDeviceNames` (free text), matches a device ID case-insensitively.
 * Free text also matches the iAquaLink label of an aux circuit (`aux-*`), whose
 * ID depends on the slot it is wired to. Built-in equipment is matched by ID
 * only: its names are not unique (a heat-only heat pump is also reported as
 * "Pool Heater") and can change between polls.
 */
export function createExclusionMatcher(config: ExclusionConfig): ExclusionMatcher {
  const toEntries = (list: string[]) => list
    .map((entry) => ({ raw: entry.trim(), key: normalize(entry) }))
    .filter((entry) => entry.key);
  const typed = toEntries(stringList(config.excludedDeviceNames));
  const keys = new Set([...toEntries(stringList(config.excludedDevices)), ...typed].map((entry) => entry.key));
  const matches = (key: string, item: Device) => key === normalize(item.id)
    || (item.id.startsWith('aux-') && key === normalize(item.name));
  return {
    isExcluded: (item) => [...keys].some((key) => matches(key, item)),
    unmatched: (equipment) => [...new Map(typed.map((entry) => [entry.key, entry.raw])).entries()]
      .filter(([key]) => !equipment.some((item) => matches(key, item)))
      .map(([, raw]) => raw),
  };
}

// A hand-edited config may hold a single string, or something that is not a
// list at all; neither should stop the plugin from loading.
function stringList(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}
