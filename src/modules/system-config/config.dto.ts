import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateConfigDto {
  @ApiProperty({ example: 'order.platform_fee_bps' })
  @IsString()
  @Matches(/^[a-z][a-z0-9_.]{2,99}$/, { message: 'key must be lowercase dot-separated words' })
  key: string;

  @ApiProperty({ example: 6, minimum: 1, maximum: 1000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  no: number;

  @ApiProperty({ example: 'Platform fee (basis points)' })
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  title: string;

  @ApiProperty({ example: 1000, minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  value: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class UpdateConfigDto extends PartialType(CreateConfigDto) {}

export class ResolvedConfigDto {
  key: string;
  title: string;
  value: number;
  description: string | null;
  updatedAt: string;
}

export class PublicConfigDto {
  @ApiProperty({ example: 1000 })
  platformFeeBps: number;

  @ApiProperty({ example: 72 })
  feedbackWindowHours: number;

  @ApiProperty({ example: 5 })
  orderResponseMinutes: number;

  @ApiProperty({ example: 0 })
  maintenanceMode: number;
}
