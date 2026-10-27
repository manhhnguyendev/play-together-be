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
import { Roles } from '../../common/security/decorators';
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

@ApiTags('admin:catalog')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin')
export class CatalogAdminController {
  constructor(private readonly catalog: CatalogService) {}

  @Post('games')
  @ApiOperation({ summary: 'Create a game' })
  @ApiCreatedResponse({ type: GameDetail })
  createGame(@Body() dto: CreateGameDto): Promise<GameDetail> {
    return this.catalog.createGame(dto);
  }

  @Patch('games/:id')
  @ApiOperation({ summary: 'Update a game (including game type links)' })
  @ApiOkResponse({ type: GameDetail })
  updateGame(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGameDto): Promise<GameDetail> {
    return this.catalog.updateGame(id, dto);
  }

  @Delete('games/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete an unreferenced game' })
  @ApiNoContentResponse()
  async removeGame(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.catalog.removeGame(id);
  }

  @Post('games/:id/ranks')
  @ApiOperation({ summary: 'Add a rank to a game' })
  @ApiCreatedResponse({ type: GameRankDto })
  createRank(
    @Param('id', ParseUUIDPipe) gameId: string,
    @Body() dto: CreateRankDto,
  ): Promise<GameRankDto> {
    return this.catalog.createRank(gameId, dto);
  }

  @Patch('ranks/:rankId')
  @ApiOperation({ summary: 'Update a rank' })
  @ApiOkResponse({ type: GameRankDto })
  updateRank(
    @Param('rankId', ParseUUIDPipe) rankId: string,
    @Body() dto: UpdateRankDto,
  ): Promise<GameRankDto> {
    return this.catalog.updateRank(rankId, dto);
  }

  @Delete('ranks/:rankId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a rank that no player uses' })
  @ApiNoContentResponse()
  async removeRank(@Param('rankId', ParseUUIDPipe) rankId: string): Promise<void> {
    await this.catalog.removeRank(rankId);
  }

  @Post('game-types')
  @ApiOperation({ summary: 'Create a game type' })
  @ApiCreatedResponse({ type: GameTypeView })
  createGameType(@Body() dto: CreateGameTypeDto): Promise<GameTypeView> {
    return this.catalog.createGameType(dto);
  }

  @Patch('game-types/:id')
  @ApiOperation({ summary: 'Update a game type' })
  @ApiOkResponse({ type: GameTypeView })
  updateGameType(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGameTypeDto,
  ): Promise<GameTypeView> {
    return this.catalog.updateGameType(id, dto);
  }

  @Delete('game-types/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a game type' })
  @ApiNoContentResponse()
  async removeGameType(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.catalog.removeGameType(id);
  }
}
