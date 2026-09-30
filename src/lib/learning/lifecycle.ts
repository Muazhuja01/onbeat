/**
 * A batch can still be in flight when its profile's learning data is thrown away (the
 * profile is deleted, or learning is turned off). These markers stop the queue and
 * suggestion list opened before that from writing the data back when the batch lands.
 */
const queueEpochs = new Map<string, number>();
const deleted = new Set<string>();

export const queueEpoch = (profileId: string) => queueEpochs.get(profileId) ?? 0;

/** The profile's queued lines were thrown away; queues opened before this stop saving. */
export function retireQueue(profileId: string): void {
  queueEpochs.set(profileId, queueEpoch(profileId) + 1);
}

/** The profile was deleted: nothing of its learning data is saved again. */
export function retireProfile(profileId: string): void {
  retireQueue(profileId);
  deleted.add(profileId);
}

export const isDeleted = (profileId: string) => deleted.has(profileId);
