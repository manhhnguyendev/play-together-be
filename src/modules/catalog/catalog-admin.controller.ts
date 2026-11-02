import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthUser } from '../../common/security/auth-user';
import { CurrentUser } from '../../common/security/current-user.decorator';
import { AdminRoles, Roles } from '../../common/security/decorators';
import {
  CreateGameDto,
  CreateGameTypeDto,
  CreateRankDto,
  GameDetail,
  GameRankDto,
  GameTypeView,
  UpdateGameDto,
  UpdateGameTypeDto,
  UpdateRankDto,
} from './catalog.dto';
import { CatalogService } from './catalog.service';

/**
 * The catalogue is what every player sells against, so a wrong edit is felt
 * marketplace-wide. Only SUPER_ADMIN may change it.
 */
@ApiTags('admin:catalog')
@ApiBearerAuth()
@Roles('ADMIN')
@AdminRoles('SUPER_ADMIN')
@Controller('admin')
export class CatalogAdminController {
  constructor(private readonly catalog: CatalogService) {}

  @Post('games')
  @ApiOperation({ summary: 'Create a game' })
  @ApiCreatedResponse({ type: GameDetail })
  createGame(@CurrentUser() admin: AuthUser, @Body() dto: CreateGameDto): Promise<GameDetail> {
    return this.catalog.createGame(admin, dto);
  }

  @Patch('games/:id')
  @ApiOperation({ summary: 'Update a game (including game type links)' })
  @ApiOkResponse({ type: GameDetail })
  updateGame(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGameDto,
  ): Promise<GameDetail> {
    return this.catalog.updateGame(admin, id, dto);
  }

  @Delete('games/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete an unreferenced game' })
  @ApiNoContentResponse()
  async removeGame(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.catalog.removeGame(admin, id);
  }

  @Post('games/:id/ranks')
  @ApiOperation({ summary: 'Add a rank to a game' })
  @ApiCreatedResponse({ type: GameRankDto })
  createRank(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) gameId: string,
    @Body() dto: CreateRankDto,
  ): Promise<GameRankDto> {
    return this.catalog.createRank(admin, gameId, dto);
  }

  @Patch('ranks/:rankId')
  @ApiOperation({ summary: 'Update a rank' })
  @ApiOkResponse({ type: GameRankDto })
  updateRank(
    @CurrentUser() admin: AuthUser,
    @Param('rankId', ParseUUIDPipe) rankId: string,
    @Body() dto: UpdateRankDto,
  ): Promise<GameRankDto> {
    return this.catalog.updateRank(admin, rankId, dto);
  }

  @Delete('ranks/:rankId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a rank that no player uses' })
  @ApiNoContentResponse()
  async removeRank(
    @CurrentUser() admin: AuthUser,
    @Param('rankId', ParseUUIDPipe) rankId: string,
  ): Promise<void> {
    await this.catalog.removeRank(admin, rankId);
  }

  @Post('game-types')
  @ApiOperation({ summary: 'Create a game type' })
  @ApiCreatedResponse({ type: GameTypeView })
  createGameType(
    @CurrentUser() admin: AuthUser,
    @Body() dto: CreateGameTypeDto,
  ): Promise<GameTypeView> {
    return this.catalog.createGameType(admin, dto);
  }

  @Patch('game-types/:id')
  @ApiOperation({ summary: 'Update a game type' })
  @ApiOkResponse({ type: GameTypeView })
  updateGameType(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGameTypeDto,
  ): Promise<GameTypeView> {
    return this.catalog.updateGameType(admin, id, dto);
  }

  @Delete('game-types/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a game type' })
  @ApiNoContentResponse()
  async removeGameType(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.catalog.removeGameType(admin, id);
  }
}
