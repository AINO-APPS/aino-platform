import type { Query, VersionRepository } from "./clientVersions.types";

export function createClientVersionRepository(masterQuery: Query): VersionRepository {
    return {
        async record(identity, observation, session) {
            const writes = [masterQuery(
                `INSERT INTO client_version_observations (identity_key, client, version, last_seen_at)
                 VALUES ($1, $2, $3, NOW())
                 ON CONFLICT (identity_key, client, version)
                 DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at`,
                [identity, observation.client, observation.version],
            )];
            if (session) writes.push(session.query(
                `UPDATE user_sessions SET observed_client_class = $3, client_version = $4,
                     client_version_seen_at = NOW(), last_activity_at = NOW()
                 WHERE id = $1 AND user_id = $2`,
                [session.sid, session.userId, observation.client, observation.version],
            ));
            await Promise.all(writes);
        },
        async report() {
            const result = await masterQuery(
                `SELECT client, version, COUNT(DISTINCT identity_key)::integer AS users
                 FROM client_version_observations WHERE last_seen_at >= NOW() - INTERVAL '30 days'
                 GROUP BY client, version ORDER BY client, version`,
            );
            return result.rows;
        },
    };
}
