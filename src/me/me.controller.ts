import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/current-user.decorator';
import { JwtGuard } from '../auth/jwt.guard';
import { zodBody } from '../common/zod-validation.pipe';
import { type ProfileResponse, type UpdateProfileRequest, updateProfileSchema } from './dto';
import { MeService } from './me.service';

/**
 * The signed-in user's own profile — never anyone else's. There is no `/users/:id` counterpart on
 * purpose: the id always comes from the token's `sub`, the same claim every other resource is
 * scoped by, so there is no id a caller could substitute.
 */
@Controller('me')
@UseGuards(JwtGuard)
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get()
  find(@CurrentUser() ownerId: string): Promise<ProfileResponse> {
    return this.me.find(ownerId);
  }

  @Put()
  update(
    @CurrentUser() ownerId: string,
    @Body(zodBody(updateProfileSchema)) request: UpdateProfileRequest,
  ): Promise<ProfileResponse> {
    return this.me.update(ownerId, request);
  }
}
