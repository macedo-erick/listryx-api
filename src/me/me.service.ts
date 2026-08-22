import { Injectable } from '@nestjs/common';

import type { ProfileResponse, UpdateProfileRequest } from './dto';
import { type KeycloakUser, KeycloakAdminClient } from './keycloak-admin.client';

/**
 * The signed-in user's own profile.
 *
 * The profile lives in Keycloak, not in this database — the app only ever stores the `sub` as an
 * owner id. Editing it therefore means calling Keycloak rather than writing a row, which is why
 * there is no repository behind this.
 */
@Injectable()
export class MeService {
  constructor(private readonly keycloak: KeycloakAdminClient) {}

  async find(userId: string): Promise<ProfileResponse> {
    return toResponse(await this.keycloak.findUser(userId));
  }

  /**
   * Changing an email clears its verified flag, so a user cannot promote an unverified address
   * to a verified one by editing it.
   */
  async update(userId: string, request: UpdateProfileRequest): Promise<ProfileResponse> {
    const current = await this.keycloak.findUser(userId);
    const emailChanged = request.email.toLowerCase() !== text(current['email']).toLowerCase();

    const attributes: KeycloakUser = {
      firstName: request.firstName,
      lastName: request.lastName,
      email: request.email,
      ...(emailChanged ? { emailVerified: false } : {}),
    };

    await this.keycloak.updateUser(userId, attributes);

    return this.find(userId);
  }
}

function toResponse(user: KeycloakUser): ProfileResponse {
  return {
    username: text(user['username']),
    firstName: text(user['firstName']),
    lastName: text(user['lastName']),
    email: text(user['email']),
    emailVerified: user['emailVerified'] === true,
  };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
