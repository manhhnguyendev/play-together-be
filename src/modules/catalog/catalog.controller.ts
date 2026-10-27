import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Paginated } from '../../common/pagination/pagination';
import { Public } from '../../common/security/decorators';
import { CatalogService } from './catalog.service';
import {
  FavoriteGameDto,
  GameDetail,
  GamePage,
  GameRankDto,
  GameTypeDetail,
  GameTypePage,
  GameTypeView,
  GameView,
  ListGamesQuery,
  ListGameTypesQuery,
  MostFavoritesQuery,
} from './catalog.dto';

@ApiTags('catalog')
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @Get('games')
  @ApiOperation({ summary: 'List games' })
  @ApiOkResponse({ type: GamePage })
  listGames(@Query() query: ListGamesQuery): Promise<Paginated<GameView>> {
    return this.catalog.listGames(query);
  }

  @Public()
  @Get('games/most-favorited')
  @ApiOperation({ summary: 'Games most often marked as a favorite' })
  @ApiOkResponse({ type: [FavoriteGameDto] })
  mostFavorited(@Query() query: MostFavoritesQuery): Promise<FavoriteGameDto[]> {
    return this.catalog.mostFavorited(query.limit);
  }

  @Public()
  @Get('games/:id')
  @ApiOperation({ summary: 'Game detail with ranks and types' })
  @ApiOkResponse({ type: GameDetail })
  getGame(@Param('id', ParseUUIDPipe) id: string): Promise<GameDetail> {
    return this.catalog.getGame(id);
  }

  @Public()
  @Get('games/:id/ranks')
  @ApiOperation({ summary: 'Ranks of a game' })
  @ApiOkResponse({ type: [GameRankDto] })
  listRanks(@Param('id', ParseUUIDPipe) id: string): Promise<GameRankDto[]> {
    return this.catalog.listRanks(id);
  }

  @Public()
  @Get('game-types')
  @ApiOperation({ summary: 'List game types' })
  @ApiOkResponse({ type: GameTypePage })
  listGameTypes(@Query() query: ListGameTypesQuery): Promise<Paginated<GameTypeView>> {
    return this.catalog.listGameTypes(query);
  }

  @Public()
  @Get('game-types/:id')
  @ApiOperation({ summary: 'Game type detail with linked games' })
  @ApiOkResponse({ type: GameTypeDetail })
  getGameType(@Param('id', ParseUUIDPipe) id: string): Promise<GameTypeDetail> {
    return this.catalog.getGameType(id);
  }
}
