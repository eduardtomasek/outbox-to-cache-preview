import { Inject, Injectable } from '@nestjs/common';
import * as pgp from 'pg-promise';
import { DB_PROVIDER_TOKEN } from '../../../libs/core/constants';
import { OutboxEvent } from '../interfaces/outbox-event.interface';

@Injectable()
export class OutboxEventsPgRepository {
    constructor(@Inject(DB_PROVIDER_TOKEN) private readonly db: pgp.IDatabase<any>) {}

    async fetchAndLockPendingEvents(batchSize = 10) {
        return this.db.tx<OutboxEvent[]>(async (t: pgp.IDatabase<any>) => {
            const events = await t.query<OutboxEvent[]>(
                /* sql */ `
				SELECT
					id,
					aggregate_type as "aggregateType",
					aggregate_id as "aggregateId",
					event_type as "eventType",
					payload,
					status,
					retry_count as "retryCount",
					created_at as "createdAt",
					sent_at as "sentAt"
				FROM outbox_events
				WHERE status = 'pending'
				ORDER BY created_at ASC
				LIMIT $1
				FOR UPDATE SKIP LOCKED
			`,
                [batchSize],
            );

            if (events.length === 0) {
                return [];
            }

            const ids = events.map((e) => e.id);

            await t.none(
                /* sql */ `
					UPDATE outbox_events
					SET status = 'sent', sent_at = NOW()
					WHERE id IN ($1:csv)
				`,
                [ids],
            );

            return events;
        });
    }

    async setEventSent(eventId: number) {
        const query = /* sql */ `
			UPDATE outbox_events
			SET status = 'sent', sent_at = NOW()
			WHERE id = $1
		`;
        await this.db.none(query, [eventId]);
    }

    async setEventFailed(eventId: number) {
        const query = /* sql */ `
			UPDATE outbox_events
			SET status = 'failed'
			WHERE id = $1
		`;
        await this.db.none(query, [eventId]);
    }

    async incrementRetryCount(eventId: number) {
        const query = /* sql */ `
			UPDATE outbox_events
			SET retry_count = retry_count + 1
			WHERE id = $1
		`;
        await this.db.none(query, [eventId]);
    }

    async resetStatusToPending(eventId: number) {
        const query = /* sql */ `
			UPDATE outbox_events
			SET status = 'pending', sent_at = NULL
			WHERE id = $1
		`;
        await this.db.none(query, [eventId]);
    }
}
