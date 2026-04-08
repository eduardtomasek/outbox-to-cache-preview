# What is it?

This is the proof of concept multi layer data architecture.

It consists of:

- source of truth (postgres, normalized tables)
- projections (postgres, denormalized tables)
- redis (layer for fast data delivery)

Projections and redis layer are generated automatically with this workflow:

- change in data is made (by user or system)
- with saving new value outbox event is made
- outbox event is transformed into rabbitmq message
- routed into queue
- consumer sits on queue and update projections and redis layer

In case of retrieving data:

- user ask data
- first hit is redis
- if miss projections layer is used

# .env

```env
RABBITMQ_URL=amqp://admin:pass123@localhost
RABBITMQ_USER=admin
RABBITMQ_PASS=pass123
RABBITMQ_MANAGEMENT_URL=http://localhost:15672

API_DOC_USER=admin
API_DOC_PASS=admin

PORT=3060

APP_DB_URL=postgresql://appuser:pass123@localhost:5435/appdb

REDIS_HOST=localhost
REDIS_PORT=6380
REDIS_PASSWORD=redispass123

BOOTSTRAP_DB=true

NODE_ENV=development
```

# How to

```bash
cd ./devops/docker-compose.yml

docker compose up -d

cd ..

npm run start:dev
```

# Architecture

## Klíčové komponenty

| Vrstva           | Modul                | Odpovědnost                                                                                                                                    |
| ---------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Write**        | `CardsModule`        | Přijímá REST požadavky na update karty, v jedné DB transakci updatuje `card_stats` a vloží záznam do `outbox_events`                           |
| **Outbox relay** | `OutboxEventsModule` | Čte pending outbox eventy (`SELECT ... FOR UPDATE SKIP LOCKED`), publikuje je na RabbitMQ exchange `ex.game` s routing key `game.card.updated` |
| **Broker**       | `RabbitmqModule`     | Spravuje AMQP spojení, publish channel, auto-discovery consumerů přes `@RabbitConsumer` dekorátor, reconnect s exponential backoff             |
| **Consumer**     | `ConsumersModule`    | `GameCardUpdatedConsumersService` naslouchá na `q.game.card-updated`, zpracovává eventy a volá projekční vrstvu                                |
| **Projection**   | `ProjectionsModule`  | Sestaví denormalizovaný pohled (`proj_card_overview`) z normalizovaných tabulek a uloží výsledek do Redis cache                                |
| **Read**         | `CardsModule`        | `GET /cards/:uuid/overview` — nejdřív Redis, při cache miss fallback na `proj_card_overview` v PostgreSQL                                      |

## RabbitMQ topologie

```
ex.game (topic, durable)
  └─ game.card.updated ──▶ q.game.card-updated
                               │ x-dead-letter-exchange: ex.game.dlx
                               ▼
                           ex.game.dlx (fanout)
                               └──▶ q.game.dlq (TTL 7d, max 10k)
```

# Workflow

## ![workflow](workflow.png)

# Database

![eventcascade_erd](eventcascade_erd.png)

# Modules

## Cards Module

The `CardsModule` manages operations related to cards, including their storage, retrieval, and projections.

- **Controller**:
    - `CardsController`: Handles HTTP requests related to card operations.
- **Services**:
    - `CardsService`: Contains the business logic for managing cards.
- **Repositories**:
    - `CardsPgRepository`: Manages PostgreSQL database operations for cards.
    - `CardsRedisRepository`: Handles Redis operations for caching card data.
    - `ProjectionsCardsPgRepository`: Manages projections of card data in PostgreSQL.

## Consumers Module

The `ConsumersModule` processes events related to game cards, integrating with projections and outbox events.

- **Services**:
    - `GameCardUpdatedConsumersService`: Handles the consumption of events related to game card updates.

## Outbox Events Module

The `OutboxEventsModule` manages outbox events, ensuring reliable event-driven communication.

- **Controller**:
    - `OutboxEventsController`: Handles HTTP requests for managing outbox events.
- **Services**:
    - `OutboxEventsService`: Contains the business logic for managing outbox events.
- **Repositories**:
    - `OutboxEventsPgRepository`: Manages PostgreSQL database operations for outbox events.

## Projections Module

The `ProjectionsModule` manages projections of card data, integrating with the cards module and database.

- **Services**:
    - `ProjectionsService`: Contains the business logic for managing projections.
- **Repositories**:
    - `CardOverviewProjectionsPgRepository`: Handles PostgreSQL operations for card overview projections.
