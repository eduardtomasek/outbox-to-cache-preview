import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiParam, ApiTags } from '@nestjs/swagger';
import { UpdateStrengthDefensePostRequestDto } from '../dto/cards-update-strength-defense.post.dto';
import { CardsService } from '../services/cards.service';

@ApiTags('cards')
@Controller('cards')
export class CardsController {
    constructor(private readonly cardsService: CardsService) {}

    @Post('update-strength-defense')
    updateStrengthDefense(@Body() body: UpdateStrengthDefensePostRequestDto) {
        return this.cardsService.updateStrengthDefense(body);
    }

    @Get(':cardUUID/overview')
    @ApiParam({
        name: 'cardUUID',
        description: 'UUID of the card to retrieve overview for.',
        type: String,
    })
    findCardOverview(@Param('cardUUID') cardUUID: string) {
        return this.cardsService.findCardOverview(cardUUID);
    }

    @Post('put-all-into-outbox')
    putAllCardsIntoOutbox() {
        return this.cardsService.putAllCardsIntoOutbox();
    }
}
