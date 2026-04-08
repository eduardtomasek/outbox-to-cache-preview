-- =============================================================
-- EventCascade – Bootstrap DDL + Seed Data (IDEMPOTENT)
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- Extensions
-- -------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -------------------------------------------------------------
-- Dictionary tables
-- -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS card_rarities (
    id      SMALLINT PRIMARY KEY,
    code    TEXT NOT NULL UNIQUE,   -- COMMON, RARE, EPIC, LEGENDARY
    label   TEXT NOT NULL
);

INSERT INTO card_rarities (id, code, label) VALUES
    (1, 'COMMON',    'Common'),
    (2, 'RARE',      'Rare'),
    (3, 'EPIC',      'Epic'),
    (4, 'LEGENDARY', 'Legendary')
ON CONFLICT (id) DO UPDATE
SET
    code  = EXCLUDED.code,
    label = EXCLUDED.label;


CREATE TABLE IF NOT EXISTS card_types (
    id      SMALLINT PRIMARY KEY,
    code    TEXT NOT NULL UNIQUE,   -- CREATURE, SPELL, TRAP, ARTIFACT
    label   TEXT NOT NULL
);

INSERT INTO card_types (id, code, label) VALUES
    (1, 'CREATURE',  'Creature'),
    (2, 'SPELL',     'Spell'),
    (3, 'TRAP',      'Trap'),
    (4, 'ARTIFACT',  'Artifact')
ON CONFLICT (id) DO UPDATE
SET
    code  = EXCLUDED.code,
    label = EXCLUDED.label;


CREATE TABLE IF NOT EXISTS tag_definitions (
    id      SMALLINT PRIMARY KEY,
    slug    TEXT NOT NULL UNIQUE,   -- fire, undead, dragon …
    label   TEXT NOT NULL
);

INSERT INTO tag_definitions (id, slug, label) VALUES
    (1,  'fire',     'Fire'),
    (2,  'water',    'Water'),
    (3,  'earth',    'Earth'),
    (4,  'wind',     'Wind'),
    (5,  'undead',   'Undead'),
    (6,  'dragon',   'Dragon'),
    (7,  'beast',    'Beast'),
    (8,  'human',    'Human'),
    (9,  'shadow',   'Shadow'),
    (10, 'holy',     'Holy'),
    (11, 'poison',   'Poison'),
    (12, 'electric', 'Electric')
ON CONFLICT (id) DO UPDATE
SET
    slug  = EXCLUDED.slug,
    label = EXCLUDED.label;

-- -------------------------------------------------------------
-- Core tables
-- -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
    uuid        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT        NOT NULL,
    username    TEXT        NOT NULL UNIQUE,
    email       TEXT        NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cards (
    uuid        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT        NOT NULL,
    description TEXT,
    rarity_id   SMALLINT    NOT NULL REFERENCES card_rarities(id),
    type_id     SMALLINT    NOT NULL REFERENCES card_types(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- strength + defense stored as typed columns (not EAV) for simplicity;
-- the generic card_attributes table remains for future extensibility
CREATE TABLE IF NOT EXISTS card_stats (
    card_uuid   UUID        PRIMARY KEY REFERENCES cards(uuid) ON DELETE CASCADE,
    strength    INT         NOT NULL CHECK (strength BETWEEN 0 AND 100),
    defense     INT         NOT NULL CHECK (defense BETWEEN 0 AND 100),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS card_images (
    uuid        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    card_uuid   UUID        NOT NULL REFERENCES cards(uuid) ON DELETE CASCADE,
    url         TEXT        NOT NULL,
    is_primary  BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- tag_id FK into tag_definitions keeps tags consistent
CREATE TABLE IF NOT EXISTS card_tags (
    card_uuid   UUID        NOT NULL REFERENCES cards(uuid) ON DELETE CASCADE,
    tag_id      SMALLINT    NOT NULL REFERENCES tag_definitions(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (card_uuid, tag_id)
);

-- generic EAV for future extra attributes (mana cost, speed, …)
CREATE TABLE IF NOT EXISTS card_attributes (
    uuid        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    card_uuid   UUID        NOT NULL REFERENCES cards(uuid) ON DELETE CASCADE,
    key         TEXT        NOT NULL,
    value       INT         NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (card_uuid, key)
);

CREATE TABLE IF NOT EXISTS decks (
    uuid        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deck_cards (
    deck_uuid   UUID        NOT NULL REFERENCES decks(uuid) ON DELETE CASCADE,
    card_uuid   UUID        NOT NULL REFERENCES cards(uuid) ON DELETE CASCADE,
    position    SMALLINT,                    -- optional ordering within deck
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (deck_uuid, card_uuid)
);

CREATE TABLE IF NOT EXISTS deck_users (
    deck_uuid   UUID        NOT NULL REFERENCES decks(uuid) ON DELETE CASCADE,
    user_uuid   UUID        NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
    role        TEXT        NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'viewer', 'editor')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (deck_uuid, user_uuid)
);

-- -------------------------------------------------------------
-- Outbox (event sourcing / reliable messaging)
-- -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS outbox_events (
    id              BIGSERIAL   PRIMARY KEY,
    aggregate_type  TEXT        NOT NULL,   -- 'card', 'deck', 'user'
    aggregate_id    UUID        NOT NULL,
    event_type      TEXT        NOT NULL,   -- 'CardCreated', 'DeckUpdated' …
    payload         JSONB       NOT NULL DEFAULT '{}',
    status          TEXT        NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending', 'sent', 'failed')),
    retry_count     SMALLINT    NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending
    ON outbox_events (status, created_at)
    WHERE status = 'pending';

-- -------------------------------------------------------------
-- Projections layer (read-optimised, rebuilt from events)
-- -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS proj_card_overview (
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

-- =============================================================
-- SEED DATA
-- =============================================================

-- -------------------------------------------------------------
-- Users (10)
-- -------------------------------------------------------------
INSERT INTO users (uuid, name, username, email) VALUES
    ('a1000000-0000-0000-0000-000000000001', 'Alice Novák',     'alice', 'alice@example.com'),
    ('a1000000-0000-0000-0000-000000000002', 'Bob Dvořák',      'bob',   'bob@example.com'),
    ('a1000000-0000-0000-0000-000000000003', 'Carol Horáčková', 'carol', 'carol@example.com'),
    ('a1000000-0000-0000-0000-000000000004', 'David Procházka', 'david', 'david@example.com'),
    ('a1000000-0000-0000-0000-000000000005', 'Eva Kučerová',    'eva',   'eva@example.com'),
    ('a1000000-0000-0000-0000-000000000006', 'Filip Kratochvíl','filip', 'filip@example.com'),
    ('a1000000-0000-0000-0000-000000000007', 'Gabriela Šimková','gabi',  'gabi@example.com'),
    ('a1000000-0000-0000-0000-000000000008', 'Honza Blažek',    'honza', 'honza@example.com'),
    ('a1000000-0000-0000-0000-000000000009', 'Iva Marková',     'iva',   'iva@example.com'),
    ('a1000000-0000-0000-0000-000000000010', 'Jan Pospíšil',    'janp',  'janp@example.com')
ON CONFLICT (uuid) DO UPDATE
SET
    name       = EXCLUDED.name,
    username   = EXCLUDED.username,
    email      = EXCLUDED.email,
    updated_at = NOW();

-- -------------------------------------------------------------
-- Cards (30) — fixed UUIDs so FKs below are predictable
-- -------------------------------------------------------------
INSERT INTO cards (uuid, name, description, rarity_id, type_id) VALUES
('c0000000-0000-0000-0000-000000000001', 'Iron Golem',       'A lumbering construct forged in arcane fire.',              1, 1),
('c0000000-0000-0000-0000-000000000002', 'Shadow Wolf',      'Hunts in packs under moonless skies.',                      1, 1),
('c0000000-0000-0000-0000-000000000003', 'River Serpent',    'Lurks beneath calm waters waiting to strike.',              1, 1),
('c0000000-0000-0000-0000-000000000004', 'Stone Turtle',     'Its shell has weathered centuries of battle.',              2, 1),
('c0000000-0000-0000-0000-000000000005', 'Ember Phoenix',    'Reborn from its own ashes stronger each time.',            2, 1),
('c0000000-0000-0000-0000-000000000006', 'Plague Rat',       'One bite spreads an incurable rot.',                       1, 1),
('c0000000-0000-0000-0000-000000000007', 'Storm Eagle',      'Its wings conjure lightning with every beat.',             2, 1),
('c0000000-0000-0000-0000-000000000008', 'Bone Archer',      'Undead marksman whose arrows never miss.',                 2, 1),
('c0000000-0000-0000-0000-000000000009', 'Forest Guardian',  'Ancient spirit bound to protect the sacred grove.',        3, 1),
('c0000000-0000-0000-0000-000000000010', 'Frost Drake',      'Young dragon with a breath cold enough to shatter steel.', 3, 1),
('c0000000-0000-0000-0000-000000000011', 'Sand Crawler',     'Nearly invisible beneath desert dunes.',                   1, 1),
('c0000000-0000-0000-0000-000000000012', 'Lava Titan',       'Born from volcanic rock, immune to fire.',                 4, 1),
('c0000000-0000-0000-0000-000000000013', 'Fireball',         'Launches a concentrated sphere of arcane flame.',          1, 2),
('c0000000-0000-0000-0000-000000000014', 'Chain Lightning',  'Jumps between up to three targets.',                       2, 2),
('c0000000-0000-0000-0000-000000000015', 'Healing Wave',     'Restores vitality to all allies in range.',                1, 2),
('c0000000-0000-0000-0000-000000000016', 'Shadow Step',      'Teleports the caster behind an unsuspecting target.',     2, 2),
('c0000000-0000-0000-0000-000000000017', 'Earthquake',       'Splits the ground open beneath enemy feet.',              3, 2),
('c0000000-0000-0000-0000-000000000018', 'Arcane Surge',     'Amplifies the next spell cast threefold.',                3, 2),
('c0000000-0000-0000-0000-000000000019', 'Blizzard',         'Blankets the battlefield in freezing snow.',              4, 2),
('c0000000-0000-0000-0000-000000000020', 'Divine Light',     'Smites undead and heals allies simultaneously.',          4, 2),
('c0000000-0000-0000-0000-000000000021', 'Spike Pit',        'Concealed hole lined with sharpened stakes.',             1, 3),
('c0000000-0000-0000-0000-000000000022', 'Poison Cloud',     'Releases toxic spores when triggered.',                   2, 3),
('c0000000-0000-0000-0000-000000000023', 'Mirror Image',     'Reflects the next attack back at the attacker.',          3, 3),
('c0000000-0000-0000-0000-000000000024', 'Void Rift',        'Opens a tear in space that swallows one target.',         4, 3),
('c0000000-0000-0000-0000-000000000025', 'Cursed Amulet',    'Grants power at the cost of sanity.',                     2, 4),
('c0000000-0000-0000-0000-000000000026', 'Runestone Shard',  'Fragment of an ancient ward, still radiating power.',     1, 4),
('c0000000-0000-0000-0000-000000000027', 'Warlord Helm',     'Worn by a general who never lost a battle.',              3, 4),
('c0000000-0000-0000-0000-000000000028', 'Soul Lantern',     'Traps the spirit of a slain foe.',                        3, 4),
('c0000000-0000-0000-0000-000000000029', 'Obsidian Shield',  'Absorbs magical damage and stores it for later.',         4, 4),
('c0000000-0000-0000-0000-000000000030', 'Eternity Compass', 'Points not to north, but to the nearest danger.',         4, 4)
ON CONFLICT (uuid) DO UPDATE
SET
    name        = EXCLUDED.name,
    description = EXCLUDED.description,
    rarity_id   = EXCLUDED.rarity_id,
    type_id     = EXCLUDED.type_id,
    updated_at  = NOW();

-- -------------------------------------------------------------
-- Card stats (strength / defense)
-- -------------------------------------------------------------
INSERT INTO card_stats (card_uuid, strength, defense) VALUES
('c0000000-0000-0000-0000-000000000001', 30, 70),
('c0000000-0000-0000-0000-000000000002', 55, 35),
('c0000000-0000-0000-0000-000000000003', 50, 40),
('c0000000-0000-0000-0000-000000000004', 20, 90),
('c0000000-0000-0000-0000-000000000005', 65, 45),
('c0000000-0000-0000-0000-000000000006', 40, 25),
('c0000000-0000-0000-0000-000000000007', 60, 50),
('c0000000-0000-0000-0000-000000000008', 55, 30),
('c0000000-0000-0000-0000-000000000009', 45, 75),
('c0000000-0000-0000-0000-000000000010', 70, 55),
('c0000000-0000-0000-0000-000000000011', 35, 30),
('c0000000-0000-0000-0000-000000000012', 85, 80),
('c0000000-0000-0000-0000-000000000013', 75,  5),
('c0000000-0000-0000-0000-000000000014', 70, 10),
('c0000000-0000-0000-0000-000000000015', 10, 20),
('c0000000-0000-0000-0000-000000000016', 60, 15),
('c0000000-0000-0000-0000-000000000017', 80, 10),
('c0000000-0000-0000-0000-000000000018', 65, 10),
('c0000000-0000-0000-0000-000000000019', 90, 15),
('c0000000-0000-0000-0000-000000000020', 70, 20),
('c0000000-0000-0000-0000-000000000021', 45, 10),
('c0000000-0000-0000-0000-000000000022', 55, 10),
('c0000000-0000-0000-0000-000000000023', 50, 50),
('c0000000-0000-0000-0000-000000000024', 95,  5),
('c0000000-0000-0000-0000-000000000025', 40, 30),
('c0000000-0000-0000-0000-000000000026', 20, 40),
('c0000000-0000-0000-0000-000000000027', 50, 60),
('c0000000-0000-0000-0000-000000000028', 35, 35),
('c0000000-0000-0000-0000-000000000029', 15, 95),
('c0000000-0000-0000-0000-000000000030', 25, 50)
ON CONFLICT (card_uuid) DO UPDATE
SET
    strength   = EXCLUDED.strength,
    defense    = EXCLUDED.defense,
    updated_at = NOW();

-- -------------------------------------------------------------
-- Card tags  (tag_id references tag_definitions)
-- -------------------------------------------------------------
INSERT INTO card_tags (card_uuid, tag_id) VALUES
('c0000000-0000-0000-0000-000000000001', 3),
('c0000000-0000-0000-0000-000000000002', 9),
('c0000000-0000-0000-0000-000000000002', 7),
('c0000000-0000-0000-0000-000000000003', 2),
('c0000000-0000-0000-0000-000000000003', 7),
('c0000000-0000-0000-0000-000000000004', 3),
('c0000000-0000-0000-0000-000000000004', 7),
('c0000000-0000-0000-0000-000000000005', 1),
('c0000000-0000-0000-0000-000000000005', 7),
('c0000000-0000-0000-0000-000000000006', 11),
('c0000000-0000-0000-0000-000000000006', 7),
('c0000000-0000-0000-0000-000000000007', 12),
('c0000000-0000-0000-0000-000000000007', 4),
('c0000000-0000-0000-0000-000000000007', 7),
('c0000000-0000-0000-0000-000000000008', 5),
('c0000000-0000-0000-0000-000000000008', 9),
('c0000000-0000-0000-0000-000000000009', 3),
('c0000000-0000-0000-0000-000000000009', 10),
('c0000000-0000-0000-0000-000000000010', 6),
('c0000000-0000-0000-0000-000000000010', 2),
('c0000000-0000-0000-0000-000000000011', 3),
('c0000000-0000-0000-0000-000000000011', 7),
('c0000000-0000-0000-0000-000000000012', 1),
('c0000000-0000-0000-0000-000000000012', 3),
('c0000000-0000-0000-0000-000000000013', 1),
('c0000000-0000-0000-0000-000000000014', 12),
('c0000000-0000-0000-0000-000000000015', 10),
('c0000000-0000-0000-0000-000000000015', 2),
('c0000000-0000-0000-0000-000000000016', 9),
('c0000000-0000-0000-0000-000000000017', 3),
('c0000000-0000-0000-0000-000000000019', 2),
('c0000000-0000-0000-0000-000000000019', 4),
('c0000000-0000-0000-0000-000000000020', 10),
('c0000000-0000-0000-0000-000000000021', 3),
('c0000000-0000-0000-0000-000000000022', 11),
('c0000000-0000-0000-0000-000000000022', 4),
('c0000000-0000-0000-0000-000000000023', 9),
('c0000000-0000-0000-0000-000000000024', 9),
('c0000000-0000-0000-0000-000000000025', 9),
('c0000000-0000-0000-0000-000000000025', 11),
('c0000000-0000-0000-0000-000000000026', 3),
('c0000000-0000-0000-0000-000000000027', 8),
('c0000000-0000-0000-0000-000000000028', 5),
('c0000000-0000-0000-0000-000000000028', 9),
('c0000000-0000-0000-0000-000000000029', 3),
('c0000000-0000-0000-0000-000000000029', 10),
('c0000000-0000-0000-0000-000000000030', 9)
ON CONFLICT (card_uuid, tag_id) DO NOTHING;

-- -------------------------------------------------------------
-- Decks (5)
-- -------------------------------------------------------------
INSERT INTO decks (uuid, name) VALUES
    ('d0000000-0000-0000-0000-000000000001', 'Starter Fire Deck'),
    ('d0000000-0000-0000-0000-000000000002', 'Shadow & Undead'),
    ('d0000000-0000-0000-0000-000000000003', 'Nature Fortress'),
    ('d0000000-0000-0000-0000-000000000004', 'Arcane Storm'),
    ('d0000000-0000-0000-0000-000000000005', 'Mixed Legends')
ON CONFLICT (uuid) DO UPDATE
SET
    name       = EXCLUDED.name,
    updated_at = NOW();

-- Deck 1 – fire theme
INSERT INTO deck_cards (deck_uuid, card_uuid, position) VALUES
    ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000005', 1),
    ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000012', 2),
    ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000013', 3),
    ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000018', 4)
ON CONFLICT (deck_uuid, card_uuid) DO UPDATE
SET position = EXCLUDED.position;

-- Deck 2 – shadow/undead
INSERT INTO deck_cards (deck_uuid, card_uuid, position) VALUES
    ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 1),
    ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000008', 2),
    ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000016', 3),
    ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000023', 4),
    ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000024', 5),
    ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000028', 6)
ON CONFLICT (deck_uuid, card_uuid) DO UPDATE
SET position = EXCLUDED.position;

-- Deck 3 – nature/earth
INSERT INTO deck_cards (deck_uuid, card_uuid, position) VALUES
    ('d0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001', 1),
    ('d0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000004', 2),
    ('d0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000009', 3),
    ('d0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000017', 4),
    ('d0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000029', 5)
ON CONFLICT (deck_uuid, card_uuid) DO UPDATE
SET position = EXCLUDED.position;

-- Deck 4 – arcane storm
INSERT INTO deck_cards (deck_uuid, card_uuid, position) VALUES
    ('d0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000007', 1),
    ('d0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000014', 2),
    ('d0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000018', 3),
    ('d0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000019', 4)
ON CONFLICT (deck_uuid, card_uuid) DO UPDATE
SET position = EXCLUDED.position;

-- Deck 5 – legendary mix
INSERT INTO deck_cards (deck_uuid, card_uuid, position) VALUES
    ('d0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000012', 1),
    ('d0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000019', 2),
    ('d0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000020', 3),
    ('d0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000024', 4),
    ('d0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000029', 5),
    ('d0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000030', 6)
ON CONFLICT (deck_uuid, card_uuid) DO UPDATE
SET position = EXCLUDED.position;

-- -------------------------------------------------------------
-- Deck ownership
-- -------------------------------------------------------------
INSERT INTO deck_users (deck_uuid, user_uuid, role) VALUES
    ('d0000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'owner'),
    ('d0000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002', 'owner'),
    ('d0000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000003', 'viewer'),
    ('d0000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000004', 'owner'),
    ('d0000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000005', 'editor'),
    ('d0000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000006', 'owner'),
    ('d0000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000007', 'owner'),
    ('d0000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000008', 'viewer'),
    ('d0000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000009', 'viewer')
ON CONFLICT (deck_uuid, user_uuid) DO UPDATE
SET role = EXCLUDED.role;

-- -------------------------------------------------------------
-- Bootstrap projection for quick smoke-test
-- (in production rebuilt by consumer from outbox events)
-- -------------------------------------------------------------
INSERT INTO proj_card_overview
    (card_uuid, name, description, rarity_code, type_code, strength, defense, tags)
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

COMMIT;