import { ApiProperty } from '@nestjs/swagger';

export class UploadView {
  @ApiProperty({
    example: '/uploads/2026-11/6f1d2a1e-0b0b-4a5e-9b1c-2f3a4b5c6d7e.jpg',
    description:
      'Root-relative path to store as-is. Clients prefix it with their own API origin, so the value keeps working when the host, port or LAN IP changes.',
  })
  url: string;

  @ApiProperty({ example: '2026-11/6f1d2a1e-0b0b-4a5e-9b1c-2f3a4b5c6d7e.jpg' })
  key: string;

  @ApiProperty({ example: 'image/jpeg' })
  contentType: string;

  @ApiProperty({ example: 184320, description: 'Bytes written' })
  size: number;
}
