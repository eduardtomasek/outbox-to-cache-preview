import { Inject, Injectable } from '@nestjs/common';
import * as pgp from 'pg-promise';
import { DB_PROVIDER_TOKEN } from '../../../libs/core/constants';
import { CardOverview } from '../interfaces/card-overview.interface';

@Injectable()
export class ProjectionsCardsPgRepository {
    constructor(@Inject(DB_PROVIDER_TOKEN) private readonly db: pgp.IDatabase<any>) {}

    /**
	 *
	 * CREATE TABLE IF NOT EXISTS proj_card_overview (
			card_uuid       UUID        PRIMARY KEY,
			name            TEXT        NOT NULL,
			description     TEXT,
			rarity_code     TEXT        NOT NULL,
			type_code       TEXT        NOT NULL,
			strength        INT         NOT NULL,
			defense         INT         NOT NULL,
			tags            TEXT[]      NOT NULL DEFAULT '{}',  -- denormalised for fast reads
			primary_image   TEXT,
			updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
	 *
	 * @param cardUUID {string} cardUUID
	 */
    async findCardOverviewByUUID(cardUUID: string): Promise<CardOverview | null> {
        const query = /* sql */ `
			SELECT
				card_uuid AS "cardUUID",
				name,
				description,
				rarity_code AS "rarityCode",
				type_code AS "typeCode",
				strength,
				defense,
				tags,
				primary_image AS "primaryImage",
				updated_at AS "updatedAt"
			FROM proj_card_overview
			WHERE card_uuid = $1
		`;
        return this.db.oneOrNone<CardOverview>(query, [cardUUID]);
    }
}
