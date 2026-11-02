import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Paginated } from '../../common/pagination/pagination';
import { AdminRoles, Roles } from '../../common/security/decorators';
import { AdminOpsService } from './admin-ops.service';
import {
  AdminAuditLogPage,
  AdminAuditLogView,
  AdminDepositPage,
  AdminDepositView,
  AdminEscrowPage,
  AdminKpisDto,
  AdminKpisQuery,
  AdminLedgerPage,
  AdminOrderDetailDto,
  AdminOrderPage,
  AdminOrderRowDto,
  AdminUserDossierDto,
  AdminWalletPage,
  AdminWalletView,
  ListAdminAuditQuery,
  ListAdminDepositsQuery,
  ListAdminEscrowsQuery,
  ListAdminLedgerQuery,
  ListAdminOrdersQuery,
  ListAdminWalletsQuery,
} from './admin-ops.dto';

/**
 * Read side of the console: what happened to this order, where its money went,
 * and what the back office did about it. Nothing here mutates, so no route
 * writes an audit row.
 */
@ApiTags('admin:ops')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin')
export class AdminOpsController {
  constructor(private readonly ops: AdminOpsService) {}

  @Get('audit-logs')
  @AdminRoles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Back-office action trail, newest first' })
  @ApiOkResponse({ type: AdminAuditLogPage })
  auditLogs(@Query() query: ListAdminAuditQuery): Promise<Paginated<AdminAuditLogView>> {
    return this.ops.auditLogs(query);
  }

  @Get('orders')
  @AdminRoles('MODERATOR', 'FINANCE')
  @ApiOperation({ summary: 'Every order on the platform, filterable by status, party and period' })
  @ApiOkResponse({ type: AdminOrderPage })
  orders(@Query() query: ListAdminOrdersQuery): Promise<Paginated<AdminOrderRowDto>> {
    return this.ops.orders(query);
  }

  @Get('orders/:id')
  @AdminRoles('MODERATOR', 'FINANCE')
  @ApiOperation({ summary: 'One order with its parties, timeline, escrow, ledger, ratings and reports' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AdminOrderDetailDto })
  orderDetail(@Param('id', ParseUUIDPipe) id: string): Promise<AdminOrderDetailDto> {
    return this.ops.orderDetail(id);
  }

  @Get('users/:id')
  @AdminRoles('MODERATOR', 'FINANCE')
  @ApiOperation({ summary: 'Account dossier: identity, behaviour, wallet, orders and open moderation' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AdminUserDossierDto })
  userDossier(@Param('id', ParseUUIDPipe) id: string): Promise<AdminUserDossierDto> {
    return this.ops.userDossier(id);
  }

  @Get('kpis')
  @ApiOperation({ summary: 'Period metrics: settlements, money moved and queue depth' })
  @ApiOkResponse({ type: AdminKpisDto })
  kpis(@Query() query: AdminKpisQuery): Promise<AdminKpisDto> {
    return this.ops.kpis(query);
  }

  @Get('money/ledger')
  @AdminRoles('FINANCE')
  @ApiOperation({ summary: 'Double-entry ledger with totals over the whole filtered set' })
  @ApiOkResponse({ type: AdminLedgerPage })
  ledger(@Query() query: ListAdminLedgerQuery): Promise<AdminLedgerPage> {
    return this.ops.ledger(query);
  }

  @Get('money/wallets')
  @AdminRoles('FINANCE')
  @ApiOperation({ summary: 'Wallet balances with the money still inside the release window' })
  @ApiOkResponse({ type: AdminWalletPage })
  wallets(@Query() query: ListAdminWalletsQuery): Promise<Paginated<AdminWalletView>> {
    return this.ops.wallets(query);
  }

  @Get('money/deposits')
  @AdminRoles('FINANCE')
  @ApiOperation({ summary: 'Deposit history across every provider' })
  @ApiOkResponse({ type: AdminDepositPage })
  deposits(@Query() query: ListAdminDepositsQuery): Promise<Paginated<AdminDepositView>> {
    return this.ops.deposits(query);
  }

  @Get('money/escrows')
  @AdminRoles('FINANCE')
  @ApiOperation({ summary: 'Held hirer money, split into settled, refunded and still held' })
  @ApiOkResponse({ type: AdminEscrowPage })
  async escrows(@Query() query: ListAdminEscrowsQuery): Promise<AdminEscrowPage> {
    const { items, meta, totalHeld } = await this.ops.escrows(query);
    return { items, meta, totalHeld };
  }
}
