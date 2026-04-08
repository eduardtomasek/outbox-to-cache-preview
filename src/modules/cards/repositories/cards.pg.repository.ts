import { Inject, Injectable } from '@nestjs/common';
import * as pgp from 'pg-promise';
import { DB_PROVIDER_TOKEN } from '../../../libs/core/constants';

@Injectable()
export class CardsPgRepository {
    constructor(@Inject(DB_PROVIDER_TOKEN) private readonly db: pgp.IDatabase<any>) {}

    async updateStrength(cardUUID: string, newStrength: number) {
        const query = /* sql */ `
            BEGIN;
                -- Update the strength of the card
                UPDATE card_stats
                SET strength = $1
                WHERE card_uuid = $2
                RETURNING strength;

                -- Create outbox event for the update
                INSERT INTO outbox_events (aggregate_id, aggregate_type, event_type, payload, status)
                VALUES ($2, 'card', 'game.card.updated', json_build_object('cardUUID', $2, 'newStrength', $1), 'pending');

            COMMIT;
        `;

        return this.db.oneOrNone<{ strength: number }>(query, [newStrength, cardUUID]);
    }

    async updateDefense(cardUUID: string, newDefense: number) {
        const query = /* sql */ `
            BEGIN;
                -- Update the defense of the card
                UPDATE card_stats
                SET defense = $1
                WHERE card_uuid = $2
                RETURNING defense;

                -- Create outbox event for the update
                INSERT INTO outbox_events (aggregate_id, aggregate_type, event_type, payload, status)
                VALUES ($2, 'card', 'game.card.updated', json_build_object('cardUUID', $2, 'newDefense', $1), 'pending';

            COMMIT;
        `;

        return this.db.oneOrNone<{ defense: number }>(query, [newDefense, cardUUID]);
    }

    async putAllCardsIntoOutbox() {
        const query = /* sql */ `
            INSERT INTO outbox_events (aggregate_id, aggregate_type, event_type, payload, status)
            SELECT
                c.uuid AS aggregate_id,
                'card' AS aggregate_type,
                'game.card.updated' AS event_type,
                json_build_object(
                    'cardUUID', c.uuid
                ) AS payload,
                'pending' AS status
            FROM cards c
        `;

        await this.db.none(query);
    }
}
