import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB } from './db.d';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
    private _db: Kysely<DB>;

    get db(): Kysely<DB> {
        return this._db;
    }

    onModuleInit() {
        const pool = new Pool({
            connectionString:
                process.env.DATABASE_URL,
            max: 20,
            idleTimeoutMillis: 30_000,
            connectionTimeoutMillis: 2_000,
        });

        this._db = new Kysely<DB>({
            dialect: new PostgresDialect({ pool }),
        });
    }

    async onModuleDestroy() {
        await this._db.destroy();
    }
}