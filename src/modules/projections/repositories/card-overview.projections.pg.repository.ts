import { Inject, Injectable } from '@nestjs/common';
import * as pgp from 'pg-promise';
import { DB_PROVIDER_TOKEN } from '../../../libs/core/constants';

@Injectable()
export class CardOverviewProjectionsPgRepository {
    constructor(@Inject(DB_PROVIDER_TOKEN) private readonly db: pgp.IDatabase<any>) {}

    async projectCardOverview(cardUUID: string) {
        const query = /* sql */ `
			INSERT INTO proj_card_overview (card_uuid, name, description, rarity_code, type_code, strength, defense, tags)
			SELECT
				c.uuid,
				c.name,
				c.description,
				r.code  AS rarity_code,
				t.code  AS type_code,
				cs.strength,
				cs.defense,
				COALESCE(
					ARRAY(
						SELECT td.slug
						FROM card_tags ct
						JOIN tag_definitions td ON td.id = ct.tag_id
						WHERE ct.card_uuid = c.uuid
						ORDER BY td.slug
					),
					'{}'
				) AS tags
			FROM cards c
			JOIN card_rarities r  ON r.id  = c.rarity_id
			JOIN card_types    t  ON t.id  = c.type_id
			JOIN card_stats    cs ON cs.card_uuid = c.uuid
			WHERE c.uuid = $1
			ON CONFLICT (card_uuid) DO UPDATE
			SET
				name         = EXCLUDED.name,
				description  = EXCLUDED.description,
				rarity_code  = EXCLUDED.rarity_code,
				type_code    = EXCLUDED.type_code,
				strength     = EXCLUDED.strength,
				defense      = EXCLUDED.defense,
				tags         = EXCLUDED.tags,
				updated_at   = NOW();
		`;

        await this.db.none(query, [cardUUID]);
    }
}
