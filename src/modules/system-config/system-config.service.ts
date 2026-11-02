import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import { AUDIT_ACTIONS, AuditService } from '../../common/audit/audit.service';
import { DB, type AppDatabase, type DbExecutor } from '../../common/database/database.module';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import type { AuthUser } from '../../common/security/auth-user';
import { Clock, MS_MINUTE } from '../../common/time/time';
import { CONFIG_DEFAULTS, CONFIG_KEYS, systemConfigs, type SystemConfig } from '../../db/schema';
import type { CreateConfigDto, PublicConfigDto, ResolvedConfigDto, UpdateConfigDto } from './config.dto';

const CACHE_TTL_MS = 15 * MS_MINUTE;

@Injectable()
export class SystemConfigService {
  private cache: SystemConfig[] | null = null;
  private cachedAt = 0;

  constructor(
    @Inject(DB) private readonly db: AppDatabase,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  async all(force = false): Promise<SystemConfig[]> {
    const now = this.clock.now().getTime();
    if (!force && this.cache && now - this.cachedAt < CACHE_TTL_MS) {
      return this.cache;
    }
    this.cache = await this.db.select().from(systemConfigs).orderBy(asc(systemConfigs.no));
    this.cachedAt = now;
    return this.cache;
  }

  async getNumber(key: string, executor: DbExecutor = this.db): Promise<number> {
    const rows = executor === this.db ? await this.all() : await executor.select().from(systemConfigs);
    const row = rows.find((item) => item.key === key);
    if (row) return row.value;

    const fallback = CONFIG_DEFAULTS[key];
    if (fallback) return fallback.value;

    throw AppError.notFound(ErrorCode.configNotFound, `Configuration "${key}" is not defined`);
  }

  async getRaw(key: string): Promise<SystemConfig | undefined> {
    const rows = await this.all();
    return rows.find((item) => item.key === key);
  }

  async isMaintenance(): Promise<boolean> {
    return (await this.getNumber(CONFIG_KEYS.maintenanceMode)) === 1;
  }

  async listResolved(): Promise<ResolvedConfigDto[]> {
    const rows = await this.all(true);
    const merged = new Map<string, ResolvedConfigDto>();

    for (const [key, preset] of Object.entries(CONFIG_DEFAULTS)) {
      merged.set(key, {
        id: null,
        key,
        title: preset.title,
        value: preset.value,
        description: preset.description,
        updatedAt: new Date(0).toISOString(),
      });
    }

    for (const row of rows) {
      merged.set(row.key, this.toResolved(row));
    }

    return [...merged.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  async publicView(): Promise<PublicConfigDto> {
    const rows = await this.all();
    const read = (key: string): number =>
      rows.find((item) => item.key === key)?.value ?? CONFIG_DEFAULTS[key]?.value ?? 0;

    return {
      platformFeeBps: read(CONFIG_KEYS.platformFeeBps),
      feedbackWindowHours: read(CONFIG_KEYS.feedbackWindowHours),
      orderResponseMinutes: read(CONFIG_KEYS.orderResponseMinutes),
      maintenanceMode: read(CONFIG_KEYS.maintenanceMode),
    };
  }

  async create(admin: AuthUser, dto: CreateConfigDto): Promise<ResolvedConfigDto> {
    this.assertInRange(dto.key, dto.value);

    const [existing] = await this.db
      .select({ id: systemConfigs.id })
      .from(systemConfigs)
      .where(sql`${systemConfigs.key} = ${dto.key} or ${systemConfigs.no} = ${dto.no}`)
      .limit(1);

    if (existing) {
      throw AppError.conflict(ErrorCode.conflict, 'A configuration with this key or number already exists');
    }

    const [created] = await this.db
      .insert(systemConfigs)
      .values({
        key: dto.key,
        no: dto.no,
        title: dto.title,
        value: dto.value,
        description: dto.description ?? null,
      })
      .returning();

    this.invalidate();
    await this.audit.logOwn({
      adminId: admin.id,
      adminRole: admin.adminRole,
      action: AUDIT_ACTIONS.configCreate,
      entity: 'config',
      entityId: created.id,
      reason: dto.reason,
      detail: { key: created.key, value: created.value },
    });
    return this.toResolved(created);
  }

  async update(admin: AuthUser, id: string, dto: UpdateConfigDto): Promise<ResolvedConfigDto> {
    const current = await this.requireById(id);
    if (dto.value !== undefined) {
      this.assertInRange(dto.key ?? current.key, dto.value);
    }

    const patch: Partial<typeof systemConfigs.$inferInsert> = { updatedAt: this.clock.now() };
    if (dto.key !== undefined) patch.key = dto.key;
    if (dto.no !== undefined) patch.no = dto.no;
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.value !== undefined) patch.value = dto.value;
    if (dto.description !== undefined) patch.description = dto.description;

    const [updated] = await this.db.update(systemConfigs).set(patch).where(eq(systemConfigs.id, id)).returning();
    this.invalidate();
    await this.audit.logOwn({
      adminId: admin.id,
      adminRole: admin.adminRole,
      action: AUDIT_ACTIONS.configUpdate,
      entity: 'config',
      entityId: updated.id,
      reason: dto.reason,
      detail: { key: updated.key, before: current.value, after: updated.value },
    });
    return this.toResolved(updated);
  }

  async remove(admin: AuthUser, id: string, reason?: string): Promise<void> {
    const row = await this.requireById(id);
    if (Object.values(CONFIG_KEYS).includes(row.key as never)) {
      throw AppError.badRequest(ErrorCode.configNotFound, 'Core configuration entries cannot be deleted, update them instead');
    }
    await this.db.delete(systemConfigs).where(eq(systemConfigs.id, id));
    this.invalidate();
    await this.audit.logOwn({
      adminId: admin.id,
      adminRole: admin.adminRole,
      action: AUDIT_ACTIONS.configDelete,
      entity: 'config',
      entityId: row.id,
      reason,
      detail: { key: row.key, value: row.value },
    });
  }

  invalidate(): void {
    this.cache = null;
    this.cachedAt = 0;
  }

  /**
   * Bounds are declared per key in CONFIG_DEFAULTS because the column itself
   * only knows `value >= 0`. Without this, a fee of 10000 saves cleanly here and
   * then fails the `orders.fee_bps between 0 and 5000` CHECK on every order.
   */
  private assertInRange(key: string, value: number): void {
    const preset = CONFIG_DEFAULTS[key];
    if (!preset) return;
    if (value < preset.min || value > preset.max) {
      throw AppError.unprocessable(
        ErrorCode.validationFailed,
        `"${key}" must be between ${preset.min} and ${preset.max}`,
        { key, value, min: preset.min, max: preset.max },
      );
    }
  }

  private toResolved(row: SystemConfig): ResolvedConfigDto {
    return {
      id: row.id,
      key: row.key,
      title: row.title,
      value: row.value,
      description: row.description,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async requireById(id: string): Promise<SystemConfig> {
    const [row] = await this.db.select().from(systemConfigs).where(eq(systemConfigs.id, id)).limit(1);
    if (!row) throw AppError.notFound(ErrorCode.configNotFound, 'Configuration not found');
    return row;
  }
}
