import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsUUID } from 'class-validator';

export class UpdateStrengthDefensePostRequestDto {
    @ApiProperty({
        description: 'UUID of the card to update.',
        required: true,
    })
    @IsUUID()
    cardUUID!: string;

    @ApiProperty({
        description: 'New strength value for the card.',
        required: true,
    })
    @IsNumber()
    strength?: number;

    @ApiProperty({
        description: 'New defense value for the card.',
        required: true,
    })
    @IsNumber()
    defense?: number;
}
