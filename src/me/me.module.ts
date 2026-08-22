import { Module } from '@nestjs/common';

import { KeycloakAdminClient } from './keycloak-admin.client';
import { MeController } from './me.controller';
import { MeService } from './me.service';

@Module({
  controllers: [MeController],
  providers: [MeService, KeycloakAdminClient],
})
export class MeModule {}
