/** Where one profile's learning data lives, next to `profile:<id>` in the same store. */
export const queueKey = (profileId: string) => `learn-queue:${profileId}`;
export const pendingKey = (profileId: string) => `learn-pending:${profileId}`;
export const skippedKey = (profileId: string) => `learn-skipped:${profileId}`;
export const learningKeys = (profileId: string) => [queueKey(profileId), pendingKey(profileId), skippedKey(profileId)];
