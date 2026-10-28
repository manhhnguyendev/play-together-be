import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { PageMetaDto } from '../../common/openapi/paginated.dto';
import { UserSummary } from '../users/users.dto';

export class SendMessageDto {
  @ApiProperty({ minLength: 1, maxLength: 2000 })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message: string;
}

export class ChatMessageView {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  senderId: string;

  @ApiProperty({ format: 'uuid' })
  receiverId: string;

  @ApiProperty()
  message: string;

  @ApiProperty()
  isRecalled: boolean;

  @ApiProperty({ description: 'True when the caller sent the message' })
  mine: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class ConversationView {
  @ApiProperty({ type: UserSummary })
  user: UserSummary;

  @ApiProperty({ type: ChatMessageView, nullable: true })
  lastMessage: ChatMessageView | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  updatedAt: string | null;
}

export class ChatMessagePage {
  @ApiProperty({ type: [ChatMessageView] })
  items: ChatMessageView[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}
