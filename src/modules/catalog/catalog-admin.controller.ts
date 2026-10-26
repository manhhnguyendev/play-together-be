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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/security/decorators';
import {
  CreateGameDto,
  CreateGameTypeDto,
  CreateRankDto,
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
  createGame(@Body() dto: CreateGameDto) {
    return this.catalog.createGame(dto);
  }

  @Patch('games/:id')
  @ApiOperation({ summary: 'Update a game (including game type links)' })
  updateGame(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGameDto) {
    return this.catalog.updateGame(id, dto);
  }

  @Delete('games/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete an unreferenced game' })
  async removeGame(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.catalog.removeGame(id);
  }

  @Post('games/:id/ranks')
  @ApiOperation({ summary: 'Add a rank to a game' })
  createRank(@Param('id', ParseUUIDPipe) gameId: string, @Body() dto: CreateRankDto) {
    return this.catalog.createRank(gameId, dto);
  }

  @Patch('ranks/:rankId')
  @ApiOperation({ summary: 'Update a rank' })
  updateRank(@Param('rankId', ParseUUIDPipe) rankId: string, @Body() dto: UpdateRankDto) {
    return this.catalog.updateRank(rankId, dto);
  }

  @Delete('ranks/:rankId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a rank that no player uses' })
  async removeRank(@Param('rankId', ParseUUIDPipe) rankId: string): Promise<void> {
    await this.catalog.removeRank(rankId);
  }

  @Post('game-types')
  @ApiOperation({ summary: 'Create a game type' })
  createGameType(@Body() dto: CreateGameTypeDto) {
    return this.catalog.createGameType(dto);
  }

  @Patch('game-types/:id')
  @ApiOperation({ summary: 'Update a game type' })
  updateGameType(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGameTypeDto) {
    return this.catalog.updateGameType(id, dto);
  }

  @Delete('game-types/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a game type' })
  async removeGameType(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.catalog.removeGameType(id);
  }
}
