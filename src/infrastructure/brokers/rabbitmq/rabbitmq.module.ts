import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { RabbitConsumerDiscovery } from './rabbitmq-consumer.discovery';
import { RabbitmqService } from './rabbitmq.service';
import { RabbitmqTopologyService } from './rabbitmq.topology.service';

@Global()
@Module({
    imports: [DiscoveryModule],
    providers: [RabbitmqService, RabbitmqTopologyService, RabbitConsumerDiscovery],
    exports: [RabbitmqService, RabbitmqTopologyService, RabbitConsumerDiscovery],
})
export class RabbitmqModule {}
