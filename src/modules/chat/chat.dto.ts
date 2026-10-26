import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import type { UserSummary } from '../users/users.dto';

export class SendMessageDto {
  @ApiProperty({ minLength: 1, maxLength: 2000 })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message: string;
}

export type ChatMessageView = {
  id: string;
  senderId: string;
  receiverId: string;
  message: string;
  isRecalled: boolean;
  mine: boolean;
  createdAt: string;
};

export type ConversationView = {
  user: UserSummary;
  lastMessage: ChatMessageView | null;
  updatedAt: string | null;
};
