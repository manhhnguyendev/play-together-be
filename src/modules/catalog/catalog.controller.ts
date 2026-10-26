import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/security/decorators';
import { CatalogService } from './catalog.service';
import { ListGamesQuery, ListGameTypesQuery } from './catalog.dto';

@ApiTags('catalog')
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @Get('games')
  @ApiOperation({ summary: 'List games' })
  listGames(@Query() query: ListGamesQuery) {
    return this.catalog.listGames(query);
  }

  @Public()
  @Get('games/:id')
  @ApiOperation({ summary: 'Game detail with ranks and types' })
  getGame(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.getGame(id);
  }

  @Public()
  @Get('games/:id/ranks')
  @ApiOperation({ summary: 'Ranks of a game' })
  listRanks(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.listRanks(id);
  }

  @Public()
  @Get('game-types')
  @ApiOperation({ summary: 'List game types' })
  listGameTypes(@Query() query: ListGameTypesQuery) {
    return this.catalog.listGameTypes(query);
  }

  @Public()
  @Get('game-types/:id')
  @ApiOperation({ summary: 'Game type detail with linked games' })
  getGameType(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.getGameType(id);
  }
}
