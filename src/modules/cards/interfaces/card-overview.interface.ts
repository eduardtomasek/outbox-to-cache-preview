export interface CardOverview {
    cardUUID: string;
    name: string;
    description?: string;
    rarityCode: string;
    typeCode: string;
    strength: number;
    defense: number;
    tags: string[];
    primaryImage?: string;
    updatedAt: Date;
}
