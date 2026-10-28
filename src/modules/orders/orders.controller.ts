import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthUser } from '../../common/security/auth-user';
import { CurrentUser } from '../../common/security/current-user.decorator';
import {
  CreateOrderDto,
  EndEarlyDto,
  ListOrdersQuery,
  OrderHistoryItemView,
  OrderPage,
  OrderView,
  RejectOrderDto,
} from './orders.dto';
import { OrdersService } from './orders.service';

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @ApiOperation({ summary: 'Create a hire request for a player' })
  @ApiCreatedResponse({ type: OrderView })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    return this.orders.create(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Orders I created as a hirer' })
  @ApiOkResponse({ type: OrderPage })
  mine(@CurrentUser() user: AuthUser, @Query() query: ListOrdersQuery) {
    return this.orders.listMine(user.id, query);
  }

  @Get('requests')
  @ApiOperation({ summary: 'Hire requests I received as a player' })
  @ApiOkResponse({ type: OrderPage })
  requests(@CurrentUser() user: AuthUser, @Query() query: ListOrdersQuery) {
    return this.orders.listRequests(user.id, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Order detail' })
  @ApiOkResponse({ type: OrderView })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(id, user);
  }

  @Get(':id/history')
  @ApiOperation({ summary: 'Order status timeline' })
  @ApiOkResponse({ type: [OrderHistoryItemView] })
  history(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.history(id, user);
  }

  @Post(':id/accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Accept a hire request and move funds into escrow' })
  @ApiOkResponse({ type: OrderView })
  accept(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.accept(user.id, id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reject a hire request' })
  @ApiOkResponse({ type: OrderView })
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectOrderDto,
  ) {
    return this.orders.reject(user.id, id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a pending hire request (hirer only)' })
  @ApiOkResponse({ type: OrderView })
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.cancel(user.id, id);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Complete a session after its scheduled end' })
  @ApiOkResponse({ type: OrderView })
  complete(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.complete(user.id, id);
  }

  @Post(':id/end-early')
  @HttpCode(200)
  @ApiOperation({ summary: 'End an accepted session early with prorated settlement' })
  @ApiOkResponse({ type: OrderView })
  endEarly(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EndEarlyDto,
  ) {
    return this.orders.endEarly(user.id, id, dto);
  }
}
