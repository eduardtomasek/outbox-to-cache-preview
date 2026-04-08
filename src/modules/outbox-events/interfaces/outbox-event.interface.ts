export interface OutboxEvent {
    id: number;
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    payload: any;
    status: string;
    retryCount: number;
    createdAt: Date;
    sentAt: Date | null;
}
