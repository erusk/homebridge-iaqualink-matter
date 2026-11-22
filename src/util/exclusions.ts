import type { EquipmentState, IAquaLinkConfig } from '../types.js';

/**
 * Builds a matcher for equipment the user chose not to publish. Entries from
 * `excludedDevices` (equipment IDs picked in the Homebridge UI) and
 * `excludedDeviceNames` (free text, for aux circuits whose IDs depend on the
 * controller) are both compared, case-insensitively, against each device's
 * ID and its display name.
 */
export function createExclusionMatcher(
  config: Pick<IAquaLinkConfig, 'excludedDevices' | 'excludedDeviceNames'>,
): (item: Pick<EquipmentState, 'id' | 'name'>) => boolean {
  const entries = new Set(
    [...(config.excludedDevices ?? []), ...(config.excludedDeviceNames ?? [])]
      .filter((entry): entry is string => typeof entry === 'string')
      .map(normalize)
      .filter(Boolean),
  );
  return (item) => entries.size > 0 && (entries.has(normalize(item.id)) || entries.has(normalize(item.name)));
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}
