import { ConfigService } from '@nestjs/config';
import { ConnectionString } from 'connection-string';
import * as fs from 'fs';
import * as path from 'path';
import * as pg from 'pg';
import pgPromise, { IInitOptions, IMain } from 'pg-promise';
import { DB_PROVIDER_TOKEN, PG_OID_DATE } from 'src/libs/core/constants';

pg.types.setTypeParser(PG_OID_DATE, 'text', (val) => val);

// ---- INIT OPTIONS: session hook pro GUC a app name
function createInitOptions(configService: ConfigService): IInitOptions {
    return {
        capSQL: true,
        noWarnings: true,
        connect(client) {
            const appName = configService.get<string>('PG_APP_NAME', 'outbox-to-cache');
            /*
                1. SET application_name = '${appName}';

                Nastaví jméno aplikace v rámci session.
                Toto jméno se pak zobrazuje v systémových
                pohledech PostgreSQL (pg_stat_activity),
                což usnadňuje monitoring, audit
                a troubleshooting (vidíš, která aplikace
                drží spojení nebo spouští dotazy).

                Dopad: Lepší přehled o tom, kdo a proč komunikuje s databází.
                Nemá vliv na výkon.

                2. SET jit = off;

                Vypíná Just-In-Time (JIT) kompilaci pro SQL dotazy v této session.

                JIT může zrychlit složité analytické dotazy,
                ale u krátkých OLTP dotazů (typicky CRUD v API)
                často přináší spíš režii navíc (kompilace trvá
                déle než samotné provedení dotazu).

                Dopad: Pro běžné API dotazy (krátké, jednoduché) zrychlí odezvu,
                protože se vyhne zbytečné kompilaci. Pro složité analytické
                dotazy by naopak mohl výkon mírně klesnout.

                3. SET statement_timeout = '5s';

                Nastaví maximální dobu běhu jednoho SQL dotazu na 5 sekund.

                Pokud dotaz běží déle, PostgreSQL ho automaticky ukončí s chybou.

                Dopad: Chrání backend i databázi před "zaseknutými" nebo příliš
                dlouhými dotazy (např. špatný index, chyba v kódu). Hodnotu nastav
                podle SLA a očekávaných dotazů – příliš nízká může zabíjet i
                legitimní dotazy, příliš vysoká nechrání dostatečně.

                4. SET idle_in_transaction_session_timeout = '10s';

                Nastaví maximální dobu, po kterou může být session neaktivní
                v rámci transakce (tj. transakce je otevřená, ale neprobíhá žádný dotaz).

                Po uplynutí limitu PostgreSQL session ukončí.

                Dopad: Chrání před "visícími" transakcemi, které by mohly
                blokovat zámky, zvyšovat riziko deadlocků nebo zbytečně
                držet prostředky. 10 sekund je poměrně přísné, ale pro
                běžné API transakce obvykle dostačující.
             */
            client.client
                .query(
                    /* sql */ `
                    SET application_name = '${appName}';
                    SET jit = off;
                    SET statement_timeout = '5s';
                    SET idle_in_transaction_session_timeout = '10s';
                `,
                )
                .catch(() => {
                    /* nechceme shodit init */
                });
        },
    };
}

export const appDbProvider = {
    provide: DB_PROVIDER_TOKEN,
    inject: [ConfigService],
    useFactory: (configService: ConfigService) => {
        const initOptions = createInitOptions(configService);
        const pgp: IMain = pgPromise(initOptions);

        const dbUrl = configService.get<string>('APP_DB_URL', '');
        const cs = new ConnectionString(dbUrl);
        if (!cs?.hosts?.[0]?.name) {
            throw new Error('APP_DB_URL is invalid');
        }

        const isProd = configService.get<string>('NODE_ENV') === 'production';
        // SSL nastavení pro RDS
        const ssl = isProd
            ? {
                  ca: fs.readFileSync(path.join(__dirname, 'PATH_TO_YOUR_CERTIFICATE')).toString(),
                  // rejectUnauthorized implicitně true – s CA je to OK
              }
            : // mimo prod – dle potřeby (nebo spolehni se na ?sslmode=require přímo v URL)
              // { rejectUnauthorized: false };
              false;

        const connConfig = {
            host: cs.hosts[0].name,
            port: cs.hosts[0].port,
            database: cs.path?.[0],
            user: cs.user,
            password: cs.password,
            ssl,
            /*
                1. max: Number(process.env.PG_POOL_MAX ?? 10)

                Maximální počet současně otevřených připojení v connection poolu.

                Pokud je pool plný, další požadavky čekají, dokud se některé připojení neuvolní.

                Dopad:
                 -  Příliš nízká hodnota → API může být zbytečně pomalé při špičce (čekání na volné spojení).
                 -  Příliš vysoká hodnota → můžeš přetížit databázi (každé připojení
                    žere RAM a CPU na serveru).
                 -  Typicky nastavuj podle počtu CPU na DB serveru a očekávané zátěže.

                2. idleTimeoutMillis: Number(process.env.PG_POOL_IDLE_MS ?? 300_000)

                Jak dlouho (v ms) může být neaktivní připojení v poolu, než ho
                pool zavře (defaultně 5 minut).

                Dopad:
                 -  Kratší timeout → rychlejší uvolňování nevyužitých spojení,
                    menší spotřeba prostředků, ale častější reconnecty
                    (může mírně zpomalit první dotaz po delší nečinnosti).
                 -  Delší timeout → méně reconnectů, ale více "spících" spojení
                    (zbytečně drží RAM/sloty na DB serveru).

                3. connectionTimeoutMillis: Number(process.env.PG_CONN_TIMEOUT_MS ?? 2000)

                Jak dlouho (v ms) bude pool čekat na navázání nového spojení,
                než to vzdá s chybou (defaultně 2 sekundy).

                Dopad:
                 -  Krátký timeout → rychlejší fail, když je DB nedostupná nebo
                    přetížená (lepší UX, rychlejší error handling).
                 -  Dlouhý timeout → aplikace může "viset" při problémech s DB,
                    horší odezva při výpadku.

                4. keepAlive: true

                Zapíná TCP keepalive na všech spojení.

                Dopad:
                 -  Pomáhá detekovat "mrtvá" spojení (např. po výpadku sítě, firewallu apod.).
                 -  Snižuje počet "zombie" spojení v poolu, která by jinak zůstala
                    viset a způsobovala chyby při pokusu o použití.

                Doporučeno mít zapnuté pro produkci.

                5. keepAliveInitialDelayMillis: Number(process.env.PG_KA_INIT_DELAY_MS ?? 30_000)

                Po jak dlouhé době nečinnosti (v ms) začne TCP stack posílat
                keepalive pakety (defaultně 30 sekund).

                Dopad:
                 -  Kratší delay → rychlejší detekce mrtvých spojení, ale o něco vyšší síťová režie.
                 -  Delší delay → pomalejší detekce, ale méně síťového provozu.

                 30 sekund je rozumný kompromis pro většinu API aplikací.
            */
            max: configService.get<number>('PG_POOL_MAX', 10), // počet připojení v poolu
            idleTimeoutMillis: configService.get<number>('PG_POOL_IDLE_MS', 300_000), // 5 min – jak dlouho čeká neaktivní klient v poolu, než ho zahodí
            connectionTimeoutMillis: configService.get<number>('PG_CONN_TIMEOUT_MS', 2000),
            keepAlive: true, // TCP keepalive nech ON, ať se méně reconnectuje a lépe zjišťují mrtvá spojení
            keepAliveInitialDelayMillis: configService.get<number>('PG_KA_INIT_DELAY_MS', 30_000), // posílej keepalive brzy (nečekej hodiny)
        };

        return pgp(connConfig);
    },
};
