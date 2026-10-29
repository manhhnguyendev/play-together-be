import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
import { Public } from '../../common/security/decorators';
import {
  AddFavoriteDto,
  AddHobbyDto,
  AddImageDto,
  AvailabilityWindowView,
  BlockedUserView,
  BlockUserDto,
  CreateAvailabilityDto,
  FavoriteGameItemDto,
  PlayerModeDto,
  SearchPlayersQuery,
  UpdateAvailabilityDto,
  UpdateProfileDto,
  UpdateSkillRankDto,
  UpdateStatusDto,
  UpsertSkillDto,
  UserImageView,
  UserPage,
  UserProfileView,
  UserSummary,
} from './users.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Search player profiles' })
  @ApiOkResponse({ type: UserPage })
  search(@Query() query: SearchPlayersQuery) {
    return this.users.searchPlayers(query);
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'My full profile' })
  @ApiOkResponse({ type: UserProfileView })
  me(@CurrentUser() user: AuthUser) {
    return this.users.getProfile(user.id, user.id);
  }

  @ApiBearerAuth()
  @Patch('me')
  @ApiOperation({ summary: 'Update my profile' })
  @ApiOkResponse({ type: UserSummary })
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(user.id, dto);
  }

  @ApiBearerAuth()
  @Patch('me/status')
  @ApiOperation({ summary: 'Set my presence status' })
  @ApiOkResponse({ type: UserSummary })
  updateStatus(@CurrentUser() user: AuthUser, @Body() dto: UpdateStatusDto) {
    return this.users.updateStatus(user.id, dto.status);
  }

  @ApiBearerAuth()
  @Patch('me/player-mode')
  @ApiOperation({ summary: 'Enable or disable player mode' })
  @ApiOkResponse({ type: UserSummary })
  playerMode(@CurrentUser() user: AuthUser, @Body() dto: PlayerModeDto) {
    return this.users.setPlayerMode(user.id, dto);
  }

  @ApiBearerAuth()
  @Post('me/skills')
  @HttpCode(204)
  @ApiOperation({ summary: 'Add a game skill' })
  @ApiNoContentResponse()
  async addSkill(@CurrentUser() user: AuthUser, @Body() dto: UpsertSkillDto): Promise<void> {
    await this.users.addSkill(user.id, dto);
  }

  @ApiBearerAuth()
  @Patch('me/skills/:skillId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Change the rank of a skill' })
  @ApiNoContentResponse()
  async updateSkill(
    @CurrentUser() user: AuthUser,
    @Param('skillId', ParseUUIDPipe) skillId: string,
    @Body() dto: UpdateSkillRankDto,
  ): Promise<void> {
    await this.users.updateSkillRank(user.id, skillId, dto.rankId);
  }

  @ApiBearerAuth()
  @Delete('me/skills/:skillId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a game skill' })
  @ApiNoContentResponse()
  async removeSkill(
    @CurrentUser() user: AuthUser,
    @Param('skillId', ParseUUIDPipe) skillId: string,
  ): Promise<void> {
    await this.users.removeSkill(user.id, skillId);
  }

  @ApiBearerAuth()
  @Post('me/hobbies')
  @HttpCode(204)
  @ApiOperation({ summary: 'Add a hobby' })
  @ApiNoContentResponse()
  async addHobby(@CurrentUser() user: AuthUser, @Body() dto: AddHobbyDto): Promise<void> {
    await this.users.addHobby(user.id, dto);
  }

  @ApiBearerAuth()
  @Delete('me/hobbies/:gameId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a hobby' })
  @ApiNoContentResponse()
  async removeHobby(
    @CurrentUser() user: AuthUser,
    @Param('gameId', ParseUUIDPipe) gameId: string,
  ): Promise<void> {
    await this.users.removeHobby(user.id, gameId);
  }

  @ApiBearerAuth()
  @Get('me/favorites')
  @ApiOperation({ summary: 'Games I marked as favorites' })
  @ApiOkResponse({ type: [FavoriteGameItemDto] })
  favorites(@CurrentUser() user: AuthUser) {
    return this.users.listFavorites(user.id);
  }

  @ApiBearerAuth()
  @Post('me/favorites')
  @HttpCode(204)
  @ApiOperation({ summary: 'Add a game to my favorites' })
  @ApiNoContentResponse()
  async addFavorite(@CurrentUser() user: AuthUser, @Body() dto: AddFavoriteDto): Promise<void> {
    await this.users.addFavorite(user.id, dto);
  }

  @ApiBearerAuth()
  @Delete('me/favorites/:gameId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a game from my favorites' })
  @ApiNoContentResponse()
  async removeFavorite(
    @CurrentUser() user: AuthUser,
    @Param('gameId', ParseUUIDPipe) gameId: string,
  ): Promise<void> {
    await this.users.removeFavorite(user.id, gameId);
  }

  @ApiBearerAuth()
  @Post('me/images')
  @ApiOperation({ summary: 'Add a gallery image' })
  @ApiCreatedResponse({ type: UserImageView })
  addImage(@CurrentUser() user: AuthUser, @Body() dto: AddImageDto) {
    return this.users.addImage(user.id, dto);
  }

  @ApiBearerAuth()
  @Delete('me/images/:imageId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a gallery image' })
  @ApiNoContentResponse()
  async removeImage(
    @CurrentUser() user: AuthUser,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ): Promise<void> {
    await this.users.removeImage(user.id, imageId);
  }

  @ApiBearerAuth()
  @Get('me/availability')
  @ApiOperation({ summary: 'List my weekly availability windows' })
  @ApiOkResponse({ type: [AvailabilityWindowView] })
  async availability(@CurrentUser() user: AuthUser) {
    return (await this.users.getProfile(user.id, user.id)).availability;
  }

  @ApiBearerAuth()
  @Post('me/availability')
  @HttpCode(204)
  @ApiOperation({ summary: 'Add a weekly availability window' })
  @ApiNoContentResponse()
  async addAvailability(@CurrentUser() user: AuthUser, @Body() dto: CreateAvailabilityDto): Promise<void> {
    await this.users.createAvailability(user.id, dto);
  }

  @ApiBearerAuth()
  @Patch('me/availability/:windowId')
  @ApiOperation({ summary: 'Update an availability window' })
  @ApiOkResponse({ type: AvailabilityWindowView })
  updateAvailability(
    @CurrentUser() user: AuthUser,
    @Param('windowId', ParseUUIDPipe) windowId: string,
    @Body() dto: UpdateAvailabilityDto,
  ) {
    return this.users.updateAvailability(user.id, windowId, dto);
  }

  @ApiBearerAuth()
  @Delete('me/availability/:windowId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove an availability window' })
  @ApiNoContentResponse()
  async removeAvailability(
    @CurrentUser() user: AuthUser,
    @Param('windowId', ParseUUIDPipe) windowId: string,
  ): Promise<void> {
    await this.users.removeAvailability(user.id, windowId);
  }

  @ApiBearerAuth()
  @Get('me/blocks')
  @ApiOperation({ summary: 'List users I blocked' })
  @ApiOkResponse({ type: [BlockedUserView] })
  blocks(@CurrentUser() user: AuthUser) {
    return this.users.listBlocks(user.id);
  }

  @ApiBearerAuth()
  @Post('me/blocks')
  @HttpCode(204)
  @ApiOperation({ summary: 'Block a user' })
  @ApiNoContentResponse()
  async block(@CurrentUser() user: AuthUser, @Body() dto: BlockUserDto): Promise<void> {
    await this.users.block(user.id, dto);
  }

  @ApiBearerAuth()
  @Delete('me/blocks/:blockedUserId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Unblock a user' })
  @ApiNoContentResponse()
  async unblock(
    @CurrentUser() user: AuthUser,
    @Param('blockedUserId', ParseUUIDPipe) blockedUserId: string,
  ): Promise<void> {
    await this.users.unblock(user.id, blockedUserId);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Public profile of a user' })
  @ApiOkResponse({ type: UserProfileView })
  profile(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() viewer?: AuthUser) {
    return this.users.getProfile(id, viewer?.id);
  }

  @Public()
  @Get(':id/availability')
  @ApiOperation({ summary: 'Weekly availability windows of a player' })
  @ApiOkResponse({ type: [AvailabilityWindowView] })
  async profileAvailability(@Param('id', ParseUUIDPipe) id: string) {
    return (await this.users.getProfile(id)).availability;
  }

  @Public()
  @Get(':id/availability/now')
  @ApiOperation({ summary: 'Whether the player is inside an availability window right now' })
  @ApiOkResponse({ schema: { type: 'object', properties: { availableNow: { type: 'boolean' } } } })
  async availableNow(@Param('id', ParseUUIDPipe) id: string): Promise<{ availableNow: boolean }> {
    return { availableNow: await this.users.isAvailableNow(id) };
  }
}
